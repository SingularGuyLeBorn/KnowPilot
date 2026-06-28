/**
 * Chat Token 预算估算 — 用于 Header / 设置 Panel（Codex 式上下文可见性）
 */

import type { ChatMessage } from "@knowpilot/shared";

/** 与 autoCompact.ts COMPACT_CHAR_THRESHOLD 对齐（字符 ≈ token×4 粗算） */
export const COMPACT_CHAR_THRESHOLD = 48_000;
export const CONTEXT_TOKEN_HINT = 128_000;

export interface TokenBudgetSnapshot {
  sessionTokens: number;
  lastRoundTokens: number;
  maxOutputTokens: number;
  estimatedContextChars: number;
  compactRatio: number;
}

export function sumMessageTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.tokenUsage?.total ?? 0), 0);
}

/** 粗算上下文体积（字符），用于 compact 进度条 */
export function estimateContextChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.content?.length ?? 0) + 120, 0);
}

export function buildTokenBudget(
  messages: ChatMessage[],
  maxOutputTokens: number,
  lastRoundTokens = 0,
): TokenBudgetSnapshot {
  const sessionTokens = sumMessageTokens(messages);
  const estimatedContextChars = estimateContextChars(messages);
  const compactRatio = Math.min(1, estimatedContextChars / COMPACT_CHAR_THRESHOLD);
  return {
    sessionTokens,
    lastRoundTokens,
    maxOutputTokens,
    estimatedContextChars,
    compactRatio,
  };
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
