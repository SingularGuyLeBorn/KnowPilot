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

/** 摘要内容标记：压缩边界消息的正文前缀（边界行由 buildCompactBoundaryMarker 生成） */
export const SUMMARY_MARKER = "[此前对话摘要 — 自动压缩]";
export const COMPACT_BOUNDARY_PREFIX = "[kp-compact-boundary:";

export { DEFAULT_COMPACT_KEEP_RECENT };

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
  return {
    enabled: compact.enabled !== false,
    triggerRatio: Math.min(0.95, Math.max(0.05, compact.triggerRatio ?? DEFAULT_COMPACT_TRIGGER_RATIO)),
    keepRecent: Math.max(2, compact.keepRecent ?? DEFAULT_COMPACT_KEEP_RECENT),
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
  const generation = Math.max(1, nextCompactGeneration(summary) - 1);
  return [...system, ...buildSummaryPair(summary, generation), ...rest];
}

function trimOldest(messages: LlmMessage[], keepRecent: number): LlmMessage[] {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= keepRecent) return messages;
  return [...system, ...rest.slice(-keepRecent)];
}

function nextCompactGeneration(existingSummary?: string | null): number {
  if (!existingSummary?.trim()) return 1;
  const matches = existingSummary.match(/v(\d+)@/g);
  if (!matches?.length) return 2;
  const nums = matches.map((m) => parseInt(m.replace(/[^\d]/g, ""), 10)).filter(Number.isFinite);
  return (nums.length ? Math.max(...nums) : 1) + 1;
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
}

export interface CompactOptions {
  existingSummary?: string | null;
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
  const generation = nextCompactGeneration(existing);

  if (existing) {
    // 复用摘要时保留压缩边界之后的全部原文，不再用 keepRecent 截断（keepRecent 只用于「再次压缩」切点）
    const cleaned = stripInjectedSummaryMessages(rest);
    const reusedMessages: LlmMessage[] = [
      ...system,
      ...buildSummaryPair(existing, generation - 1),
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

  if (rest.length <= settings.keepRecent + 2) {
    return { messages: working, compacted: false, charThresholdUsed: charThreshold };
  }

  const toSummarize = rest.slice(0, -settings.keepRecent);
  const recent = rest.slice(-settings.keepRecent);

  const transcriptParts: string[] = [];
  if (existing) transcriptParts.push(`[已有摘要]\n${existing}`);
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

    const boundary = buildCompactBoundaryMarker(generation);
    const summaryText = summaryBody;
    const compactedMessages: LlmMessage[] = [...system, ...buildSummaryPair(summaryBody, generation), ...recent];
    const charAfter = estimateChars(compactedMessages);
    console.log(
      `[AutoCompact] ${toSummarize.length} 条消息已压缩（原 ${charBefore} → ${charAfter} 字符，阈值 ${charThreshold}，摘要模型 ${summaryModel}，flush ${memoriesFlushed}）`,
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

/** 压缩结果落库：contextSummary + 边界 ChatMessage（手动/自动/工具共用） */
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

  await services.session.update({
    id: sessionId,
    contextSummary: compacted.summaryText,
    contextCompactedAt: new Date(),
  } as any);

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

  const boundaryMsg = await services.message.create({
    sessionId,
    role: "assistant",
    content: boundaryContent,
    toolCalls: boundaryToolCalls,
    source: "system",
  });
  const boundaryMessageId = boundaryMsg?.success ? (boundaryMsg.data as { id?: string })?.id : undefined;

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
  trigger: CompactPersistTrigger;
  emit?: (event: AgentStreamEvent) => void;
}): Promise<RunSessionCompactResult> {
  const session = await params.services.session.getByIdLite(params.sessionId);
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
    },
  );

  const charThreshold = resolveCompactThresholdForModel(params.config, params.model);
  const charBefore = estimateChars(messages);
  const estimatedRatio = charThreshold > 0 ? Math.min(1, charBefore / charThreshold) : 1;
  const generation = nextCompactGeneration(params.existingSummary);

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
