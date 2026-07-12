/**
 * 聊天历史 → LLM messages 重建（含 tool call 多轮回放 + vision 多模态）
 */

import type { ChatImageAttachment } from "@knowpilot/shared";
import { resolveModelSupportsVision, DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS } from "@knowpilot/shared";
import type { LlmContentPart, LlmMessage } from "./llmClient.js";
import { getActiveAssistantPayload } from "./messageVersions.js";

/** 与 autoCompact / 前端 compactMarkers 对齐 */
export const COMPACT_BOUNDARY_PREFIX = "[kp-compact-boundary:";

export interface StoredToolCall {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  kind?: "tool" | "thinking" | "content" | "compact";
}

export function parseStoredToolCalls(raw: unknown): StoredToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc, i) => ({
    id: typeof tc?.id === "string" ? tc.id : `call_hist_${i}`,
    name: String(tc?.name ?? ""),
    args: tc?.args ?? {},
    result: tc?.result ?? null,
    kind:
      tc?.kind === "thinking"
        ? "thinking"
        : tc?.kind === "compact" || tc?.name === "__context_compact__"
          ? "compact"
          : tc?.kind === "content" || tc?.name === "__content__"
            ? "content"
            : "tool",
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

export type HistoryMessageLike = {
  role: string;
  content: string;
  attachments?: unknown;
  toolCalls?: unknown;
  toolResults?: unknown;
};

/** 是否为压缩边界消息（对标 Claude Code compact_boundary） */
export function isCompactBoundaryHistoryItem(msg: Pick<HistoryMessageLike, "content" | "toolCalls">): boolean {
  if (msg.content.includes(COMPACT_BOUNDARY_PREFIX)) return true;
  return parseStoredToolCalls(msg.toolCalls).some(
    (tc) => tc.kind === "compact" || tc.name === "__context_compact__",
  );
}

/** 从最后一条压缩边界起裁剪历史（对标 Claude Code getMessagesAfterCompactBoundary） */
export function findLastCompactBoundaryIndex<T extends Pick<HistoryMessageLike, "content" | "toolCalls">>(
  history: T[],
): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (isCompactBoundaryHistoryItem(history[i]!)) return i;
  }
  return -1;
}

export function sliceHistoryAfterCompactBoundary<T extends HistoryMessageLike>(history: T[]): T[] {
  const idx = findLastCompactBoundaryIndex(history);
  return idx === -1 ? history : history.slice(idx);
}

export function buildLlmMessagesFromHistory(
  systemContent: string,
  history: HistoryMessageLike[],
  options?: { modelId?: string; microCompactToolMaxChars?: number },
): LlmMessage[] {
  const supportsVision = options?.modelId ? resolveModelSupportsVision(options.modelId) : false;
  const toolMaxChars = options?.microCompactToolMaxChars ?? DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS;
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
    const tools = allCalls.filter(
      (tc) => tc.kind !== "thinking" && tc.kind !== "content" && tc.kind !== "compact",
    );
    // R3：复用已解析的 allCalls 派生 reasoningContent，避免 buildReasoningContentFromStored 内部再次 parseStoredToolCalls
    const reasoningParts = allCalls.filter((tc) => tc.kind === "thinking").map((tc) => String(tc.result ?? "")).filter(Boolean);
    const reasoningContent = reasoningParts.join("") || undefined;

    if (tools.length > 0) {
      // 多轮 ReAct 拆分：runtime 扁平存储为一条 assistant(content=final + toolCalls=[all])，
      // 违反 OpenAI 格式（tool 轮 assistant 必须 content=null）。重建时按 tool_call 拆成
      // N 条 assistant(content=null, tool_calls=[single]) + tool result，最终答案作为
      // 独立 assistant 消息在末尾发出。
      for (const tc of tools) {
        messages.push({
          role: "assistant",
          content: null,
          reasoning_content: null,
          tool_calls: [
            {
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
            },
          ],
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify(tc.result ?? {}).slice(0, toolMaxChars),
        });
      }
      // 最终答案作为独立 assistant 消息（aborted 等空 content 情况跳过）
      if (active.content && active.content.trim()) {
        messages.push({
          role: "assistant",
          content: active.content,
          reasoning_content: reasoningContent ?? null,
        });
      }
    } else {
      messages.push({ role: "assistant", content: active.content });
    }
  }

  return messages;
}

/** session_compact 成功后强制简短确认，禁止 Agent 复述摘要（对标 Claude Code suppressFollowUpQuestions） */
export function formatPostCompactAssistantReply(messagesSummarized?: number): string {
  const n = messagesSummarized ?? 0;
  return n > 0 ? `压缩已完成，已摘要 ${n} 条旧消息。` : "压缩已完成。";
}

export function sanitizePostCompactAssistantContent(
  content: string,
  toolCalls: Array<{ name?: string; result?: unknown }>,
): string {
  const compactTc = toolCalls.find(
    (tc) => tc.name === "session_compact" && !(tc.result && typeof tc.result === "object" && "error" in (tc.result as object)),
  );
  if (!compactTc) return content;
  const summarized =
    compactTc.result && typeof compactTc.result === "object"
      ? (compactTc.result as { messagesSummarized?: number }).messagesSummarized
      : undefined;
  return formatPostCompactAssistantReply(summarized);
}
