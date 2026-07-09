/**
 * Agent 流式聊天客户端 — SSE over fetch，支持断线续传与自动重连。
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
  source?: "user" | "super" | "manager" | "sub" | "system";
  /** 额外元数据，会作为用户消息的 toolResults 持久化（如子 Agent 名字） */
  toolResults?: Record<string, unknown>;
  /** 断线续传：从该事件 ID 之后开始接收 */
  resumeAfter?: number;
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
  onSessionStart?: (sessionId: string) => void;
  onRoundStart?: (round: number) => void;
  onThinking?: (delta: string) => void;
  onToken?: (delta: string) => void;
  onIntermediateContent?: (content: string, round: number) => void;
  onToolStart?: (name: string, args: unknown, round: number, toolCallId: string) => void;
  onToolEnd?: (name: string, result: unknown, round: number, hint: string | undefined, toolCallId: string) => void;
  onDone?: (data: AgentStreamDone) => void | Promise<void>;
  onError?: (message: string, sessionId?: string, suggestion?: string) => void | Promise<void>;
  /** 每收到一个带 id 的事件时回调，用于断线续传 */
  onEventId?: (id: number) => void;
}

async function parseSseBlock(
  block: string,
  callbacks: AgentStreamCallbacks,
): Promise<{ finished: boolean; eventId?: number }> {
  const lines = block.split("\n");
  let eventType = "message";
  let dataLine = "";
  let eventId: number | undefined;
  for (const line of lines) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    if (line.startsWith("data:")) dataLine += line.slice(5).trim();
    if (line.startsWith("id:")) {
      const parsed = Number(line.slice(3).trim());
      if (Number.isFinite(parsed)) eventId = parsed;
    }
  }
  if (eventId !== undefined) {
    callbacks.onEventId?.(eventId);
  }
  if (!dataLine) return { finished: false, eventId };
  try {
    const payload = JSON.parse(dataLine);
    switch (eventType) {
      case "session_start":
        callbacks.onSessionStart?.(payload.sessionId ?? "");
        break;
      case "round_start":
        callbacks.onRoundStart?.(payload.round ?? 1);
        break;
      case "thinking":
        callbacks.onThinking?.(payload.delta ?? "");
        break;
      case "token":
        callbacks.onToken?.(payload.delta ?? "");
        break;
      case "intermediate_content":
        callbacks.onIntermediateContent?.(payload.content ?? "", payload.round ?? 1);
        break;
      case "tool_start":
        callbacks.onToolStart?.(payload.name, payload.args, payload.round ?? 1, payload.toolCallId ?? "");
        break;
      case "tool_end":
        callbacks.onToolEnd?.(payload.name, payload.result, payload.round ?? 1, payload.hint, payload.toolCallId ?? "");
        break;
      case "done":
        await callbacks.onDone?.(payload as AgentStreamDone);
        return { finished: true, eventId };
      case "error":
        await callbacks.onError?.(payload.message, payload.sessionId, payload.suggestion);
        return { finished: true, eventId };
    }
  } catch {
    // ignore malformed chunk
  }
  return { finished: false, eventId };
}

async function readOneConnection(
  res: Response,
  callbacks: AgentStreamCallbacks,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    callbacks.onError?.(`流式请求失败 HTTP ${res.status}: ${text}`);
    return false;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        if (!block.trim()) continue;
        const { finished } = await parseSseBlock(block, callbacks);
        if (finished) return true;
      }
    }

    if (buffer.trim()) {
      const { finished } = await parseSseBlock(buffer, callbacks);
      if (finished) return true;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return false;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动或续传 Agent 流式聊天。
 *
 * - 首次调用使用 POST /api/agent/chat/stream 启动运行。
 * - 连接断开后会自动使用 GET ?sessionId=&resumeAfter= 续传，直到收到 done/error 或 signal 被 abort。
 * - 通过 callbacks.onEventId 可拿到每个事件 id，用于外部重连。
 */
export async function streamAgentChat(
  input: AgentChatStreamInput,
  callbacks: AgentStreamCallbacks,
  signal?: AbortSignal,
) {
  let lastEventId = input.resumeAfter ?? 0;
  const explicitResume = typeof input.resumeAfter === "number";
  let attempt = 0;
  const maxAttempts = 12; // 最长约 2 分钟的总重连窗口

  while (true) {
    if (signal?.aborted) return;

    // 显式 resumeAfter=0 也要走 GET 续传；新流 lastEventId=0 则走 POST
    const isResume = lastEventId > 0 || explicitResume;
    let url: string;
    let init: RequestInit;

    if (isResume) {
      const qs = new URLSearchParams();
      if (input.sessionId) qs.set("sessionId", input.sessionId);
      qs.set("resumeAfter", String(lastEventId));
      url = `/api/agent/chat/stream?${qs.toString()}`;
      init = {
        method: "GET",
        headers: { ...authHeaders() },
        signal,
      };
    } else {
      url = "/api/agent/chat/stream";
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(input),
        signal,
      };
    }

    const trackingCallbacks: AgentStreamCallbacks = {
      ...callbacks,
      onEventId: (id) => {
        lastEventId = id;
        callbacks.onEventId?.(id);
      },
    };

    try {
      const res = await fetch(url, init);
      const finished = await readOneConnection(res, trackingCallbacks, signal);
      if (finished) return;
      // 连接正常结束但未收到 done/error：可能是连接被悄悄关闭，进入重连
    } catch {
      if (signal?.aborted) {
        const abortErr = new Error("用户中断");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      // 网络错误进入重连
    }

    if (signal?.aborted) {
      const abortErr = new Error("用户中断");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    attempt++;
    if (attempt > maxAttempts) {
      callbacks.onError?.("连接已断开，多次重连失败。请检查网络或刷新页面。");
      return;
    }

    const backoff = Math.min(1000 * 2 ** attempt, 15000);
    await waitMs(backoff);
  }
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

export async function stopAgentChat(sessionId: string): Promise<{ stopped: boolean }> {
  const res = await fetch("/api/agent/chat/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`停止失败 HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as { stopped: boolean };
}
