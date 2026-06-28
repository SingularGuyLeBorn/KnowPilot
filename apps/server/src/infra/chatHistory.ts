/**
 * 聊天历史 → LLM messages 重建（含 tool call 多轮回放）
 */

import type { LlmMessage } from "./llmClient.js";
import { getActiveAssistantPayload } from "./messageVersions.js";

export interface StoredToolCall {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  kind?: "tool" | "thinking";
}

export function parseStoredToolCalls(raw: unknown): StoredToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc, i) => ({
    id: typeof tc?.id === "string" ? tc.id : `call_hist_${i}`,
    name: String(tc?.name ?? ""),
    args: tc?.args ?? {},
    result: tc?.result ?? null,
    kind: tc?.kind === "thinking" ? "thinking" : "tool",
  }));
}

export function buildLlmMessagesFromHistory(
  systemContent: string,
  history: Array<{ role: string; content: string; toolCalls?: unknown; toolResults?: unknown }>,
): LlmMessage[] {
  const messages: LlmMessage[] = [{ role: "system", content: systemContent }];

  for (const msg of history) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content });
      continue;
    }

    if (msg.role !== "assistant") continue;

    const active = getActiveAssistantPayload(msg);
    const tools = parseStoredToolCalls(active.toolCalls).filter((tc) => tc.kind !== "thinking");
    if (tools.length > 0) {
      messages.push({
        role: "assistant",
        content: active.content || null,
        tool_calls: tools.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        })),
      });
      for (const tc of tools) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify(tc.result ?? {}).slice(0, 16000),
        });
      }
    } else {
      messages.push({ role: "assistant", content: active.content });
    }
  }

  return messages;
}
