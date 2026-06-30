/**
 * 会话上下文占用估算 — Header 胶囊 + 详情 Popover
 */

import type { ChatMessage } from "@knowpilot/shared";
import { CONTEXT_TOKEN_HINT, formatTokenCount } from "@/lib/tokenBudget";

export interface ContextUsageSegment {
  id: string;
  label: string;
  tokens: number;
  color: string;
}

export interface ContextUsageSnapshot {
  segments: ContextUsageSegment[];
  estimatedTotal: number;
  ratio: number;
  inputTokens: number;
  outputTokens: number;
  maxContextTokens: number;
}

const SUMMARY_MARKER = "[此前对话摘要 — 自动压缩]";

function charsToTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

export function buildContextUsage(params: {
  messages: ChatMessage[];
  systemPrompt: string;
  maxContextTokens?: number;
}): ContextUsageSnapshot {
  const maxContextTokens = params.maxContextTokens ?? CONTEXT_TOKEN_HINT;

  const systemChars = params.systemPrompt.length;
  let conversationChars = 0;
  let toolChars = 0;
  let summaryChars = 0;

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
    inputTokens,
    outputTokens,
    maxContextTokens,
  };
}

export { formatTokenCount };
