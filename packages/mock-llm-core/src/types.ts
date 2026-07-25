/**
 * LLM 协议类型 — 单源定义，server 与 apps/mock-llm 共用。
 *
 * 从 apps/server/src/infra/llmClient.ts 抽出，避免 server / mock 服务两份定义。
 * server 的 llmClient.ts 改为 `export type { ... } from "@knowpilot/mock-llm-core"` 再导出，
 * 全仓 import 路径不变。
 */

import type { ReasoningEffort } from "@knowpilot/shared";

export interface LlmContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | LlmContentPart[] | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LlmToolCall[];
  /** DeepSeek V4 思考链 — 工具调用回合必须原样回传 */
  reasoning_content?: string | null;
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmCompletionResult {
  content: string | null;
  reasoningContent?: string | null;
  toolCalls: LlmToolCall[];
  tokenUsage?: { prompt: number; completion: number; total: number };
  finishReason: string | null;
  model: string;
  provider: string;
}

export interface LlmRequestOptions {
  temperature?: number;
  maxTokens?: number;
  enableReasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
}

export interface StreamChunk {
  type: "token" | "reasoning" | "tool_calls";
  delta?: string;
  toolCalls?: LlmToolCall[];
  finishReason?: string | null;
  model?: string;
  provider?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
}
