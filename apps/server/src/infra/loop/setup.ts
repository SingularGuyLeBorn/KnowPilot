/**
 * Agent loop 共享准备逻辑 — 从 agentRuntime 抽出，避免 reactLoop ↔ agentRuntime 循环依赖
 */

import type { LlmToolCall } from "../llmClient.js";
import { getAllowedToolsForTier } from "../swarmPermissionGuard.js";
import { TIER_DEFAULT_TOOLS } from "@knowpilot/shared";

/** 子 Agent 默认执行工具（带 native: 前缀，避免物化成空 → native:all）。单点定义在 shared（TIER_DEFAULT_TOOLS.sub） */
export const DEFAULT_SUBAGENT_TOOLS: readonly string[] = TIER_DEFAULT_TOOLS.sub;

/** 规范化 + 按 tier 裁剪工具列表 */
export function resolveToolsForAgentTier(tier: string | undefined | null, tools: string[]): string[] {
  const t = tier || "sub";
  let normalized = (tools ?? []).map((tool) => {
    if (tool.startsWith("native:") || tool.startsWith("skill:") || tool.startsWith("mcp:")) return tool;
    if (tool.includes(":")) return tool;
    return `native:${tool}`;
  });
  if (normalized.length === 0 && t === "sub") {
    normalized = [...DEFAULT_SUBAGENT_TOOLS];
  }
  return getAllowedToolsForTier(t, normalized);
}

export function parseToolCall(call: LlmToolCall): { name: string; args: Record<string, unknown> } {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    args = { raw: call.function.arguments };
  }
  return { name: call.function.name, args };
}
