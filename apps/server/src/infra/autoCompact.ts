/**
 * 对话上下文自动压缩 — 长对话在 Agent 循环前摘要旧消息
 *
 * - 摘要持久化在 ChatSession.contextSummary，避免每轮重复调 LLM
 * - 失败时降级为裁剪最早消息（保留最近 keepRecent）
 */

import type { AppConfig } from "./config.js";
import { chatCompletion, type LlmMessage } from "./llmClient.js";

export const SUMMARY_MARKER = "[此前对话摘要 — 自动压缩]";

/** 与前端 tokenBudget / contextUsage 对齐的默认值 */
export const DEFAULT_COMPACT_CHAR_THRESHOLD = 48_000;
export const DEFAULT_COMPACT_KEEP_RECENT = 8;

export function getCompactSettings(config: AppConfig) {
  return {
    enabled: config.compact?.enabled !== false,
    charThreshold: Math.max(8_000, config.compact?.charThreshold ?? DEFAULT_COMPACT_CHAR_THRESHOLD),
    keepRecent: Math.max(2, config.compact?.keepRecent ?? DEFAULT_COMPACT_KEEP_RECENT),
  };
}

export function estimateChars(messages: LlmMessage[]): number {
  return messages.reduce((sum, m) => {
    const contentLen = typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length;
    const toolsLen = m.tool_calls ? JSON.stringify(m.tool_calls).length : 0;
    return sum + contentLen + toolsLen + 200;
  }, 0);
}

function buildSummaryPair(summaryText: string): LlmMessage[] {
  return [
    { role: "user", content: `${SUMMARY_MARKER}\n${summaryText}` },
    { role: "assistant", content: "已阅读摘要，继续基于上述上下文协助你。" },
  ];
}

function trimOldest(messages: LlmMessage[], keepRecent: number): LlmMessage[] {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= keepRecent) return messages;
  return [...system, ...rest.slice(-keepRecent)];
}

export interface CompactResult {
  messages: LlmMessage[];
  compacted: boolean;
  /** 需要持久化到 ChatSession.contextSummary 的文本（新建或更新） */
  summaryText?: string;
  /** 复用了已有摘要，未再调 LLM */
  reused?: boolean;
}

/**
 * @param existingSummary 会话已持久化的摘要；有则优先复用，超阈值再二次压缩
 */
export async function maybeCompactMessages(
  config: AppConfig,
  messages: LlmMessage[],
  model: string,
  options?: { existingSummary?: string | null },
): Promise<CompactResult> {
  const { enabled, charThreshold, keepRecent } = getCompactSettings(config);
  if (!enabled) return { messages, compacted: false };

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const existing = options?.existingSummary?.trim() || "";

  // 已有摘要：先拼「摘要 + 最近消息」，够用则直接复用，避免重复 LLM
  if (existing) {
    const recent = rest.length > keepRecent ? rest.slice(-keepRecent) : rest;
    const reusedMessages: LlmMessage[] = [...system, ...buildSummaryPair(existing), ...recent];
    if (estimateChars(reusedMessages) < charThreshold) {
      return { messages: reusedMessages, compacted: true, summaryText: existing, reused: true };
    }
    // 仍超阈值：把旧摘要 + 被挤出的中间段再压一次
  }

  if (estimateChars(messages) < charThreshold && !existing) {
    return { messages, compacted: false };
  }

  if (rest.length <= keepRecent + 2) {
    return { messages, compacted: false };
  }

  const toSummarize = rest.slice(0, -keepRecent);
  const recent = rest.slice(-keepRecent);

  const transcriptParts: string[] = [];
  if (existing) {
    transcriptParts.push(`[已有摘要]\n${existing}`);
  }
  for (const m of toSummarize) {
    const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : m.role;
    const text = (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")).slice(0, 2000);
    transcriptParts.push(`[${role}]\n${text}`);
  }
  const transcript = transcriptParts.join("\n\n---\n\n");

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

    const summaryText = summary.content?.trim();
    if (!summaryText) {
      return { messages: trimOldest(messages, keepRecent), compacted: true };
    }

    const compactedMessages: LlmMessage[] = [...system, ...buildSummaryPair(summaryText), ...recent];
    console.log(
      `[AutoCompact] ${toSummarize.length} 条消息已压缩为摘要（原 ${estimateChars(messages)} → ${estimateChars(compactedMessages)} 字符）`,
    );
    return { messages: compactedMessages, compacted: true, summaryText };
  } catch (err) {
    console.warn("[AutoCompact] 压缩失败，降级裁剪最早消息:", err instanceof Error ? err.message : err);
    return { messages: trimOldest(messages, keepRecent), compacted: true };
  }
}

/** 手动压缩：基于完整历史生成摘要文本（供 tRPC session.compact） */
export async function compactSessionHistory(
  config: AppConfig,
  messages: LlmMessage[],
  model: string,
  existingSummary?: string | null,
): Promise<{ summaryText: string; compacted: boolean }> {
  const forced = await maybeCompactMessages(
    {
      ...config,
      compact: {
        ...getCompactSettings(config),
        // 手动触发：把阈值降到极低，强制走压缩路径（若消息足够多）
        charThreshold: 1,
        enabled: true,
      },
    },
    messages,
    model,
    { existingSummary },
  );
  if (forced.summaryText) {
    return { summaryText: forced.summaryText, compacted: true };
  }
  return { summaryText: existingSummary?.trim() || "", compacted: false };
}
