/**
 * Agent 流式聊天客户端 — SSE over fetch
 */

import type { ChatConfigInput } from "@knowpilot/shared";
import { authHeaders } from "@/lib/auth";

export interface AgentChatStreamInput {
  sessionId?: string;
  agentId?: string;
  message?: string;
  attachments?: Array<{
    name: string;
    mimeType: string;
    previewUrl: string;
    extractedText?: string;
    source?: "ocr" | "vision" | "user";
  }>;
  model?: string;
  config?: ChatConfigInput;
  regenerate?: boolean;
  regenerateUserMessageId?: string;
  retryFromMessageId?: string;
  editMessageId?: string;
  editContent?: string;
  skillId?: string;
}

export interface AgentStreamDone {
  sessionId: string;
  agentId: string;
  content: string;
  toolCalls: Array<{ id: string; name: string; args: unknown; result: unknown; kind?: string }>;
  model: string;
  provider: string;
  roundsUsed: number;
  assistantMessageId?: string;
  versionIndex?: number;
  versionCount?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

export interface AgentStreamCallbacks {
  onRoundStart?: (round: number) => void;
  onThinking?: (delta: string) => void;
  onToken?: (delta: string) => void;
  onToolStart?: (name: string, args: unknown, round: number, toolCallId: string) => void;
  onToolEnd?: (name: string, result: unknown, round: number, hint: string | undefined, toolCallId: string) => void;
  onDone?: (data: AgentStreamDone) => void | Promise<void>;
  onError?: (message: string, sessionId?: string, suggestion?: string) => void | Promise<void>;
}

async function parseSseBlock(block: string, callbacks: AgentStreamCallbacks) {
  const lines = block.split("\n");
  let eventType = "message";
  let dataLine = "";
  for (const line of lines) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return;
  try {
    const payload = JSON.parse(dataLine);
    switch (eventType) {
      case "round_start":
        callbacks.onRoundStart?.(payload.round ?? 1);
        break;
      case "thinking":
        callbacks.onThinking?.(payload.delta ?? "");
        break;
      case "token":
        callbacks.onToken?.(payload.delta ?? "");
        break;
      case "tool_start":
        callbacks.onToolStart?.(payload.name, payload.args, payload.round ?? 1, payload.toolCallId ?? "");
        break;
      case "tool_end":
        callbacks.onToolEnd?.(payload.name, payload.result, payload.round ?? 1, payload.hint, payload.toolCallId ?? "");
        break;
      case "done":
        await callbacks.onDone?.(payload as AgentStreamDone);
        break;
      case "error":
        await callbacks.onError?.(payload.message, payload.sessionId, payload.suggestion);
        break;
    }
  } catch {
    // ignore malformed chunk
  }
}

export async function streamAgentChat(
  input: AgentChatStreamInput,
  callbacks: AgentStreamCallbacks,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/agent/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
    signal,
  });

  if (!res.ok || !res.body) {
    callbacks.onError?.(`流式请求失败 HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const block of parts) {
      if (block.trim()) await parseSseBlock(block, callbacks);
    }
  }

  if (buffer.trim()) await parseSseBlock(buffer, callbacks);
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}
