/**
 * 聊天历史 → LLM messages 重建（含 tool call 多轮回放 + vision 多模态）
 */

import type { ChatImageAttachment } from "@knowpilot/shared";
import { resolveModelSupportsVision } from "@knowpilot/shared";
import type { LlmContentPart, LlmMessage } from "./llmClient.js";
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

export function parseAttachmentsFromToolResults(raw: unknown): ChatImageAttachment[] {
  if (!raw || typeof raw !== "object") return [];
  const attachments = (raw as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter(
      (a): a is ChatImageAttachment =>
        !!a &&
        typeof a === "object" &&
        typeof (a as ChatImageAttachment).name === "string" &&
        typeof (a as ChatImageAttachment).mimeType === "string" &&
        typeof (a as ChatImageAttachment).previewUrl === "string",
    )
    .map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      previewUrl: a.previewUrl,
      extractedText: a.extractedText,
      source: a.source,
    }));
}

export function buildReasoningContentFromStored(toolCalls: unknown): string | undefined {
  const parts = parseStoredToolCalls(toolCalls)
    .filter((tc) => tc.kind === "thinking")
    .map((tc) => String(tc.result ?? ""))
    .filter(Boolean);
  const joined = parts.join("");
  return joined || undefined;
}

/** 拼装 user 消息 LLM content：vision 模型直传 image_url，否则 OCR 文本拼入 message */
export function buildUserMessageContentForLlm(
  text: string,
  attachments: ChatImageAttachment[] | undefined,
  supportsVision: boolean,
): string | LlmContentPart[] {
  const trimmed = text.trim();

  if (!supportsVision || !attachments?.length) {
    const ocrParts = (attachments ?? [])
      .filter((a) => a.extractedText?.trim())
      .map(
        (a) =>
          `[附件 · ${a.name} · ${a.source === "ocr" ? "OCR 识别" : a.source === "vision" ? "识图" : "用户"}]\n${a.extractedText!.trim()}`,
      );
    const chunks = [...ocrParts];
    if (trimmed) chunks.push(trimmed);
    return chunks.join("\n\n") || "(空消息)";
  }

  const parts: LlmContentPart[] = [];
  if (trimmed) parts.push({ type: "text", text: trimmed });
  for (const att of attachments) {
    if (att.previewUrl.startsWith("data:")) {
      parts.push({
        type: "image_url",
        image_url: { url: att.previewUrl, detail: "auto" },
      });
    }
  }
  if (parts.length === 0) return trimmed || "(空消息)";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text ?? trimmed;
  return parts;
}

export function buildLlmMessagesFromHistory(
  systemContent: string,
  history: Array<{ role: string; content: string; attachments?: unknown; toolCalls?: unknown; toolResults?: unknown }>,
  options?: { modelId?: string },
): LlmMessage[] {
  const supportsVision = options?.modelId ? resolveModelSupportsVision(options.modelId) : false;
  const messages: LlmMessage[] = [{ role: "system", content: systemContent }];

  for (const msg of history) {
    if (msg.role === "user") {
      const attachments = Array.isArray(msg.attachments)
        ? msg.attachments.filter((a): a is ChatImageAttachment => !!a && typeof a === "object")
        : parseAttachmentsFromToolResults(msg.toolResults);
      messages.push({
        role: "user",
        content: buildUserMessageContentForLlm(msg.content, attachments, supportsVision),
      });
      continue;
    }

    if (msg.role !== "assistant") continue;

    const active = getActiveAssistantPayload(msg);
    const allCalls = parseStoredToolCalls(active.toolCalls);
    const tools = allCalls.filter((tc) => tc.kind !== "thinking");
    const reasoningContent = buildReasoningContentFromStored(active.toolCalls);

    if (tools.length > 0) {
      messages.push({
        role: "assistant",
        content: active.content || null,
        reasoning_content: reasoningContent ?? null,
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
