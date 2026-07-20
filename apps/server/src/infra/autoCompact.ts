/**
 * 对话上下文自动压缩 — micro-compact → memory flush → macro-compact
 *
 * - 阈值：模型 context window × triggerRatio（可配置）
 * - 摘要持久化在 ChatSession.contextSummary
 * - 失败时降级为裁剪最早消息（保留最近 keepRecent）
 */

import type { AppConfig } from "./config.js";
import { chatCompletion, type LlmMessage } from "./llmClient.js";
import type { ServiceContainer } from "./serviceContainer.js";
// type-only：避免运行时循环依赖（agentStream 反向 import maybeCompactMessages）
import type { AgentStreamEvent } from "./agentStream.js";
import {
  DEFAULT_COMPACT_KEEP_RECENT,
  DEFAULT_COMPACT_TRIGGER_RATIO,
  DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  resolveCompactCharThreshold,
} from "@knowpilot/shared";
import { flushMemoriesBeforeCompact } from "./memoryFlush.js";
import {
  filterOpenRouterFreeModels,
  getFreellmGatewayRuntime,
} from "./freeLlmRuntime.js";
import {
  buildLlmMessagesFromHistory,
  historySinceLastCompactBoundary,
  type HistoryMessageLike,
} from "./chatHistory.js";
import {
  DEFAULT_KEEP_RECENT_TOKENS,
  extractFileOpsFromMessages,
  findCompactCutIndex,
  formatCompactFileDetails,
  mergeCompactFileDetails,
  parseCompactFileDetails,
  type CompactFileDetails,
} from "./compactCut.js";

/** 摘要内容标记：压缩边界消息的正文前缀（边界行由 buildCompactBoundaryMarker 生成） */
export const SUMMARY_MARKER = "[此前对话摘要 — 自动压缩]";
export const COMPACT_BOUNDARY_PREFIX = "[kp-compact-boundary:";

export { DEFAULT_COMPACT_KEEP_RECENT, DEFAULT_KEEP_RECENT_TOKENS };

export const MICRO_COMPACT_TRUNCATED = "[tool result truncated by micro-compact]";

export function buildCompactBoundaryMarker(generation: number): string {
  const ts = new Date().toISOString();
  return `${COMPACT_BOUNDARY_PREFIX}v${generation}@${ts}]`;
}

export function isCompactSummaryContent(content: string): boolean {
  return content.includes(SUMMARY_MARKER) || content.includes(COMPACT_BOUNDARY_PREFIX);
}

export function getCompactSettings(config: AppConfig) {
  const compact = config.compact ?? ({} as AppConfig["compact"]);
  const keepRecentTokensRaw = compact.keepRecentTokens;
  return {
    enabled: compact.enabled !== false,
    triggerRatio: Math.min(0.95, Math.max(0.05, compact.triggerRatio ?? DEFAULT_COMPACT_TRIGGER_RATIO)),
    keepRecent: Math.max(2, compact.keepRecent ?? DEFAULT_COMPACT_KEEP_RECENT),
    keepRecentTokens: Math.max(
      100,
      typeof keepRecentTokensRaw === "number" && Number.isFinite(keepRecentTokensRaw)
        ? keepRecentTokensRaw
        : DEFAULT_KEEP_RECENT_TOKENS,
    ),
    summaryModel: String(compact.summaryModel ?? "auto").trim() || "auto",
    microCompactEnabled: compact.microCompact?.enabled !== false,
    microCompactToolMaxChars: Math.max(
      500,
      compact.microCompact?.toolResultMaxChars ?? DEFAULT_MICRO_COMPACT_TOOL_MAX_CHARS,
    ),
    memoryFlushEnabled: compact.memoryFlush?.enabled !== false,
  };
}

/**
 * 解析压缩/memory-flush 用的摘要模型。
 * 触发阈值仍按主对话 `mainModel` 的 context window 计算；此处只决定「谁写摘要」。
 *
 * auto 策略：
 * 1. 有 OpenRouter key + 已同步 `:free` 目录 → 挑轻量免费模型
 * 2. 否则若 freellm 网关正在兜底默认 provider（无正式 key）→ 用网关模型
 * 3. 否则回退主对话模型（避免有付费 key 时把 freellm 模型误打到付费通道）
 */
export function resolveCompactSummaryModel(config: AppConfig, mainModel: string): string {
  const configured = getCompactSettings(config).summaryModel;
  if (configured.toLowerCase() !== "auto") return configured;

  const providers = config.llm?.providers;
  const hasOpenRouter = !!providers?.openrouter?.apiKey?.trim();
  if (hasOpenRouter) {
    const textFree = filterOpenRouterFreeModels({ modality: "text", sort: "context_desc" });
    const allFree = textFree.length > 0 ? textFree : filterOpenRouterFreeModels({ sort: "context_desc" });
    const preferred =
      allFree.find((m) => /flash|mini|lite|haiku|small|nano|gemma|qwen/i.test(m.id)) ?? allFree[0];
    if (preferred?.id) return preferred.id;
  }

  const freellm = getFreellmGatewayRuntime();
  const freellmModel = freellm?.model?.trim();
  const defaultProviderId = config.llm?.defaultProvider;
  const defaultProvider = defaultProviderId ? providers?.[defaultProviderId] : undefined;
  const freellmBackingDefault = !!freellm?.apiKey && !defaultProvider?.apiKey?.trim();
  if (freellmBackingDefault && freellmModel) return freellmModel;

  return mainModel;
}

export function resolveCompactThresholdForModel(config: AppConfig, modelId: string): number {
  const settings = getCompactSettings(config);
  return resolveCompactCharThreshold(modelId, settings.triggerRatio);
}

export function estimateChars(messages: LlmMessage[]): number {
  return messages.reduce((sum, m) => {
    const contentLen = typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length;
    const toolsLen = m.tool_calls ? JSON.stringify(m.tool_calls).length : 0;
    return sum + contentLen + toolsLen + 200;
  }, 0);
}

/** micro-compact：清超大 tool result，延缓触顶（学 Claude Code） */
export function microCompactMessages(messages: LlmMessage[], toolResultMaxChars: number): LlmMessage[] {
  return messages.map((m) => {
    if (m.role !== "tool" || typeof m.content !== "string") return m;
    if (m.content.length <= toolResultMaxChars) return m;
    return {
      ...m,
      content:
        m.content.slice(0, toolResultMaxChars) +
        `\n\n${MICRO_COMPACT_TRUNCATED}（原 ${m.content.length} 字符）`,
    };
  });
}

/** 摘要注入后的合成 assistant 确认（rebuild / maybeCompact 幂等剥离用） */
export const CONTEXT_SUMMARY_ACK = "已阅读摘要，继续基于上述上下文协助你。";

/** 迭代摘要：定位已注入摘要 pair 之后的 firstKept 起点 */
function findFirstKeptAfterSummaryPair(messages: LlmMessage[]): number | undefined {
  for (let i = 0; i < messages.length - 1; i++) {
    const cur = messages[i]!;
    const next = messages[i + 1]!;
    if (
      typeof cur.content === "string" &&
      isCompactSummaryContent(cur.content) &&
      next.role === "assistant" &&
      next.content === CONTEXT_SUMMARY_ACK
    ) {
      return i + 2;
    }
  }
  return undefined;
}

export function buildSummaryPair(summaryText: string, generation: number): LlmMessage[] {
  const boundary = buildCompactBoundaryMarker(generation);
  return [
    {
      role: "user",
      content: `${boundary}\n${SUMMARY_MARKER}\n${summaryText}`,
    },
    { role: "assistant", content: CONTEXT_SUMMARY_ACK },
  ];
}

/** 去掉已注入的摘要 pair，避免 maybeCompact / 多次 rebuild 双重注入 */
export function stripInjectedSummaryMessages(messages: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (typeof m.content === "string" && isCompactSummaryContent(m.content)) {
      const next = messages[i + 1];
      if (next?.role === "assistant" && next.content === CONTEXT_SUMMARY_ACK) i++;
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * 发给 LLM 的会话上下文不变量：
 * system +（可选）contextSummary + 最近一次压缩边界之后的全部原文消息。
 * 页面历史气泡不删；此处只裁剪模型视野。
 */
export function buildLlmContextSinceCompact(
  systemContent: string,
  history: HistoryMessageLike[],
  options?: {
    modelId?: string;
    microCompactToolMaxChars?: number;
    contextSummary?: string | null;
    /** 会话当前 compactGeneration（注入摘要 pair 的代数） */
    compactGeneration?: number | null;
  },
): LlmMessage[] {
  const base = buildLlmMessagesFromHistory(
    systemContent,
    historySinceLastCompactBoundary(history),
    {
      modelId: options?.modelId,
      microCompactToolMaxChars: options?.microCompactToolMaxChars,
    },
  );
  const summary = options?.contextSummary?.trim();
  if (!summary) return base;

  const system = base.filter((m) => m.role === "system");
  const rest = stripInjectedSummaryMessages(base.filter((m) => m.role !== "system"));
  const generation = Math.max(1, options?.compactGeneration ?? 1);
  return [...system, ...buildSummaryPair(summary, generation), ...rest];
}

function trimOldest(messages: LlmMessage[], keepRecent: number): LlmMessage[] {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= keepRecent) return messages;
  return [...system, ...rest.slice(-keepRecent)];
}

/** 下一压缩代数 = 当前列值 + 1（显式列，不再解析摘要文本） */
export function nextCompactGeneration(currentGeneration?: number | null): number {
  return Math.max(0, currentGeneration ?? 0) + 1;
}

export interface CompactResult {
  messages: LlmMessage[];
  compacted: boolean;
  /** 需要持久化到 ChatSession.contextSummary 的文本（新建或更新） */
  summaryText?: string;
  /** 复用了已有摘要，未再调 LLM */
  reused?: boolean;
  /** compact 前 memory flush 写入条数 */
  memoriesFlushed?: number;
  /** 实际使用的字符阈值 */
  charThresholdUsed?: number;
  /** 本次压缩代数（用于边界消息与 UI 时间线） */
  generation?: number;
  /** 被摘要的旧消息条数 */
  messagesSummarized?: number;
  /** 压缩前字符数（用于 UI 展示降幅） */
  charBefore?: number;
  /** 压缩后字符数 */
  charAfter?: number;
  /** 跨压缩累计文件清单（写入摘要 details JSON） */
  fileDetails?: CompactFileDetails;
  /** 保留段起点（相对 working messages；迭代摘要用） */
  firstKeptIndex?: number;
}

export interface CompactOptions {
  existingSummary?: string | null;
  /** 会话当前 compactGeneration（读时快照，供 CAS 与代数计算） */
  existingGeneration?: number | null;
  /** 迭代摘要显式起点（优先于从摘要 pair 推断） */
  firstKeptIndex?: number;
  flushContext?: {
    services: ServiceContainer;
    sessionId?: string;
    agentId?: string | null;
    workspaceId?: string | null;
    tier?: string | null;
  };
  /** 压缩阶段事件回调；仅在真正 macro 压缩时触发，reused / 未触发不 emit */
  emit?: (event: AgentStreamEvent) => void;
}

/**
 * @param existingSummary 会话已持久化的摘要；有则优先复用，超阈值再二次压缩
 */
export async function maybeCompactMessages(
  config: AppConfig,
  messages: LlmMessage[],
  model: string,
  options?: CompactOptions,
): Promise<CompactResult> {
  const settings = getCompactSettings(config);
  if (!settings.enabled) return { messages, compacted: false };

  const charThreshold = resolveCompactThresholdForModel(config, model);
  let working = settings.microCompactEnabled
    ? microCompactMessages(messages, settings.microCompactToolMaxChars)
    : [...messages];

  const system = working.filter((m) => m.role === "system");
  const rest = working.filter((m) => m.role !== "system");
  const existing = options?.existingSummary?.trim() || "";
  const baseGeneration = Math.max(0, options?.existingGeneration ?? 0);
  const generation = nextCompactGeneration(baseGeneration);

  if (existing) {
    // 复用摘要时保留压缩边界之后的全部原文，不再用 keepRecent 截断（keepRecent 只用于「再次压缩」切点）
    const cleaned = stripInjectedSummaryMessages(rest);
    const reusedMessages: LlmMessage[] = [
      ...system,
      ...buildSummaryPair(existing, Math.max(1, baseGeneration)),
      ...cleaned,
    ];
    if (estimateChars(reusedMessages) < charThreshold) {
      return {
        messages: reusedMessages,
        compacted: true,
        summaryText: existing,
        reused: true,
        charThresholdUsed: charThreshold,
      };
    }
  }

  if (estimateChars(working) < charThreshold && !existing) {
    return { messages: working, compacted: false, charThresholdUsed: charThreshold };
  }

  // 切割：keepRecentTokens 定初切点；不安全则向旧侧移到 tool 对边界；迭代从上次 firstKept 起算
  const firstKeptStart =
    options?.firstKeptIndex ??
    (existing ? findFirstKeptAfterSummaryPair(working) : undefined);
  const cutIndex = findCompactCutIndex(working, settings.keepRecentTokens, firstKeptStart);
  const toSummarize = working.slice(0, cutIndex).filter((m) => m.role !== "system");
  const recent = working.slice(cutIndex);

  // 消息过少或无可摘要段：不压缩（keepRecent 条数仍作下限守卫）
  if (toSummarize.length < 2 || recent.length < 1 || rest.length <= settings.keepRecent + 2) {
    return { messages: working, compacted: false, charThresholdUsed: charThreshold };
  }

  const fileDetails = mergeCompactFileDetails(
    parseCompactFileDetails(existing),
    extractFileOpsFromMessages(toSummarize),
  );

  const transcriptParts: string[] = [];
  if (existing) {
    // 摘要正文送 LLM 时剥离 details 机器块，避免污染
    const bare = existing.replace(/\n*<!--kp-compact-details:[\s\S]*?-->\s*$/, "").trim();
    transcriptParts.push(`[已有摘要]\n${bare}`);
  }
  for (const m of toSummarize) {
    const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : m.role;
    const text = (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")).slice(0, 2000);
    transcriptParts.push(`[${role}]\n${text}`);
  }
  const transcript = transcriptParts.join("\n\n---\n\n");
  const summaryModel = resolveCompactSummaryModel(config, model);

  let memoriesFlushed = 0;
  if (settings.memoryFlushEnabled && options?.flushContext?.services) {
    memoriesFlushed = await flushMemoriesBeforeCompact(
      config,
      options.flushContext.services,
      transcript,
      summaryModel,
      {
        existingSummary: existing,
        actor: {
          agentId: options.flushContext.agentId,
          workspaceId: options.flushContext.workspaceId,
          tier: options.flushContext.tier,
        },
      },
    );
  }

  const charBefore = estimateChars(messages);
  const estimatedRatio = charThreshold > 0 ? Math.min(1, charBefore / charThreshold) : 1;
  options?.emit?.({ type: "compact_start", generation, estimatedRatio, round: 0 });

  try {
    const summary = await chatCompletion({
      config,
      model: summaryModel,
      messages: [
        {
          role: "system",
          content:
            "你是 KnowPilot 对话摘要助手。将以下历史对话压缩为简洁的中文摘要，保留：用户目标、已做决策、工具结果要点、未完成任务。不要编造。",
        },
        { role: "user", content: `请摘要以下对话历史：\n\n${transcript.slice(0, 32000)}` },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });

    const summaryBody = summary.content?.trim();
    if (!summaryBody) {
      const trimmed = trimOldest(working, settings.keepRecent);
      options?.emit?.({
        type: "compact_error",
        message: "摘要 LLM 返回空内容，已降级裁剪最早消息",
        fallback: "trim",
        generation,
      });
      return {
        messages: trimmed,
        compacted: true,
        memoriesFlushed,
        charThresholdUsed: charThreshold,
        generation,
        messagesSummarized: toSummarize.length,
        charBefore,
        charAfter: estimateChars(trimmed),
      };
    }

    const summaryText = formatCompactFileDetails(summaryBody, fileDetails);
    const compactedMessages: LlmMessage[] = [
      ...system,
      ...buildSummaryPair(summaryText, generation),
      ...recent,
    ];
    const charAfter = estimateChars(compactedMessages);
    console.log(
      `[AutoCompact] ${toSummarize.length} 条消息已压缩（原 ${charBefore} → ${charAfter} 字符，阈值 ${charThreshold}，摘要模型 ${summaryModel}，flush ${memoriesFlushed}，cut=${cutIndex}）`,
    );
    // compact_end 由调用方（agentStream）在写入边界消息后 emit，避免此处提前发完又重发。
    return {
      messages: compactedMessages,
      compacted: true,
      summaryText,
      memoriesFlushed,
      charThresholdUsed: charThreshold,
      generation,
      messagesSummarized: toSummarize.length,
      charBefore,
      charAfter,
      fileDetails,
      firstKeptIndex: cutIndex,
    };
  } catch (err) {
    console.warn("[AutoCompact] 压缩失败，降级裁剪最早消息:", err instanceof Error ? err.message : err);
    const trimmed = trimOldest(working, settings.keepRecent);
    options?.emit?.({
      type: "compact_error",
      message: err instanceof Error ? err.message : String(err),
      fallback: "trim",
      generation,
    });
    return {
      messages: trimmed,
      compacted: true,
      memoriesFlushed,
      charThresholdUsed: charThreshold,
      generation,
      messagesSummarized: toSummarize.length,
      charBefore,
      charAfter: estimateChars(trimmed),
      fileDetails,
      firstKeptIndex: cutIndex,
    };
  }
}

/** 手动压缩：基于完整历史生成摘要（供 tRPC / session_compact 工具） */
export async function compactSessionHistory(
  config: AppConfig,
  messages: LlmMessage[],
  model: string,
  existingSummary?: string | null,
  options?: CompactOptions,
): Promise<CompactResult> {
  const base = getCompactSettings(config);
  const forced = await maybeCompactMessages(
    {
      ...config,
      compact: {
        enabled: true,
        triggerRatio: base.triggerRatio,
        keepRecent: base.keepRecent,
        keepRecentTokens: base.keepRecentTokens,
        summaryModel: base.summaryModel,
        microCompact: {
          enabled: base.microCompactEnabled,
          toolResultMaxChars: base.microCompactToolMaxChars,
        },
        memoryFlush: {
          enabled: base.memoryFlushEnabled,
          maxFacts: config.compact?.memoryFlush?.maxFacts ?? 5,
        },
      },
    },
    messages,
    model,
    {
      ...options,
      existingSummary: existingSummary ?? options?.existingSummary,
    },
  );
  if (forced.compacted && forced.summaryText) {
    return forced;
  }
  return {
    messages,
    compacted: false,
    summaryText: existingSummary?.trim() || undefined,
    charThresholdUsed: forced.charThresholdUsed,
  };
}

export type CompactPersistTrigger = "auto" | "manual" | "agent";

const COMPACT_TRIGGER_LABEL: Record<CompactPersistTrigger, string> = {
  auto: "已自动压缩上下文",
  manual: "已手动压缩上下文",
  agent: "已压缩上下文（由助手触发）",
};

/** 压缩结果落库：单事务 + compactGeneration CAS（摘要与边界同事务，落败 skipped） */
export async function persistCompactResult(
  services: ServiceContainer,
  sessionId: string,
  compacted: CompactResult,
  options?: { trigger?: CompactPersistTrigger; emit?: (event: AgentStreamEvent) => void },
): Promise<{ boundaryMessageId?: string; skipped: boolean }> {
  if (!compacted.compacted || compacted.reused || !compacted.summaryText?.trim()) {
    return { skipped: true };
  }
  const trigger = options?.trigger ?? "auto";
  const generation = compacted.generation ?? 1;
  const expectedBase = generation - 1; // CAS：读时快照代际

  const boundaryMarker = buildCompactBoundaryMarker(generation);
  const summarized = compacted.messagesSummarized ?? 0;
  const boundaryContent = `${boundaryMarker}\n${COMPACT_TRIGGER_LABEL[trigger]}：${summarized} 条旧消息已摘要，模型从本轮起只看到「摘要 + 最近消息」。原文仍在上方可滚动查看。`;
  const boundaryToolCalls = [
    {
      id: `compact_v${generation}_${Date.now()}`,
      name: "__context_compact__",
      args: {
        trigger,
        generation,
        messagesSummarized: summarized,
        charBefore: compacted.charBefore ?? 0,
        charAfter: compacted.charAfter ?? 0,
        memoriesFlushed: compacted.memoriesFlushed ?? 0,
      },
      // 摘要仅存 ChatSession.contextSummary；勿写入 tool result，避免 rebuild 时重复送入 LLM
      result: {
        boundary: boundaryMarker,
        memoriesFlushed: compacted.memoriesFlushed ?? 0,
        trigger,
        messagesSummarized: summarized,
      },
      kind: "compact",
    },
  ];

  const prisma = services.prisma;
  const txResult = await prisma.$transaction(async (tx) => {
    const cas = await tx.chatSession.updateMany({
      where: { id: sessionId, compactGeneration: expectedBase },
      data: {
        contextSummary: compacted.summaryText,
        contextCompactedAt: new Date(),
        compactGeneration: generation,
      },
    });
    if (cas.count === 0) {
      return { skipped: true as const };
    }
    // W1：压缩边界消息挂到活跃叶并推进游标（与 CAS 同事务）
    const { appendChatMessage } = await import("./chatTree.js");
    const boundaryMsg = await appendChatMessage(tx, {
      sessionId,
      role: "assistant",
      content: boundaryContent,
      toolCalls: boundaryToolCalls,
      source: "system",
    });
    // 显式持久化边界消息 id（迭代摘要 / 历史裁剪的事实源，不靠解析摘要 marker）
    await tx.chatSession.update({
      where: { id: sessionId },
      data: { compactBoundaryMessageId: boundaryMsg.id },
    });
    return { skipped: false as const, boundaryMessageId: boundaryMsg.id };
  });

  if (txResult.skipped) {
    return { skipped: true };
  }

  const boundaryMessageId = txResult.boundaryMessageId;
  if (boundaryMessageId && options?.emit) {
    options.emit({
      type: "compact_end",
      generation,
      summaryPreview: compacted.summaryText.slice(0, 200),
      messagesSummarized: summarized,
      memoriesFlushed: compacted.memoriesFlushed ?? 0,
      charBefore: compacted.charBefore ?? 0,
      charAfter: compacted.charAfter ?? 0,
      boundaryMessageId,
    });
  }

  return { boundaryMessageId, skipped: false };
}

const SESSION_HISTORY_PAGE_SIZE = 200;

export interface RunSessionCompactResult {
  compacted: boolean;
  message: string;
  summaryPreview?: string;
  boundaryMessageId?: string;
  memoriesFlushed?: number;
  messagesSummarized?: number;
  generation?: number;
}

/** 手动 / Agent 工具 / tRPC 共用的会话压缩入口 */
export async function runSessionCompact(params: {
  config: AppConfig;
  services: ServiceContainer;
  sessionId: string;
  model: string;
  systemPrompt: string;
  existingSummary?: string | null;
  existingGeneration?: number | null;
  trigger: CompactPersistTrigger;
  emit?: (event: AgentStreamEvent) => void;
}): Promise<RunSessionCompactResult> {
  // 手动压缩与 hub run 互斥：会话 running 时拒绝（避免与 auto-compact 交错写）
  if (params.trigger === "manual") {
    const { getStreamHub } = await import("./sessionStreamHub.js");
    const hub = getStreamHub();
    if (hub?.isRunning(params.sessionId)) {
      return {
        compacted: false,
        message: "会话正在运行中，请停止后再手动压缩。",
      };
    }
  }

  const session = await params.services.session.getByIdLite(params.sessionId);
  const existingGeneration =
    params.existingGeneration ??
    (session as { compactGeneration?: number | null }).compactGeneration ??
    0;
  const historyItems = await params.services.message.listForLlmContext({
    sessionId: params.sessionId,
    since: (session as { contextCompactedAt?: Date | string | null }).contextCompactedAt,
    limit: SESSION_HISTORY_PAGE_SIZE,
  });
  const messages = buildLlmContextSinceCompact(
    params.systemPrompt || "你是 KnowPilot 助手。",
    historyItems,
    {
      modelId: params.model,
      contextSummary:
        params.existingSummary ??
        (session as { contextSummary?: string | null }).contextSummary ??
        null,
      compactGeneration: existingGeneration,
    },
  );

  const charThreshold = resolveCompactThresholdForModel(params.config, params.model);
  const charBefore = estimateChars(messages);
  const estimatedRatio = charThreshold > 0 ? Math.min(1, charBefore / charThreshold) : 1;
  const generation = nextCompactGeneration(existingGeneration);

  if (params.trigger !== "auto") {
    params.emit?.({ type: "compact_start", generation, estimatedRatio, round: 0 });
  }

  let flushActor: {
    agentId?: string | null;
    workspaceId?: string | null;
    tier?: string | null;
  } = {};
  try {
    const sess = await params.services.prisma.chatSession.findUnique({
      where: { id: params.sessionId },
      select: { agentId: true },
    });
    if (sess?.agentId) {
      const agent = await params.services.prisma.agent.findUnique({
        where: { id: sess.agentId },
        select: { id: true, workspaceId: true, tier: true },
      });
      if (agent) {
        flushActor = {
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          tier: agent.tier,
        };
      }
    }
  } catch {
    /* 查 Actor 失败时 flush 回退为无 Agent → global */
  }

  const compacted = await compactSessionHistory(
    params.config,
    messages,
    params.model,
    params.existingSummary,
    {
      existingGeneration,
      flushContext: {
        services: params.services,
        sessionId: params.sessionId,
        ...flushActor,
      },
      emit: params.trigger === "auto" ? params.emit : undefined,
    },
  );

  if (!compacted.compacted || !compacted.summaryText) {
    return { compacted: false, message: "消息较少，无需压缩。" };
  }

  const { boundaryMessageId, skipped } = await persistCompactResult(
    params.services,
    params.sessionId,
    compacted,
    { trigger: params.trigger, emit: params.emit },
  );

  if (skipped) {
    return { compacted: false, message: "压缩未生效（可能已复用摘要）。" };
  }

  return {
    compacted: true,
    message: "上下文已压缩并保存。",
    summaryPreview: compacted.summaryText.slice(0, 200),
    boundaryMessageId,
    memoriesFlushed: compacted.memoriesFlushed,
    messagesSummarized: compacted.messagesSummarized,
    generation: compacted.generation,
  };
}

/** 供 chatHistory / agentStream 对齐的 tool result 截断上限 */
export function resolveMicroCompactToolMaxChars(config: AppConfig): number {
  return getCompactSettings(config).microCompactToolMaxChars;
}

/** 默认模型窗口 token（前端估算 fallback） */
export function getDefaultContextWindowTokens(): number {
  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}
