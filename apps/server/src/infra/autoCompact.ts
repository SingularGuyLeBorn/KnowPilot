/**
 * 对话上下文自动压缩 — micro-compact → memory flush → macro-compact
 *
 * - 阈值：模型 context window × triggerRatio（可配置）
 * - 摘要持久化在 ChatSession.contextSummary
 * - 失败时降级为裁剪最早消息（保留最近 keepRecent）
 */

import type { AppConfig } from "./config.js";
import { chatCompletion, type LlmMessage } from "./llmClient.js";
import type { ServiceContainer } from "./serviceContainer.js";
import {
  DEFAULT_COMPACT_KEEP_RECENT,
  DEFAULT_COMPACT_TRIGGER_RATIO,
  DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  resolveCompactCharThreshold,
} from "@knowpilot/shared";
import { flushMemoriesBeforeCompact } from "./memoryFlush.js";

/** @deprecated 兼容旧检测；新摘要使用 buildCompactBoundaryMarker */
export const SUMMARY_MARKER = "[此前对话摘要 — 自动压缩]";
export const COMPACT_BOUNDARY_PREFIX = "[kp-compact-boundary:";

export const DEFAULT_COMPACT_CHAR_THRESHOLD = resolveCompactCharThreshold(
  "deepseek-v4-flash",
  DEFAULT_COMPACT_TRIGGER_RATIO,
);

export { DEFAULT_COMPACT_KEEP_RECENT };

export const MICRO_COMPACT_TRUNCATED = "[tool result truncated by micro-compact]";

export function buildCompactBoundaryMarker(generation: number): string {
  const ts = new Date().toISOString();
  return `${COMPACT_BOUNDARY_PREFIX}v${generation}@${ts}]`;
}

export function isCompactSummaryContent(content: string): boolean {
  return content.includes(SUMMARY_MARKER) || content.includes(COMPACT_BOUNDARY_PREFIX);
}

export function getCompactSettings(config: AppConfig) {
  const compact = config.compact ?? ({} as AppConfig["compact"]);
  return {
    enabled: compact.enabled !== false,
    triggerRatio: Math.min(0.95, Math.max(0.05, compact.triggerRatio ?? DEFAULT_COMPACT_TRIGGER_RATIO)),
    charThreshold: Math.max(8_000, compact.charThreshold ?? DEFAULT_COMPACT_CHAR_THRESHOLD),
    keepRecent: Math.max(2, compact.keepRecent ?? DEFAULT_COMPACT_KEEP_RECENT),
    microCompactEnabled: compact.microCompact?.enabled !== false,
    microCompactToolMaxChars: Math.max(
      500,
      compact.microCompact?.toolResultMaxChars ?? DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS,
    ),
    memoryFlushEnabled: compact.memoryFlush?.enabled !== false,
  };
}

export function resolveCompactThresholdForModel(config: AppConfig, modelId: string): number {
  const settings = getCompactSettings(config);
  return resolveCompactCharThreshold(modelId, settings.triggerRatio);
}

export function estimateChars(messages: LlmMessage[]): number {
  return messages.reduce((sum, m) => {
    const contentLen = typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length;
    const toolsLen = m.tool_calls ? JSON.stringify(m.tool_calls).length : 0;
    return sum + contentLen + toolsLen + 200;
  }, 0);
}

/** micro-compact：清超大 tool result，延缓触顶（学 Claude Code） */
export function microCompactMessages(messages: LlmMessage[], toolResultMaxChars: number): LlmMessage[] {
  return messages.map((m) => {
    if (m.role !== "tool" || typeof m.content !== "string") return m;
    if (m.content.length <= toolResultMaxChars) return m;
    return {
      ...m,
      content:
        m.content.slice(0, toolResultMaxChars) +
        `\n\n${MICRO_COMPACT_TRUNCATED}（原 ${m.content.length} 字符）`,
    };
  });
}

function buildSummaryPair(summaryText: string, generation: number): LlmMessage[] {
  const boundary = buildCompactBoundaryMarker(generation);
  return [
    {
      role: "user",
      content: `${boundary}\n${SUMMARY_MARKER}\n${summaryText}`,
    },
    { role: "assistant", content: "已阅读摘要，继续基于上述上下文协助你。" },
  ];
}

function trimOldest(messages: LlmMessage[], keepRecent: number): LlmMessage[] {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= keepRecent) return messages;
  return [...system, ...rest.slice(-keepRecent)];
}

function nextCompactGeneration(existingSummary?: string | null): number {
  if (!existingSummary?.trim()) return 1;
  const matches = existingSummary.match(/v(\d+)@/g);
  if (!matches?.length) return 2;
  const nums = matches.map((m) => parseInt(m.replace(/[^\d]/g, ""), 10)).filter(Number.isFinite);
  return (nums.length ? Math.max(...nums) : 1) + 1;
}

export interface CompactResult {
  messages: LlmMessage[];
  compacted: boolean;
  /** 需要持久化到 ChatSession.contextSummary 的文本（新建或更新） */
  summaryText?: string;
  /** 复用了已有摘要，未再调 LLM */
  reused?: boolean;
  /** compact 前 memory flush 写入条数 */
  memoriesFlushed?: number;
  /** 实际使用的字符阈值 */
  charThresholdUsed?: number;
}

export interface CompactOptions {
  existingSummary?: string | null;
  flushContext?: {
    services: ServiceContainer;
    sessionId?: string;
  };
}

/**
 * @param existingSummary 会话已持久化的摘要；有则优先复用，超阈值再二次压缩
 */
export async function maybeCompactMessages(
  config: AppConfig,
  messages: LlmMessage[],
  model: string,
  options?: CompactOptions,
): Promise<CompactResult> {
  const settings = getCompactSettings(config);
  if (!settings.enabled) return { messages, compacted: false };

  const charThreshold = resolveCompactThresholdForModel(config, model);
  let working = settings.microCompactEnabled
    ? microCompactMessages(messages, settings.microCompactToolMaxChars)
    : [...messages];

  const system = working.filter((m) => m.role === "system");
  const rest = working.filter((m) => m.role !== "system");
  const existing = options?.existingSummary?.trim() || "";
  const generation = nextCompactGeneration(existing);

  if (existing) {
    const recent = rest.length > settings.keepRecent ? rest.slice(-settings.keepRecent) : rest;
    const reusedMessages: LlmMessage[] = [...system, ...buildSummaryPair(existing, generation - 1), ...recent];
    if (estimateChars(reusedMessages) < charThreshold) {
      return {
        messages: reusedMessages,
        compacted: true,
        summaryText: existing,
        reused: true,
        charThresholdUsed: charThreshold,
      };
    }
  }

  if (estimateChars(working) < charThreshold && !existing) {
    return { messages: working, compacted: false, charThresholdUsed: charThreshold };
  }

  if (rest.length <= settings.keepRecent + 2) {
    return { messages: working, compacted: false, charThresholdUsed: charThreshold };
  }

  const toSummarize = rest.slice(0, -settings.keepRecent);
  const recent = rest.slice(-settings.keepRecent);

  const transcriptParts: string[] = [];
  if (existing) transcriptParts.push(`[已有摘要]\n${existing}`);
  for (const m of toSummarize) {
    const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : m.role;
    const text = (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")).slice(0, 2000);
    transcriptParts.push(`[${role}]\n${text}`);
  }
  const transcript = transcriptParts.join("\n\n---\n\n");

  let memoriesFlushed = 0;
  if (settings.memoryFlushEnabled && options?.flushContext?.services) {
    memoriesFlushed = await flushMemoriesBeforeCompact(
      config,
      options.flushContext.services,
      transcript,
      model,
      { existingSummary: existing },
    );
  }

  try {
    const summary = await chatCompletion({
      config,
      model,
      messages: [
        {
          role: "system",
          content:
            "你是 KnowPilot 对话摘要助手。将以下历史对话压缩为简洁的中文摘要，保留：用户目标、已做决策、工具结果要点、未完成任务。不要编造。",
        },
        { role: "user", content: `请摘要以下对话历史：\n\n${transcript.slice(0, 32000)}` },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });

    const summaryBody = summary.content?.trim();
    if (!summaryBody) {
      return {
        messages: trimOldest(working, settings.keepRecent),
        compacted: true,
        memoriesFlushed,
        charThresholdUsed: charThreshold,
      };
    }

    const boundary = buildCompactBoundaryMarker(generation);
    const summaryText = summaryBody;
    const compactedMessages: LlmMessage[] = [...system, ...buildSummaryPair(summaryBody, generation), ...recent];
    console.log(
      `[AutoCompact] ${toSummarize.length} 条消息已压缩（原 ${estimateChars(messages)} → ${estimateChars(compactedMessages)} 字符，阈值 ${charThreshold}，flush ${memoriesFlushed}）`,
    );
    return {
      messages: compactedMessages,
      compacted: true,
      summaryText,
      memoriesFlushed,
      charThresholdUsed: charThreshold,
    };
  } catch (err) {
    console.warn("[AutoCompact] 压缩失败，降级裁剪最早消息:", err instanceof Error ? err.message : err);
    return {
      messages: trimOldest(working, settings.keepRecent),
      compacted: true,
      memoriesFlushed,
      charThresholdUsed: charThreshold,
    };
  }
}

/** 手动压缩：基于完整历史生成摘要文本（供 tRPC session.compact） */
export async function compactSessionHistory(
  config: AppConfig,
  messages: LlmMessage[],
  model: string,
  existingSummary?: string | null,
  flushContext?: CompactOptions["flushContext"],
): Promise<{ summaryText: string; compacted: boolean; memoriesFlushed?: number }> {
  const base = getCompactSettings(config);
  const forced = await maybeCompactMessages(
    {
      ...config,
      compact: {
        enabled: true,
        triggerRatio: base.triggerRatio,
        charThreshold: 1,
        keepRecent: base.keepRecent,
        microCompact: {
          enabled: base.microCompactEnabled,
          toolResultMaxChars: base.microCompactToolMaxChars,
        },
        memoryFlush: {
          enabled: base.memoryFlushEnabled,
          maxFacts: config.compact?.memoryFlush?.maxFacts ?? 5,
        },
      },
    },
    messages,
    model,
    { existingSummary, flushContext },
  );
  if (forced.summaryText) {
    return { summaryText: forced.summaryText, compacted: true, memoriesFlushed: forced.memoriesFlushed };
  }
  return { summaryText: existingSummary?.trim() || "", compacted: false };
}

/** 供 chatHistory / agentStream 对齐的 tool result 截断上限 */
export function resolveMicroCompactToolMaxChars(config: AppConfig): number {
  return getCompactSettings(config).microCompactToolMaxChars;
}

/** 默认模型窗口 token（前端估算 fallback） */
export function getDefaultContextWindowTokens(): number {
  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}
