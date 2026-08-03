/**
 * P1 Context Reset — 上下文窗口利用率监控与自动交接
 *
 * 当 LLM messages 估算 token 超过当前模型上下文窗口阈值时，
 * 把关键状态提取成结构化「交接文档」，清空旧消息，
 * 保留 system prompt + 交接文档 + 最近 user/assistant 消息，继续执行。
 */

import type { LlmContentPart, LlmMessage } from "../llmClient.js";

export interface ContextResetResult {
  reset: boolean;
  /** 重置后的消息列表（reset=false 时与输入相同） */
  messages: LlmMessage[];
  /** 交接文档 Markdown */
  handoffDoc: string;
  /** 重置前估算 token 数 */
  estimatedTokens: number;
  /** 触发阈值 */
  threshold: number;
  /** 模型上下文窗口 */
  contextWindow: number;
}

export interface ContextResetOptions {
  modelId: string;
  systemPrompt: string;
  /** 阈值比例，默认 0.4 */
  thresholdRatio?: number;
  /** 强制指定的上下文窗口（用于测试） */
  contextWindow?: number;
  /** 保留最近几条 user/assistant 消息，默认 1 */
  keepRecentTurns?: number;
}

/** 把 LlmMessage.content 统一转成纯文本（数组取 text part 拼接，null 视为空串） */
export function getMessageTextContent(content: LlmMessage["content"]): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is LlmContentPart & { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/** 简单字符估算：tokens ≈ totalChars / 3.5 */
export function estimateTokenCount(messages: LlmMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += getMessageTextContent(m.content).length;
    if (m.tool_calls) {
      chars += JSON.stringify(m.tool_calls).length;
    }
    if ((m as { reasoning_content?: string | null }).reasoning_content) {
      chars += (m as { reasoning_content: string }).reasoning_content.length;
    }
  }
  return Math.ceil(chars / 3.5);
}

/** 已知模型上下文窗口（可按需扩展）；未知模型回退 81920 */
export function resolveContextWindow(modelId: string): number {
  const lower = modelId.toLowerCase();
  // DeepSeek
  if (lower.includes("deepseek-v4")) return 131_072;
  if (lower.includes("deepseek-v3")) return 64_000;
  if (lower.includes("deepseek-r1") || lower.includes("deepseek-reasoner")) return 64_000;
  // Moonshot / 01 AI
  if (lower.includes("kimi-k2") || lower.includes("kimi-k1.5")) return 256_000;
  if (lower.includes("kimi")) return 200_000;
  // OpenAI
  if (lower.includes("gpt-4o") || lower.includes("gpt-4-turbo")) return 128_000;
  if (lower.includes("gpt-4")) return 8_192;
  if (lower.includes("gpt-3.5-turbo")) return 16_384;
  // Anthropic
  if (lower.includes("claude-3-opus") || lower.includes("claude-3-5-sonnet")) return 200_000;
  if (lower.includes("claude-3")) return 200_000;
  if (lower.includes("claude")) return 100_000;
  // Google
  if (lower.includes("gemini-1.5") || lower.includes("gemini-2")) return 1_000_000;
  if (lower.includes("gemini")) return 128_000;
  // 默认：约 32K token（字符 81920）
  return 81_920;
}

function getThreshold(contextWindow: number, ratio?: number): number {
  const r = ratio ?? getEnvThresholdRatio();
  return Math.max(1000, Math.floor(contextWindow * Math.min(0.95, Math.max(0.1, r))));
}

function getEnvThresholdRatio(): number {
  const raw = process.env.AGENT_CONTEXT_RESET_THRESHOLD;
  if (!raw) return 0.4;
  const n = Number(raw);
  if (Number.isNaN(n)) return 0.4;
  return Math.min(0.95, Math.max(0.1, n));
}

/** 从 system prompt 提取硬性约束（含「禁止」「必须」「不得」的行） */
function extractConstraints(systemPrompt: string): string[] {
  return systemPrompt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && /[禁止必须不得不可严禁]/u.test(l))
    .slice(0, 20);
}

/** 提取原始目标：优先第一条用户消息，否则 system prompt 首段 */
function extractGoal(messages: LlmMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) return getMessageTextContent(firstUser.content).slice(0, 400);
  const firstSystem = messages.find((m) => m.role === "system");
  if (firstSystem) {
    return getMessageTextContent(firstSystem.content).split("\n").find((l) => l.trim())?.slice(0, 400) ?? "完成当前任务";
  }
  return "完成当前任务";
}

/** 汇总最近 3-5 轮关键进展 */
function buildRecentSummary(messages: LlmMessage[], maxRounds = 5): string[] {
  const turns: string[] = [];
  let rounds = 0;
  for (let i = messages.length - 1; i >= 0 && rounds < maxRounds; i--) {
    const m = messages[i];
    if (m.role === "assistant" || m.role === "tool") {
      const prefix = m.role === "assistant" ? "Assistant" : "Tool";
      const text = getMessageTextContent(m.content);
      turns.unshift(`${prefix}: ${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`);
      if (m.role === "assistant") rounds++;
    }
  }
  return turns.slice(-maxRounds);
}

function buildHandoffDoc(opts: {
  goal: string;
  constraints: string[];
  recentSummary: string[];
}): string {
  const lines = ["## 上下文交接（Context Reset）", ""];
  lines.push(`**目标**：${opts.goal}`, "");

  if (opts.constraints.length > 0) {
    lines.push("**必须遵守的硬性约束**：");
    for (const c of opts.constraints) lines.push(`- ${c}`);
    lines.push("");
  }

  lines.push("**待办**：", "- （未显式维护，请基于目标与最近进展继续推进）", "");

  if (opts.recentSummary.length > 0) {
    lines.push("**最近进展**：");
    for (const s of opts.recentSummary) lines.push(`- ${s}`);
    lines.push("");
  }

  lines.push("**待回答问题**：", "- 无");
  return lines.join("\n");
}

/** 保留 system 与最近的 user/assistant 消息 */
function buildResetMessages(
  messages: LlmMessage[],
  handoffDoc: string,
  keepRecentTurns: number,
): LlmMessage[] {
  const system = messages.find((m) => m.role === "system");
  const next: LlmMessage[] = [];
  if (system) next.push({ ...system });
  next.push({ role: "user", content: handoffDoc });

  // 保留最近 keepRecentTurns 组 user→assistant 对话
  const recent: LlmMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && recent.length < keepRecentTurns * 2; i--) {
    const m = messages[i];
    if (m.role === "user" || m.role === "assistant") {
      recent.unshift({ ...m });
    }
  }
  // 若 recent 不完整（只有 assistant 没有 user），截断到最近 user 之前
  const firstUserIdx = recent.findIndex((m) => m.role === "user");
  const finalRecent = firstUserIdx > 0 ? recent.slice(firstUserIdx) : recent;
  next.push(...finalRecent);

  return next;
}

export function shouldResetContext(
  messages: LlmMessage[],
  modelId: string,
  ratio?: number,
  explicitContextWindow?: number,
): {
  estimatedTokens: number;
  threshold: number;
  contextWindow: number;
  reset: boolean;
} {
  const contextWindow = explicitContextWindow ?? resolveContextWindow(modelId);
  const threshold = getThreshold(contextWindow, ratio);
  const estimatedTokens = estimateTokenCount(messages);
  return { estimatedTokens, threshold, contextWindow, reset: estimatedTokens > threshold };
}

export function resetContext(
  messages: LlmMessage[],
  opts: ContextResetOptions,
): ContextResetResult {
  const { estimatedTokens, threshold, contextWindow } = shouldResetContext(
    messages,
    opts.modelId,
    opts.thresholdRatio,
    opts.contextWindow,
  );

  if (estimatedTokens <= threshold) {
    return {
      reset: false,
      messages,
      handoffDoc: "",
      estimatedTokens,
      threshold,
      contextWindow,
    };
  }

  const goal = extractGoal(messages);
  const constraints = extractConstraints(opts.systemPrompt);
  const recentSummary = buildRecentSummary(messages, 5);
  const handoffDoc = buildHandoffDoc({ goal, constraints, recentSummary });
  const nextMessages = buildResetMessages(
    messages,
    handoffDoc,
    Math.max(0, opts.keepRecentTurns ?? 1),
  );

  return {
    reset: true,
    messages: nextMessages,
    handoffDoc,
    estimatedTokens,
    threshold,
    contextWindow,
  };
}
