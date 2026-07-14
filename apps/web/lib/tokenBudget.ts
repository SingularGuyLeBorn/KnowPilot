/**
 * Chat Token 预算估算 — 用于 Header / 设置 Panel（Codex 式上下文可见性）
 */

import type { ChatMessage } from "@knowpilot/shared";
import {
  DEFAULT_COMPACT_TRIGGER_RATIO,
  DEFAULT_LLM_MODEL,
  resolveCompactCharThreshold,
  resolveModelContextWindowTokens,
} from "@knowpilot/shared";

/** @deprecated 使用 resolveCompactCharThreshold(modelId) */
export const COMPACT_CHAR_THRESHOLD = resolveCompactCharThreshold(DEFAULT_LLM_MODEL);

export const DEFAULT_COMPACT_TRIGGER_RATIO_EXPORT = DEFAULT_COMPACT_TRIGGER_RATIO;

export interface TokenBudgetSnapshot {
  sessionTokens: number;
  lastRoundTokens: number;
  maxOutputTokens: number;
  estimatedContextChars: number;
  /** 相对 Auto-Compact 触发阈值的进度 0–1 */
  compactRatio: number;
  /** 当前模型 context window（token） */
  maxContextTokens: number;
  /** 触发 macro-compact 的字符阈值 */
  compactCharThreshold: number;
  /** 配置的触发比例 */
  compactTriggerRatio: number;
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
  // 显式标注 string：DEFAULT_LLM_MODEL 是字面量类型，默认参数推断会把形参收窄成字面量，
  // 导致传入 ChatSessionConfig.model（string）时类型报错（W8 常量化后的回归）。
  modelId: string = DEFAULT_LLM_MODEL,
  triggerRatio = DEFAULT_COMPACT_TRIGGER_RATIO,
): TokenBudgetSnapshot {
  const sessionTokens = sumMessageTokens(messages);
  const estimatedContextChars = estimateContextChars(messages);
  const maxContextTokens = resolveModelContextWindowTokens(modelId);
  const compactCharThreshold = resolveCompactCharThreshold(modelId, triggerRatio);
  const compactRatio = Math.min(1, estimatedContextChars / compactCharThreshold);
  return {
    sessionTokens,
    lastRoundTokens,
    maxOutputTokens,
    estimatedContextChars,
    compactRatio,
    maxContextTokens,
    compactCharThreshold,
    compactTriggerRatio: triggerRatio,
  };
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
