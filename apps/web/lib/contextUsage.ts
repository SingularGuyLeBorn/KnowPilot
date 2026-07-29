/**
 * 会话上下文占用估算 — Header 胶囊 + 详情 Popover
 *
 * 口径对齐服务端送模（`historySinceLastCompactBoundary` + `buildLlmMessagesFromHistory`）：
 * - 有压缩边界时只计边界之后的消息 + contextSummary（不把已摘要旧历史当窗口）
 * - 只取 assistant 激活版本；不双写 toolCalls / versionMeta
 * - 工具结果按 DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS 截断
 * - thinking 单独计「思考」
 * - ↑↓ 为各轮 API tokenUsage 累计（会叠乘），不是当前窗口
 */

import type { ChatMessage } from "@knowpilot/shared";
import {
  DEFAULT_COMPACT_TRIGGER_RATIO,
  DEFAULT_LLM_MODEL,
  DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS,
  resolveCompactCharThreshold,
  resolveModelContextWindowTokens,
} from "@knowpilot/shared";
import { formatTokenCount } from "@/lib/tokenBudget";
import { COMPACT_BOUNDARY_PREFIX, SUMMARY_MARKER } from "@/lib/compactMarkers";

export interface ContextUsageSegment {
  id: string;
  label: string;
  tokens: number;
  color: string;
}

export interface ContextUsageMessageInfo {
  id: string;
  role: string;
  tokens: number;
  preview: string;
  isSummarized: boolean;
  createdAt?: string | Date;
  /** assistant 轮次拆分，避免把整轮误读成「一个工具调用」 */
  breakdown?: {
    toolCount: number;
    contentTokens: number;
    thinkingTokens: number;
    toolsTokens: number;
  };
}

export interface ContextUsageSnapshot {
  segments: ContextUsageSegment[];
  estimatedTotal: number;
  ratio: number;
  /** 相对 Auto-Compact 字符阈值的进度 0–1 */
  compactRatio: number;
  /** 各轮 API prompt 累计（会随历史重算叠乘，≠当前窗口） */
  inputTokens: number;
  /** 各轮 API completion 累计 */
  outputTokens: number;
  maxContextTokens: number;
  compactCharThreshold: number;
  compactTriggerRatio: number;
  topMessages: ContextUsageMessageInfo[];
  compression: {
    summarizedCount: number;
    originalCount: number;
    summarizedTokens: number;
    originalTokens: number;
    hasAutoCompacted: boolean;
    summaryPreview?: string;
  };
}

type StoredToolCall = {
  id?: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  kind?: string;
};

function charsToTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

function isSummaryContent(content: string): boolean {
  return content.includes(SUMMARY_MARKER) || content.includes(COMPACT_BOUNDARY_PREFIX);
}

function parseToolCalls(raw: unknown): StoredToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw as StoredToolCall[];
}

/** 与服务端 getActiveAssistantPayload 对齐：优先 versionMeta 激活版本 */
function getActiveAssistantParts(msg: ChatMessage): {
  content: string;
  toolCalls: StoredToolCall[];
} {
  const tr = msg.toolResults;
  if (tr && typeof tr === "object") {
    const vm = (tr as {
      versionMeta?: {
        versions?: Array<{ content?: string; toolCalls?: unknown }>;
        activeIndex?: number;
      };
    }).versionMeta;
    if (vm?.versions?.length) {
      const idx =
        typeof vm.activeIndex === "number" &&
        vm.activeIndex >= 0 &&
        vm.activeIndex < vm.versions.length
          ? vm.activeIndex
          : vm.versions.length - 1;
      const active = vm.versions[idx]!;
      return {
        content: active.content ?? msg.content ?? "",
        toolCalls: parseToolCalls(active.toolCalls),
      };
    }
  }
  return {
    content: msg.content ?? "",
    toolCalls: parseToolCalls(msg.toolCalls),
  };
}

function isRealToolCall(tc: StoredToolCall): boolean {
  const kind = tc.kind;
  if (kind === "thinking" || kind === "content" || kind === "compact") return false;
  const name = String(tc.name ?? "");
  if (name === "__thinking__" || name === "__content__" || name === "__context_compact__") {
    return false;
  }
  return Boolean(name);
}

/** 与 server chatHistory.isCompactBoundaryHistoryItem 对齐 */
export function isCompactBoundaryMessage(msg: ChatMessage): boolean {
  const content = msg.content ?? "";
  if (content.includes(COMPACT_BOUNDARY_PREFIX)) return true;
  const tools = getActiveAssistantParts(msg).toolCalls;
  return tools.some(
    (tc) => tc.kind === "compact" || tc.name === "__context_compact__",
  );
}

/**
 * 与 server historySinceLastCompactBoundary 对齐：
 * 从最后一条压缩边界之后起算，且不含边界气泡本身。
 */
export function messagesInLlmContextWindow(messages: ChatMessage[]): ChatMessage[] {
  let boundary = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactBoundaryMessage(messages[i]!)) {
      boundary = i;
      break;
    }
  }
  const sliced = boundary === -1 ? messages : messages.slice(boundary + 1);
  return sliced.filter((m) => !isCompactBoundaryMessage(m));
}

/** 单条消息按「送模近似」计字符 */
function estimateMessageChars(msg: ChatMessage): {
  conversation: number;
  tools: number;
  thinking: number;
  summary: number;
  total: number;
  isSummarized: boolean;
} {
  const content = msg.content ?? "";
  if (isSummaryContent(content)) {
    const n = content.length;
    return { conversation: 0, tools: 0, thinking: 0, summary: n, total: n, isSummarized: true };
  }

  if (msg.role === "user") {
    let extra = 0;
    if (msg.toolResults && typeof msg.toolResults === "object") {
      const tr = msg.toolResults as { attachments?: unknown };
      if (Array.isArray(tr.attachments)) {
        try {
          extra += JSON.stringify(tr.attachments).length;
        } catch {
          extra += 128;
        }
      }
    }
    const conversation = content.length + 120 + extra;
    return { conversation, tools: 0, thinking: 0, summary: 0, total: conversation, isSummarized: false };
  }

  if (msg.role !== "assistant") {
    const n = content.length;
    return { conversation: n, tools: 0, thinking: 0, summary: 0, total: n, isSummarized: false };
  }

  const active = getActiveAssistantParts(msg);
  let conversation = (active.content?.length ?? 0) + 120;
  let tools = 0;
  let thinking = 0;

  for (const tc of active.toolCalls) {
    if (!isRealToolCall(tc)) {
      if (tc.kind === "thinking" || tc.name === "__thinking__") {
        thinking += String(tc.result ?? "").length;
      } else if (tc.kind === "content" || tc.name === "__content__") {
        conversation += String(tc.result ?? tc.args ?? "").length;
      }
      continue;
    }
    try {
      tools += JSON.stringify(tc.args ?? {}).length;
    } catch {
      tools += 64;
    }
    try {
      const resultStr = JSON.stringify(tc.result ?? {});
      tools += Math.min(resultStr.length, DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS);
    } catch {
      tools += 64;
    }
  }

  return {
    conversation,
    tools,
    thinking,
    summary: 0,
    total: conversation + tools + thinking,
    isSummarized: false,
  };
}

export function buildContextUsage(params: {
  messages: ChatMessage[];
  systemPrompt: string;
  modelId?: string;
  triggerRatio?: number;
  /** 会话表持久化的摘要（优先于消息内标记） */
  contextSummary?: string | null;
}): ContextUsageSnapshot {
  const modelId = params.modelId ?? DEFAULT_LLM_MODEL;
  const compactTriggerRatio = params.triggerRatio ?? DEFAULT_COMPACT_TRIGGER_RATIO;
  const maxContextTokens = resolveModelContextWindowTokens(modelId);
  const compactCharThreshold = resolveCompactCharThreshold(modelId, compactTriggerRatio);
  const persistedSummary = params.contextSummary?.trim() || "";

  // 送模窗口：摘要 + 压缩边界之后（旧消息已由摘要替代，禁止再计入窗口）
  const windowMessages = messagesInLlmContextWindow(params.messages);
  const droppedCount = Math.max(0, params.messages.length - windowMessages.length);

  const systemChars = params.systemPrompt.length;
  let conversationChars = 0;
  let toolChars = 0;
  let thinkingChars = 0;
  let summaryChars = persistedSummary.length;

  for (const m of windowMessages) {
    const est = estimateMessageChars(m);
    conversationChars += est.conversation;
    toolChars += est.tools;
    thinkingChars += est.thinking;
    summaryChars += est.summary;
  }

  const segments: ContextUsageSegment[] = [
    { id: "system", label: "System prompt", tokens: charsToTokens(systemChars), color: "#9a9588" },
    { id: "tools", label: "工具调用", tokens: charsToTokens(toolChars), color: "#b8a090" },
    { id: "thinking", label: "思考过程", tokens: charsToTokens(thinkingChars), color: "#a8b0c0" },
    { id: "summary", label: "摘要对话", tokens: charsToTokens(summaryChars), color: "#c9b8b3" },
    { id: "conversation", label: "对话消息", tokens: charsToTokens(conversationChars), color: "#a89080" },
  ].filter((s) => s.tokens > 0);

  const estimatedTotal = segments.reduce((sum, s) => sum + s.tokens, 0);
  const ratio = Math.min(1, estimatedTotal / maxContextTokens);
  const estimatedChars = systemChars + conversationChars + toolChars + thinkingChars + summaryChars;
  const compactRatio = Math.min(1, estimatedChars / compactCharThreshold);

  const topMessages: ContextUsageMessageInfo[] = windowMessages
    .map((m) => {
      const est = estimateMessageChars(m);
      const active = m.role === "assistant" ? getActiveAssistantParts(m) : null;
      const previewSource = active ? active.content : (m.content ?? "");
      const toolCount = active
        ? active.toolCalls.filter((tc) => isRealToolCall(tc)).length
        : 0;
      return {
        id: m.id,
        role: m.role,
        tokens: charsToTokens(est.total),
        preview:
          previewSource
            .replace(SUMMARY_MARKER, "")
            .replace(/\[kp-compact-boundary:[^\]]+\]/g, "")
            .trim()
            .slice(0, 80) || "(空)",
        isSummarized: est.isSummarized,
        createdAt: m.createdAt,
        breakdown:
          m.role === "assistant"
            ? {
                toolCount,
                contentTokens: charsToTokens(est.conversation),
                thinkingTokens: charsToTokens(est.thinking),
                toolsTokens: charsToTokens(est.tools),
              }
            : undefined,
      };
    })
    .filter((m) => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  let summarizedCount = persistedSummary ? 1 : 0;
  let summarizedTokens = persistedSummary ? charsToTokens(persistedSummary.length) : 0;
  // 边界前被裁掉的消息：计为已由摘要覆盖（观测用）
  if (droppedCount > 0) {
    summarizedCount += droppedCount;
  }
  let originalCount = 0;
  let originalTokens = 0;
  for (const m of windowMessages) {
    const est = estimateMessageChars(m);
    const tokens = charsToTokens(est.total);
    if (est.isSummarized) {
      summarizedCount++;
      summarizedTokens += tokens;
    } else {
      originalCount++;
      originalTokens += tokens;
    }
  }

  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of params.messages) {
    if (m.tokenUsage) {
      inputTokens += m.tokenUsage.prompt ?? 0;
      outputTokens += m.tokenUsage.completion ?? 0;
    }
  }

  return {
    segments,
    estimatedTotal,
    ratio,
    compactRatio,
    inputTokens,
    outputTokens,
    maxContextTokens,
    compactCharThreshold,
    compactTriggerRatio,
    topMessages,
    compression: {
      summarizedCount,
      originalCount,
      summarizedTokens,
      originalTokens,
      hasAutoCompacted: !!persistedSummary || droppedCount > 0 || summarizedCount > 0,
      summaryPreview: persistedSummary ? persistedSummary.slice(0, 160) : undefined,
    },
  };
}

export { formatTokenCount };
