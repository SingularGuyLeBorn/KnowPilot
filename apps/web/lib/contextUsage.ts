/**
 * 会话上下文占用估算 — Header 胶囊 + 详情 Popover
 */

import type { ChatMessage } from "@knowpilot/shared";
import { COMPACT_CHAR_THRESHOLD, CONTEXT_TOKEN_HINT, formatTokenCount } from "@/lib/tokenBudget";

export interface ContextUsageSegment {
  id: string;
  label: string;
  tokens: number;
  color: string;
}

export interface ContextUsageMessageInfo {
  id: string;
  role: string;
  tokens: number;
  preview: string;
  isSummarized: boolean;
  createdAt?: string | Date;
}

export interface ContextUsageSnapshot {
  segments: ContextUsageSegment[];
  estimatedTotal: number;
  ratio: number;
  /** 相对 Auto-Compact 字符阈值的进度 0–1 */
  compactRatio: number;
  inputTokens: number;
  outputTokens: number;
  maxContextTokens: number;
  compactCharThreshold: number;
  topMessages: ContextUsageMessageInfo[];
  compression: {
    summarizedCount: number;
    originalCount: number;
    summarizedTokens: number;
    originalTokens: number;
    hasAutoCompacted: boolean;
    summaryPreview?: string;
  };
}

const SUMMARY_MARKER = "[此前对话摘要 — 自动压缩]";

function charsToTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

export function buildContextUsage(params: {
  messages: ChatMessage[];
  systemPrompt: string;
  maxContextTokens?: number;
  compactCharThreshold?: number;
  /** 会话表持久化的摘要（优先于消息内标记） */
  contextSummary?: string | null;
}): ContextUsageSnapshot {
  const maxContextTokens = params.maxContextTokens ?? CONTEXT_TOKEN_HINT;
  const compactCharThreshold = params.compactCharThreshold ?? COMPACT_CHAR_THRESHOLD;
  const persistedSummary = params.contextSummary?.trim() || "";

  const systemChars = params.systemPrompt.length;
  let conversationChars = 0;
  let toolChars = 0;
  let summaryChars = persistedSummary.length;

  for (const m of params.messages) {
    const content = m.content ?? "";
    if (content.includes(SUMMARY_MARKER)) {
      summaryChars += content.length;
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      conversationChars += content.length + 120;
    }
    if (m.toolCalls) {
      try {
        toolChars += JSON.stringify(m.toolCalls).length;
      } catch {
        toolChars += 256;
      }
    }
    if (m.toolResults) {
      try {
        toolChars += JSON.stringify(m.toolResults).length;
      } catch {
        toolChars += 256;
      }
    }
  }

  const segments: ContextUsageSegment[] = [
    { id: "system", label: "System prompt", tokens: charsToTokens(systemChars), color: "#9a9588" },
    { id: "tools", label: "工具调用", tokens: charsToTokens(toolChars), color: "#b8a090" },
    { id: "summary", label: "摘要对话", tokens: charsToTokens(summaryChars), color: "#c9b8b3" },
    { id: "conversation", label: "对话消息", tokens: charsToTokens(conversationChars), color: "#a89080" },
  ].filter((s) => s.tokens > 0);

  const estimatedTotal = segments.reduce((sum, s) => sum + s.tokens, 0);
  const ratio = Math.min(1, estimatedTotal / maxContextTokens);
  const estimatedChars = systemChars + conversationChars + toolChars + summaryChars;
  const compactRatio = Math.min(1, estimatedChars / compactCharThreshold);

  const topMessages: ContextUsageMessageInfo[] = params.messages
    .map((m) => {
      const content = m.content ?? "";
      const isSummarized = content.includes(SUMMARY_MARKER);
      const msgChars =
        content.length +
        (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0) +
        (m.toolResults ? JSON.stringify(m.toolResults).length : 0);
      return {
        id: m.id,
        role: m.role,
        tokens: charsToTokens(msgChars),
        preview: content.replace(SUMMARY_MARKER, "").trim().slice(0, 80) || "(空)",
        isSummarized,
        createdAt: m.createdAt,
      };
    })
    .filter((m) => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  let summarizedCount = persistedSummary ? 1 : 0;
  let originalCount = 0;
  let summarizedTokens = persistedSummary ? charsToTokens(persistedSummary.length) : 0;
  let originalTokens = 0;
  for (const m of params.messages) {
    const content = m.content ?? "";
    const isSummarized = content.includes(SUMMARY_MARKER);
    const msgChars =
      content.length +
      (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0) +
      (m.toolResults ? JSON.stringify(m.toolResults).length : 0);
    const tokens = charsToTokens(msgChars);
    if (isSummarized) {
      summarizedCount++;
      summarizedTokens += tokens;
    } else {
      originalCount++;
      originalTokens += tokens;
    }
  }

  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of params.messages) {
    if (m.tokenUsage) {
      inputTokens += m.tokenUsage.prompt ?? 0;
      outputTokens += m.tokenUsage.completion ?? 0;
    }
  }

  if (inputTokens === 0 && outputTokens === 0 && estimatedTotal > 0) {
    inputTokens = estimatedTotal;
  }

  return {
    segments,
    estimatedTotal,
    ratio,
    compactRatio,
    inputTokens,
    outputTokens,
    maxContextTokens,
    compactCharThreshold,
    topMessages,
    compression: {
      summarizedCount,
      originalCount,
      summarizedTokens,
      originalTokens,
      hasAutoCompacted: !!persistedSummary || summarizedCount > 0,
      summaryPreview: persistedSummary ? persistedSummary.slice(0, 160) : undefined,
    },
  };
}

export { formatTokenCount };
