/**
 * W7 反思装饰器 — loop 进入 done 前的一票结构化 critic
 *
 * 背景：architecture-audit-2026-07 维度 5「反思层完全缺失」——幻觉答案/工具误用无人复核直接进 done。
 *
 * 职责划分（对齐 AGENTS.md 架构纪律，单一状态机在 reactLoop）：
 * - 本模块只做「评估」：识别即将 done 的终轮（withTools=true 且零 toolCalls），用 criticModel
 *   跑一票 JSON critic（{ passed, issues }），把 verdict 附到 LlmTurnResult.reflection。
 *   不改 messages、不持有重试计数、不做重试决策——不是第二套状态机。
 * - reactLoop 在 done 转移点消费 verdict：不通过且轮数未满 → 经既有 injectUserMessages
 *   显式机制回注续轮；轮数耗尽 → 内容带 [未经反思通过] 标记放行（不阻断用户）。
 *
 * critic 调用经 createSyncTransport → W2 弹性客户端（重试/降级自动生效）；
 * critic 失败 / 输出解析失败 = 跳过反思（不附 verdict），绝不影响主链路。
 *
 * 注意：合成轮（withTools=false，预算/轮数耗尽后的兜底）不做反思——该路径已是降级兜底，
 * 且发生在 for 轮循环之外，无「再走一轮」的合法承接点。
 */

import type { AppConfig } from "../config.js";
import type { LlmMessage } from "../llmClient.js";
import { createSyncTransport } from "./transports.js";
import type { LlmTransport, ReflectionVerdict } from "./types.js";

/** 反思轮数耗尽仍未通过时的放行标记（reactLoop 在 done 转移点加在正文前） */
export const REFLECTION_UNPASSED_MARK = "[未经反思通过] ";

export interface ReflectionOptions {
  /** 总开关（config.yaml reflection.enabled，默认 false） */
  enabled: boolean;
  /** 最大反思重修轮数；0 = 只审不修（不通过直接标记放行） */
  maxRounds: number;
  /** critic 使用的便宜模型；接入点负责兜底为非空（空 = 主模型） */
  criticModel: string;
  /** 构建默认 critic transport 所需（critic 走 W2 弹性客户端） */
  config: AppConfig;
  /** 测试注入：覆盖默认 critic transport */
  criticTransport?: LlmTransport;
}

/**
 * Critic prompt（放常量而非 content/prompts：反思是运行时内部质量门，
 * 不是用户可复用的 Prompt 模板资产；避免 db:sync 扫描耦合）。
 * 输出契约：严格 JSON { "passed": boolean, "issues": string[] }。
 */
const CRITIC_SYSTEM_PROMPT = `你是一个严格但务实的回答质量复核员（critic）。给你一段对话上下文和一份「即将发给用户的最终回答」，请复核：
1. 是否真正回答了用户的最新诉求（无答非所问、无遗漏用户明确提出的子问题）；
2. 是否有与对话上下文（含工具结果）矛盾的编造内容（幻觉）；
3. 是否存在明显的事实性/逻辑性错误。

不要挑剔格式、详略、语气等主观偏好；没有实质问题就通过。
只输出一行 JSON，不要输出任何其他文字：
{"passed": true, "issues": []}
或
{"passed": false, "issues": ["具体问题1", "具体问题2"]}
issues 必须具体、可执行（指出缺什么/错在哪），不超过 3 条。`;

/** 每条上下文消息的 critic 可见上限（工具结果可能很大，截断控制 critic 成本） */
const CRITIC_TRANSCRIPT_MSG_MAX_CHARS = 1500;

function contentToText(content: LlmMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text) : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** 组装回注给主模型的反思意见（作为 user 消息经 injectUserMessages 注入） */
function buildFeedback(issues: string[]): string {
  return [
    "【自动质量复核未通过】你的上一版最终回答存在以下问题，请针对问题修订后重新作答（如需补充工具调用可以继续调用）：",
    ...issues.map((issue, i) => `${i + 1}. ${issue}`),
  ].join("\n");
}

/** 解析 critic 输出（容错 markdown fence / 前后杂文本）；解析失败返回 null = 视为 critic 失败 */
function parseCriticOutput(raw: string): Omit<ReflectionVerdict, "maxRounds"> | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { passed?: unknown; issues?: unknown };
    if (typeof parsed.passed !== "boolean") return null;
    if (parsed.passed) return { passed: true, issues: [], feedback: "" };
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === "string" && i.trim().length > 0)
      : [];
    // 不通过但给不出具体问题：无可执行的回注意见，视为 critic 输出异常，跳过反思
    if (issues.length === 0) return null;
    return { passed: false, issues, feedback: buildFeedback(issues) };
  } catch {
    return null;
  }
}

/** 跑一票 critic；任何失败（调用抛错 / 解析失败）都返回 null——静默跳过，绝不影响主链路 */
async function runCritic(
  critic: LlmTransport,
  messages: LlmMessage[],
  draft: string,
  signal?: AbortSignal,
): Promise<Omit<ReflectionVerdict, "maxRounds"> | null> {
  try {
    const transcript = messages
      .map((m) => `【${m.role}】${contentToText(m.content).slice(0, CRITIC_TRANSCRIPT_MSG_MAX_CHARS)}`)
      .join("\n");
    const turn = await critic.complete({
      messages: [
        { role: "system", content: CRITIC_SYSTEM_PROMPT },
        {
          role: "user",
          content: `## 对话上下文\n${transcript}\n\n## 待复核的最终回答\n${draft}\n\n请只输出 JSON。`,
        },
      ],
      signal,
      withTools: false,
    });
    return parseCriticOutput(turn.content ?? "");
  } catch (err) {
    console.warn("[Reflection] critic 调用失败，跳过反思:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 反思装饰器：包装 complete，在「即将 done」的终轮结果上附着 critic verdict。
 * 默认关闭（enabled=false）时原样返回内层 transport，零开销。
 */
export function withReflection(transport: LlmTransport, opts: ReflectionOptions): LlmTransport {
  if (!opts.enabled) return transport;
  const critic = opts.criticTransport ?? createSyncTransport(opts.config, opts.criticModel);
  return {
    async complete(args) {
      const result = await transport.complete(args);
      // 「即将 done」感知：reactLoop 唯一的正常 done 进入点 = withTools 轮返回零 toolCalls
      // （sync 路径无 runQueues，不存在 followUp 抢先续轮的形态）。
      // 无正文内容（空回答）不审——没什么可评的，避免空转 critic。
      if (!args.withTools || result.toolCalls.length > 0 || !result.content?.trim()) {
        return result;
      }
      const verdict = await runCritic(critic, args.messages, result.content, args.signal);
      if (!verdict) return result;
      return { ...result, reflection: { ...verdict, maxRounds: opts.maxRounds } };
    },
  };
}
