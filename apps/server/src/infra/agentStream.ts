/**
 * Agent 流式聊天 — SSE 事件 + 流式 ReAct 循环 + 多版本 / 编辑 / Skill
 */

import type { Request, Response } from "express";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import {
  resolveEffectiveAgentModel,
  type LlmMessage,
  type LlmToolCall,
} from "./llmClient.js";
import { describeLlmError } from "./resilientLlmClient.js";
import { type StoredToolCall, sanitizePostCompactAssistantContent } from "./chatHistory.js";
import type { AgentChatInput, ChatConfigInput, ChatImageAttachment } from "@knowpilot/shared";
import { formatToolResultHint } from "@knowpilot/shared";
import { buildAllMemoryHints, buildSystemPromptWithHints } from "./promptBuilder.js";
import { resolveAgent, logAgentDrift } from "./agentResolver.js";
import { resolveMicroCompactToolMaxChars, buildLlmContextSinceCompact } from "./autoCompact.js";
import { runReactLoop, createStreamTransport, withReflection } from "./loop/index.js";
import { assertLlmBudget } from "./llmBudget.js";
import { verifyAuthHeader, isAuthEnabled } from "./auth.js";
import {
  appendAssistantVersion,
  buildInitialVersionMeta,
  getActiveAssistantPayload,
} from "./messageVersions.js";
import { SessionStreamHub, type BufferedEvent } from "./sessionStreamHub.js";
import { autoNameSession } from "./sessionAutoName.js";
import { markAgentMessageConsumedByTaskRef } from "./agentMessageLedger.js";

/** SSE 热路径截断：全文仍随 message 落库；timeline 只需要 hint + 预览 */
const TOOL_END_SSE_MAX_CHARS = 2_000;

function truncateToolResultForSse(result: unknown): unknown {
  if (result == null) return result;
  try {
    const raw = typeof result === "string" ? result : JSON.stringify(result);
    if (raw.length <= TOOL_END_SSE_MAX_CHARS) return result;
    return {
      truncated: true,
      preview: raw.slice(0, TOOL_END_SSE_MAX_CHARS),
      originalChars: raw.length,
    };
  } catch {
    return { truncated: true, preview: String(result).slice(0, TOOL_END_SSE_MAX_CHARS) };
  }
}

export type AgentStreamEvent =
  | { type: "session_start"; sessionId: string }
  | { type: "round_start"; round: number }
  | { type: "thinking"; delta: string }
  | { type: "token"; delta: string }
  | { type: "intermediate_content"; content: string; round: number }
  | { type: "tool_start"; toolCallId: string; name: string; args: unknown; round: number }
  | { type: "tool_end"; toolCallId: string; name: string; result: unknown; round: number; hint?: string }
  | {
      type: "done";
      sessionId: string;
      agentId: string;
      content: string;
      toolCalls: StoredToolCall[];
      model: string;
      provider: string;
      roundsUsed: number;
      assistantMessageId?: string;
      versionIndex?: number;
      versionCount?: number;
      tokenUsage?: { prompt: number; completion: number; total: number };
    }
  | { type: "error"; message: string; sessionId?: string; suggestion?: string; retryable?: boolean }
  | { type: "async_delivery"; sessionId: string; jobId: string; status: "done" | "failed"; taskLabel: string }
  /** 异步任务生命周期（入队/开始/取消等），替代 pullAsyncQueue 运行态轮询 */
  | {
      type: "async_job_update";
      sessionId: string;
      jobId: string;
      status: "queued" | "running" | "done" | "cancelled" | "failed";
      taskLabel?: string;
      subagentSessionId?: string;
      stats?: {
        queued: number;
        runningGlobal: number;
        maxGlobal: number;
        maxPerSession: number;
        taskTimeoutMs: number;
      };
    }
  /** Swarm 上级消息到达，替代 pullAgentMessages 轮询 */
  | {
      type: "agent_message";
      sessionId: string;
      agentId: string;
      messageId: string;
      content: string;
      source?: string;
      fromAgentId?: string;
    }
  /** 子会话状态变更，替代 listChildren 轮询 */
  | {
      type: "subagent_session_update";
      parentSessionId: string;
      subagentSessionId: string;
      status: string;
      title?: string;
      agentId?: string | null;
    }
  /** Auto-Compact 阶段：像工具一样在时间线显示，避免静默阻塞 */
  /**
   * W7 反思 verdict（仅 critic 未通过时推送；通过 = 正常路径零噪音）。
   * 前端映射为 __reflection__ 伪工具条进时间线（参照 compact 事件的伪工具模式）。
   */
  | { type: "reflection"; round: number; issues: string[]; action: "retry" | "marked" }
  | { type: "compact_start"; generation: number; estimatedRatio: number; round: 0 }
  | {
      type: "compact_end";
      generation: number;
      summaryPreview: string;
      messagesSummarized: number;
      memoriesFlushed: number;
      charBefore: number;
      charAfter: number;
      boundaryMessageId?: string;
    }
  | { type: "compact_error"; message: string; fallback: "trim" | "none"; generation: number }
  /** Agent 轮换会话：旧会话归档，新会话已创建（前端提示跳转，不自动切换） */
  | {
      type: "session_rotated";
      oldSessionId: string;
      newSessionId: string;
      newTitle: string;
      reason?: string;
    }
  /** 服务端自动消费异步结果后启动了会话流（前端应挂接 listRunning / resume） */
  | {
      type: "session_run_started";
      sessionId: string;
      reason: "async_auto_consume" | "subagent_start";
      jobId?: string;
    }
  /** ChatMessage 写入后广播：前端 reducer 直接 patch messages[]，不再靠 invalidate→refetch 闪烁刷新 */
  | {
      type: "message_upserted";
      sessionId: string;
      message: {
        id: string;
        role: string;
        content: string;
        toolCalls?: unknown;
        toolResults?: unknown;
        tokenUsage?: unknown;
        attachments?: unknown;
        source?: string | null;
        createdAt: string;
      };
    }
  /** ChatMessage 删除后广播：前端 reducer 删对应条目 */
  | {
      type: "message_deleted";
      sessionId: string;
      messageId: string;
    }
  /** Session 自动命名完成：前端刷新侧边栏标题 */
  | { type: "session_title_updated"; sessionId: string; title: string }
  /** Agent 自动命名完成：前端刷新 Agent 树 */
  | { type: "agent_renamed"; agentId: string; name: string }
  /** SessionQueueItem 增删改：前端按 dbId 幂等合并发送队列（superior / child_notify / user） */
  | { type: "session_queue_update"; sessionId: string; kind: string }
  /** ask_user 挂起：Chat 渲染弹框；邮件通道也会推以便 UI 显示「等待邮件回复」 */
  | {
      type: "ask_user_pending";
      sessionId: string;
      askId: string;
      question: string;
      options?: string[];
      channel: "ui" | "email";
      subject?: string;
    }
  /** ask_user 已答复/超时/中止：前端收起弹框 */
  | {
      type: "ask_user_resolved";
      sessionId: string;
      askId: string;
      outcome: "answered" | "expired" | "aborted";
    }
  /** SwarmOrchestrator 任务状态推到父会话（去重/排队/完成/失败），替代盲轮询 */
  | {
      type: "swarm_task_update";
      sessionId: string;
      jobId: string;
      origin: string;
      taskLabel: string;
      status: "queued" | "running" | "duplicate" | "completed" | "failed";
      error?: string;
      subagentSessionId?: string;
    };

function writeSse(res: Response, event: AgentStreamEvent, eventId?: number) {
  // P7：合并为单次 res.write，减少高频吐字下的系统调用（原为 event 行 + data 行两次 write）
  // id 行 = per-session seq（与 SessionStreamEvent.seq / resumeAfter 同源）
  const idLine = typeof eventId === "number" ? `id: ${eventId}\n` : "";
  res.write(`${idLine}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

// R5：历史消息加载统一分页上限。此前 prepareMessage 用 200、主流程用 100 不一致，
// >100 条历史时主流程会截断更早消息（LLM 上下文丢失早期轮次）。统一为 200。
const HISTORY_PAGE_SIZE = 200;

interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  enableReasoning?: boolean;
  reasoningEffort?: import("@knowpilot/shared").ReasoningEffort;
}

interface PrepareResult {
  messageText: string;
  skipUserCreate: boolean;
  excludeAssistantId?: string;
  updateAssistantId?: string;
  attachments?: ChatImageAttachment[];
  userMessageMeta?: { skill?: { id: string; name: string; icon?: string | null } };
}

export async function runAgentLoopStream(options: {
  config: AppConfig;
  services: ServiceContainer;
  agent: { model: string; systemPrompt: string; tools: string[] };
  messages: LlmMessage[];
  llmOptions: LlmCallOptions;
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>;
  emit: (event: AgentStreamEvent) => void;
  sessionId?: string;
  agentMeta?: { id: string; model: string; systemPrompt: string; tools: string[]; tier?: string; workspaceId?: string | null; parentId?: string | null };
  signal?: AbortSignal;
  runOrigin?: "user" | "parent" | "heartbeat";
  /** W11：Run.input 业务描述（触发消息等），run 入口落库时写入 */
  runInput?: unknown;
}): Promise<{
  content: string;
  toolCalls: StoredToolCall[];
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  provider: string;
  roundsUsed: number;
  /** W11：内核在 run 入口创建的 Run 行 id（活状态/终态已由内核写回） */
  runId?: string;
}> {
  const effectiveModel = resolveEffectiveAgentModel(options.config, options.agent.model);
  const roundRef = { current: 0 };
  const hub = options.sessionId
    ? (await import("./sessionStreamHub.js")).getStreamHub()
    : null;
  // W7：stream 链路接入反思装饰器（默认关闭，开启后与 sync 链路同一评估点/消费点：
  // withTools 且零 toolCalls 的终轮 = reactLoop 唯一正常 done 进入点，verdict 消费在 loop 内核）
  const transport = withReflection(
    createStreamTransport(
      options.config,
      effectiveModel,
      options.llmOptions,
      {
        onThinking: (_round, delta) => options.emit({ type: "thinking", delta }),
        onToken: (delta) => options.emit({ type: "token", delta }),
      },
      () => roundRef.current,
    ),
    {
      enabled: options.config.reflection.enabled,
      maxRounds: options.config.reflection.maxRounds,
      criticModel: options.config.reflection.criticModel || effectiveModel,
      config: options.config,
    },
  );

  const result = await runReactLoop({
    config: options.config,
    services: options.services,
    agent: { ...options.agent, model: effectiveModel },
    messages: options.messages,
    invokeTrpc: options.invokeTrpc,
    signal: options.signal,
    sessionId: options.sessionId,
    agentMeta: options.agentMeta,
    runOrigin: options.runOrigin ?? "user",
    runInput: options.runInput,
    transport,
    toolResultMaxChars: resolveMicroCompactToolMaxChars(options.config),
    compactEmit: options.emit,
    runQueues:
      options.sessionId && hub
        ? {
            takeSteer: () => hub.takeInject(options.sessionId!, "steer"),
            takeFollowUp: () => hub.takeInject(options.sessionId!, "follow_up"),
          }
        : undefined,
    hooks: {
      onRoundStart: (round) => {
        roundRef.current = round;
        options.emit({ type: "round_start", round });
      },
      onIntermediateContent: (round, content) => {
        options.emit({ type: "intermediate_content", content, round });
      },
      onToolStart: ({ toolCallId, name, args, round }) => {
        options.emit({ type: "tool_start", toolCallId, name, args, round });
      },
      onToolEnd: ({ toolCallId, name, result, round }) => {
        options.emit({
          type: "tool_end",
          toolCallId,
          name,
          result: truncateToolResultForSse(result),
          round,
          hint: formatToolResultHint(result) ?? undefined,
        });
      },
      onReflection: ({ round, issues, action }) => {
        options.emit({ type: "reflection", round, issues, action });
      },
      // 注入落库后 MessageService 会广播 message_upserted，无需额外 SSE
    },
  });

  return {
    content: result.content,
    toolCalls: result.toolCalls,
    tokenUsage: result.tokenUsage,
    model: result.model,
    provider: result.provider,
    roundsUsed: result.roundsUsed,
    runId: result.runId,
  };
}

async function prepareMessage(
  services: ServiceContainer,
  input: AgentChatInput,
): Promise<PrepareResult> {
  const loadHistory = async (sessionId: string) => {
    const res = await services.message.list({ sessionId, page: 1, pageSize: HISTORY_PAGE_SIZE });
    return res.items;
  };

  if (input.editMessageId && input.sessionId) {
    const items = await loadHistory(input.sessionId);
    const idx = items.findIndex((m) => m.id === input.editMessageId);
    if (idx === -1) throw new Error(`消息 ${input.editMessageId} 不存在`);
    if (items[idx].role !== "user") throw new Error("只能编辑用户消息");
    const newContent = input.editContent!.trim();
    await services.message.update({ id: input.editMessageId, content: newContent });
    // A5：编辑后删除尾部消息改为单次 deleteMany，避免 K 次逐条往返
    const tailIds = items.slice(idx + 1).map((m) => m.id);
    if (tailIds.length > 0) {
      await services.prisma.chatMessage.deleteMany({ where: { id: { in: tailIds } } });
      // deleteMany 绕过 MessageService.afterDelete，需手动推 message_deleted SSE，
      // 否则前端 MessageStore 残留被删消息直到 hydrate 兜底才消失
      try {
        const { getStreamHub } = await import("./sessionStreamHub.js");
        const hub = getStreamHub();
        if (hub) {
          for (const tailId of tailIds) {
            hub.pushExternalEvent(input.sessionId, {
              type: "message_deleted",
              sessionId: input.sessionId,
              messageId: tailId,
            });
          }
        }
      } catch {
        /* ignore SSE */
      }
    }
    return { messageText: newContent, skipUserCreate: true };
  }

  if (input.regenerate && input.sessionId) {
    const items = await loadHistory(input.sessionId);
    let userIdx = -1;
    if (input.regenerateUserMessageId) {
      userIdx = items.findIndex((m) => m.id === input.regenerateUserMessageId);
      if (userIdx === -1) throw new Error("找不到指定的用户消息");
      if (items[userIdx].role !== "user") throw new Error("只能对 user 消息重新生成");
    } else {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].role === "user") {
          userIdx = i;
          break;
        }
      }
    }
    if (userIdx === -1) throw new Error("没有可重新生成的用户消息");

    const assistantAfter = items[userIdx + 1]?.role === "assistant" ? items[userIdx + 1] : null;
    return {
      messageText: items[userIdx].content,
      skipUserCreate: true,
      excludeAssistantId: assistantAfter?.id,
      updateAssistantId: assistantAfter?.id,
    };
  }

  if (input.retryFromMessageId && input.sessionId) {
    const items = await loadHistory(input.sessionId);
    const idx = items.findIndex((m) => m.id === input.retryFromMessageId);
    if (idx === -1) throw new Error(`消息 ${input.retryFromMessageId} 不存在`);
    if (items[idx].role !== "user") throw new Error("只能重试用户消息");
    const assistantAfter = items[idx + 1]?.role === "assistant" ? items[idx + 1] : null;
    return {
      messageText: items[idx].content,
      skipUserCreate: true,
      excludeAssistantId: assistantAfter?.id,
      updateAssistantId: assistantAfter?.id,
    };
  }

  const messageText = input.message?.trim() ?? "";
  const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
  if (!messageText && !hasAttachments) throw new Error("message 不能为空");
  return {
    messageText: messageText || "（见附件）",
    skipUserCreate: false,
    attachments: input.attachments,
  };
}

async function resolveSkillPrompt(
  services: ServiceContainer,
  skillId?: string,
): Promise<{ prompt?: string; meta?: PrepareResult["userMessageMeta"] }> {
  if (!skillId) return {};
  try {
    const skill = await services.skill.getById(skillId);
    if (!skill) throw new Error(`Skill ${skillId} 不存在`);
    if (!skill.enabled) throw new Error(`Skill ${skill.name} 已禁用`);
    const prompt = `# Skill: ${skill.name}\n\n${skill.description}\n\n${skill.code}`;
    return {
      prompt,
      meta: { skill: { id: skill.id, name: skill.name, icon: skill.icon } },
    };
  } catch (err: unknown) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function resolveLlmOptions(config?: ChatConfigInput): LlmCallOptions {
  return {
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
    enableReasoning: config?.enableReasoning,
    reasoningEffort: config?.reasoningEffort,
  };
}

export async function chatAgentStream(
  services: ServiceContainer,
  config: AppConfig,
  input: AgentChatInput,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
  emit: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const start = Date.now();
  let sessionId = input.sessionId;
  let partialContent = "";
  const partialToolCalls: StoredToolCall[] = [];
  let prepared: PrepareResult | undefined;

  try {
    assertLlmBudget(config);
    const { agent, drift } = await resolveAgent(services, input.agentId);
    logAgentDrift(agent.name, drift);
    const skillResolved = await resolveSkillPrompt(services, input.skillId);
    prepared = await prepareMessage(services, input);

    const effectiveModel = resolveEffectiveAgentModel(config, input.model || agent.model);
    let effectiveSystemPrompt =
      skillResolved.prompt ??
      (input.config?.systemPrompt !== undefined ? input.config.systemPrompt : agent.systemPrompt);

    // 前端 chatConfig 可覆盖工具超时与最大轮数（0/缺省走全局默认）
    const effectiveConfig: AppConfig = {
      ...config,
      llm: {
        ...config.llm,
        ...(input.config?.toolCallTimeoutMs ? { toolCallTimeoutMs: input.config.toolCallTimeoutMs } : {}),
        ...(input.config?.maxToolRounds ? { maxToolRounds: input.config.maxToolRounds } : {}),
      },
    };

    if (!sessionId) {
      // 若该 Agent 已有空的主 session（管理 Agent / 超级 Agent 启动时自动创建），
      // 首条对话复用它，避免「空主会话 + 又新建一个会话」并存。
      const mainSession = await services.prisma.chatSession.findFirst({
        where: {
          agentId: agent.id,
          isMainSession: true,
          status: { notIn: ["deleted", "archived"] },
        },
        select: { id: true, title: true, _count: { select: { messages: true } } },
      });
      if (mainSession && mainSession._count.messages === 0) {
        sessionId = mainSession.id;
        const nextTitle = prepared.messageText.slice(0, 40) || mainSession.title || "新对话";
        await services.session.update({
          id: sessionId,
          title: nextTitle,
          model: effectiveModel,
          ...(effectiveSystemPrompt !== undefined ? { systemPrompt: effectiveSystemPrompt } : {}),
        });
        emit({ type: "session_start", sessionId });
      } else {
        const created = await services.session.create({
          title: prepared.messageText.slice(0, 40) || "新对话",
          model: effectiveModel,
          systemPrompt: effectiveSystemPrompt,
          agentId: agent.id,
        });
        sessionId = created.data!.id;
        // 让前端尽早拿到 sessionId，以便刷新/切 tab 后能按真实 sessionId 恢复流式状态
        emit({ type: "session_start", sessionId });
      }
    } else if (input.model || input.config?.systemPrompt !== undefined || skillResolved.prompt || input.agentId) {
      await services.session.update({
        id: sessionId,
        ...(input.model ? { model: input.model } : {}),
        ...(effectiveSystemPrompt !== undefined ? { systemPrompt: effectiveSystemPrompt } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
    }

    // 自动命名：不管新建还是已有 session，都 fire-and-forget。
    // autoNameSession 内部幂等：autoName 已有值 或 msgCount>1 都跳过，不会重复命名。
    void autoNameSession(sessionId, prepared.messageText);

    if (!prepared.skipUserCreate) {
      const src = input.source ?? "user";
      // 上级任务 / 系统恢复消息：若已存在同内容 user 消息，禁止再写第二条气泡。
      // 系统恢复消息（src=system）只在 resume 流程注入；重复 resume 时跳过写入即可，
      // 但不应因已有 assistant 回复而早退——服务恢复后仍要继续跑 LLM 推进对话。
      if ((src === "super" || src === "manager" || src === "system") && sessionId) {
        const dup = await services.prisma.chatMessage.findFirst({
          where: { sessionId, role: "user", content: prepared.messageText },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
        if (dup) {
          prepared.skipUserCreate = true;
          if (src !== "system") {
            const alreadyAssistant = await services.prisma.chatMessage.findFirst({
              where: {
                sessionId,
                role: "assistant",
                createdAt: { gte: dup.createdAt },
              },
              select: { id: true, content: true, toolCalls: true },
              orderBy: { createdAt: "desc" },
            });
            if (alreadyAssistant) {
              // 任务已被 autoRun 处理完：直接结束，避免二次跑 LLM
              emit({
                type: "done",
                sessionId,
                agentId: agent.id,
                content: alreadyAssistant.content || "",
                toolCalls: (alreadyAssistant.toolCalls as any) ?? [],
                model: effectiveModel,
                provider: config.llm.defaultProvider,
                roundsUsed: 0,
                assistantMessageId: alreadyAssistant.id,
                versionIndex: 0,
                versionCount: 1,
              });
              return;
            }
          }
        }
      }
    }

    if (!prepared.skipUserCreate) {
      await services.message.create({
        sessionId,
        role: "user",
        content: prepared.messageText,
        attachments: prepared.attachments?.length ? prepared.attachments : undefined,
        toolResults: skillResolved.meta
          ? { skill: skillResolved.meta.skill, ...(input.toolResults ?? {}), ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}) }
          : (input.toolResults
            ? { ...input.toolResults, ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}) }
            : input.clientMessageId
              ? { clientMessageId: input.clientMessageId }
              : undefined),
        source: input.source ?? "user",
      });
    }

    const sessionMeta = await services.session.getByIdLite(sessionId);
    const historyItems = await services.message.listForLlmContext({
      sessionId,
      since: (sessionMeta as { contextCompactedAt?: Date | string | null }).contextCompactedAt,
      limit: HISTORY_PAGE_SIZE,
    });
    const historyBase = prepared!.excludeAssistantId
      ? historyItems.filter((m) => m.id !== prepared!.excludeAssistantId)
      : historyItems;
    // 供下方 updateAssistantId 查找；与 LLM 窗口同源
    const history = { items: historyItems };

    const memoryHint = await buildAllMemoryHints(services, prepared.messageText, {
      agentId: (agent as { id?: string }).id,
      sessionId,
    });
    const messages = buildLlmContextSinceCompact(
      buildSystemPromptWithHints(effectiveSystemPrompt || agent.systemPrompt, agent.tools, memoryHint, {
        tier: (agent as { tier?: string }).tier,
        name: (agent as { name?: string }).name,
      }),
      historyBase,
      {
        modelId: effectiveModel,
        microCompactToolMaxChars: resolveMicroCompactToolMaxChars(effectiveConfig),
        contextSummary: (sessionMeta as { contextSummary?: string | null }).contextSummary ?? null,
        compactGeneration: (sessionMeta as { compactGeneration?: number | null }).compactGeneration ?? 0,
      },
    );

    // W14：异步结果气泡已随会话历史进入本轮 ReAct 上下文 → 关联 AgentMessage 记账 consumed。
    // 核实路径：两条认领路径（服务端 autoConsumeAsyncDelivery / 前端 drain consumeQueue）都把
    // toolResults.subagentResult.jobId 带进 chatAgentStream，在此处（历史加载 + LLM messages 构建完成、
    // 即将交给 runAgentLoopStream）是「被读入上下文」的唯一精确挂点。按 taskRef=jobId 幂等。
    const subagentJobId = (input.toolResults as { subagentResult?: { jobId?: unknown } } | undefined)
      ?.subagentResult?.jobId;
    if (typeof subagentJobId === "string" && subagentJobId) {
      try {
        await markAgentMessageConsumedByTaskRef(services.prisma, subagentJobId);
      } catch (ledgerErr) {
        console.warn(`[agentStream] AgentMessage consumed 记账失败 job=${subagentJobId}:`, ledgerErr);
      }
    }

    let currentRound = 1;
    const toolArgsMap = new Map<string, unknown>();
    const trackingEmit = (event: AgentStreamEvent) => {
      if (event.type === "round_start") {
        currentRound = event.round;
      }
      if (event.type === "token" && event.delta) {
        partialContent += event.delta;
      }
      if (event.type === "thinking" && event.delta) {
        const id = `think_${currentRound}`;
        const existing = partialToolCalls.find((t) => t.id === id);
        if (existing) {
          existing.result = String(existing.result ?? "") + event.delta;
        } else {
          partialToolCalls.push({
            id,
            name: "__thinking__",
            args: { round: currentRound },
            result: event.delta,
            kind: "thinking",
          });
        }
      }
      if (event.type === "intermediate_content" && event.content) {
        const id = `content_${currentRound}`;
        const existing = partialToolCalls.find((t) => t.id === id);
        if (existing) {
          existing.result = String(existing.result ?? "") + event.content;
        } else {
          partialToolCalls.push({
            id,
            name: "__content__",
            args: { round: currentRound },
            result: event.content,
            kind: "content",
          });
        }
      }
      if (event.type === "tool_start" && event.toolCallId) {
        toolArgsMap.set(event.toolCallId, event.args);
      }
      if (event.type === "tool_end" && event.toolCallId) {
        partialToolCalls.push({
          id: event.toolCallId,
          name: event.name,
          args: toolArgsMap.get(event.toolCallId) ?? {},
          result: event.result,
          kind: "tool",
        });
      }
      emit(event);
    };

    const result = await runAgentLoopStream({
      config: effectiveConfig,
      services,
      agent: { ...agent, model: effectiveModel },
      messages,
      llmOptions: resolveLlmOptions(input.config),
      invokeTrpc,
      emit: trackingEmit,
      sessionId,
      agentMeta: {
        id: agent.id,
        model: effectiveModel,
        systemPrompt: effectiveSystemPrompt || agent.systemPrompt,
        tools: agent.tools,
        tier: (agent as any).tier ?? "sub",
        workspaceId: (agent as any).workspaceId ?? null,
        parentId: (agent as any).parentId ?? null,
      },
      signal,
      runOrigin: input.runOrigin,
      runInput: {
        message: prepared!.messageText,
        regenerate: input.regenerate,
        edit: input.editMessageId,
        skillId: input.skillId,
        trigger: "user", // #42：标记触发来源
      },
    });

    let assistantMessageId: string | undefined;
    let versionIndex = 0;
    let versionCount = 1;

    if (prepared!.updateAssistantId) {
      const existing = history.items.find((m) => m.id === prepared!.updateAssistantId);
      if (existing) {
        const { versionMeta } = getActiveAssistantPayload(existing);
        const nextMeta = appendAssistantVersion(versionMeta, result.content, result.toolCalls);
        versionIndex = nextMeta.activeIndex;
        versionCount = nextMeta.versions.length;
        const active = nextMeta.versions[versionIndex];
        await services.message.update({
          id: prepared.updateAssistantId,
          content: active.content,
          toolCalls: active.toolCalls,
          toolResults: { versionMeta: nextMeta },
        });
        assistantMessageId = prepared.updateAssistantId;
      }
    }

    // A12：assistant 消息写入 + Run 终态合并写合并为单次 $transaction，减少 SQLite 单连接下的 commit 次数。
    // W11：Run 行已由内核在 run 入口创建（running）并在 done 终态写回；此处仅把 assistantMessageId
    // 合并进既有 output（读-改-写保内核字段不丢）。
    const runId = result.runId;
    assistantMessageId = await services.prisma.$transaction(async (tx) => {
      if (!assistantMessageId) {
        const initial = buildInitialVersionMeta(result.content, result.toolCalls);
        const created = await tx.chatMessage.create({
          data: {
            sessionId,
            role: "assistant",
            content: result.content,
            toolCalls: result.toolCalls,
            toolResults: initial.toolResults,
            tokenUsage: result.tokenUsage,
          } as any,
        });
        assistantMessageId = created.id;
      }

      if (runId) {
        const existingRun = await tx.run.findUnique({ where: { id: runId }, select: { output: true } });
        const baseOutput =
          existingRun?.output && typeof existingRun.output === "object"
            ? (existingRun.output as Record<string, unknown>)
            : {};
        await tx.run.update({
          where: { id: runId },
          data: { output: { ...baseOutput, assistantMessageId } },
        });
      }
      return assistantMessageId;
    });

    // 契约对齐：assistant 消息走裸 tx.chatMessage.create 绕过了 MessageService.afterCreate，
    // 必须补发 message_upserted，否则 async-stream EventSource 收不到 →
    // 服务端自启动的运行（autoConsume / 心跳 / 触发器）在前端没消费 agent 流时，
    // assistant 消息只能靠刷新重 hydrate 才出现（DB 有、store 没有）。
    // done 事件只投递给「正在消费 agent 流」的订阅者；message_upserted 才是 MessageStore 的统一入口。
    try {
      const { getStreamHub } = await import("./sessionStreamHub.js");
      getStreamHub()?.pushExternalEvent(sessionId!, {
        type: "message_upserted",
        sessionId: sessionId!,
        message: {
          id: assistantMessageId,
          role: "assistant",
          content: result.content,
          toolCalls: result.toolCalls ?? undefined,
          toolResults: undefined,
          tokenUsage: result.tokenUsage ?? undefined,
          attachments: undefined,
          source: null,
          createdAt: new Date().toISOString(),
        },
      });
    } catch {
      /* StreamHub 未初始化，忽略 */
    }

    // Agent 进化：经验自动积累（每次 Run 完成后写入 Memory）
    import("./agentEvolution.js")
      .then(({ accumulateExperience }) =>
        accumulateExperience(services.prisma, services, agent.id, sessionId!, result, {
          message: prepared!.messageText,
          trigger: "user",
          // W5-followup：传入 Agent 所属 Workspace，经验同步沉淀到 workspace 层（兄弟 Agent 可见）
          workspaceId: (agent as any).workspaceId ?? null,
        }, Date.now() - start),
      )
      .catch(() => { /* 经验积累失败不阻塞 */ });

    // Goal 外环：回合后裁判；CONTINUE 写 pendingContinue，由 onHubRunSettled 起下一轮
    try {
      const { evaluateGoalAfterTurn } = await import("./goalLoop.js");
      await evaluateGoalAfterTurn({
        services,
        config: effectiveConfig,
        sessionId: sessionId!,
        lastAssistantText: result.content ?? "",
        mainModel: result.model || effectiveModel,
      });
    } catch {
      /* goal 裁判失败不阻塞 done */
    }

    // Hermes：回合后 skill background review（达 nudge 阈值才调度；不阻塞 done）
    try {
      const { maybeSpawnSkillBackgroundReview } = await import("./skillBackgroundReview.js");
      maybeSpawnSkillBackgroundReview({
        config: effectiveConfig,
        services,
        agentId: agent.id,
        sessionId: sessionId!,
        toolCalls: result.toolCalls ?? [],
      });
    } catch {
      /* 审查调度失败不阻塞 */
    }

    emit({
      type: "done",
      sessionId,
      agentId: agent.id,
      content: result.content,
      toolCalls: result.toolCalls,
      model: result.model,
      provider: result.provider,
      roundsUsed: result.roundsUsed,
      assistantMessageId,
      versionIndex,
      versionCount,
      tokenUsage: result.tokenUsage,
    });
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.message.includes("用户中断") ||
        err.message.includes("已中止") ||
        err.message.includes("已被主动取消") ||
        err.message.includes("超时被中止") ||
        err.message.includes("调度层中止") ||
        err.message.includes("会话已停止"));
    if (isAbort && sessionId && (partialContent.trim() || partialToolCalls.length > 0)) {
      try {
        if (prepared?.updateAssistantId) {
          const existing = await services.message.getById(prepared.updateAssistantId);
          const { versionMeta } = getActiveAssistantPayload(existing);
          const nextMeta = appendAssistantVersion(versionMeta, partialContent.trim(), partialToolCalls);
          const active = nextMeta.versions[nextMeta.activeIndex];
          await services.message.update({
            id: prepared.updateAssistantId,
            content: active.content,
            toolCalls: active.toolCalls,
            toolResults: { versionMeta: nextMeta },
            finishReason: "aborted",
          });
        } else {
          const initial = buildInitialVersionMeta(partialContent.trim(), partialToolCalls);
          await services.message.create({
            sessionId,
            role: "assistant",
            content: partialContent.trim(),
            toolCalls: partialToolCalls,
            toolResults: initial.toolResults,
            finishReason: "aborted",
          });
        }
      } catch (saveErr) {
        console.error("[chatAgentStream] 保存中断消息失败:", saveErr);
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    const isBudget = message.includes("LLM 预算");
    const llm = describeLlmError(err, "检查 LLM 配置与会话 ID 是否有效。");
    emit({
      type: "error",
      message,
      sessionId,
      retryable: isBudget ? false : llm.retryable,
      suggestion: isBudget
        ? "可在 .env 提高 LLM_DAILY_BUDGET，或明日再试。"
        : llm.suggestion,
    });
  }
}

/** 切换 assistant 消息版本（不调 LLM） */
export async function switchAssistantMessageVersion(
  services: ServiceContainer,
  messageId: string,
  versionIndex: number,
) {
  const msg = await services.message.getById(messageId);
  if (!msg) throw new Error(`消息 ${messageId} 不存在`);
  if (msg.role !== "assistant") throw new Error("只能切换 assistant 消息版本");

  const { versionMeta } = getActiveAssistantPayload(msg);
  if (versionIndex < 0 || versionIndex >= versionMeta.versions.length) {
    throw new Error(`版本索引 ${versionIndex} 无效`);
  }
  const nextMeta = { ...versionMeta, activeIndex: versionIndex };
  const active = nextMeta.versions[versionIndex];
  return services.message.update({
    id: messageId,
    content: active.content,
    toolCalls: active.toolCalls,
    toolResults: { versionMeta: nextMeta },
  });
}

/** Express SSE handler: POST /api/agent/chat/stream（启动运行）/ GET（续传） */
export function handleAgentChatStream(
  services: ServiceContainer,
  config: AppConfig,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
  hub: SessionStreamHub,
) {
  return async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // P8：禁用 nginx / Cloudflare Tunnel 等反代对 SSE 的缓冲，否则前端收不到实时流
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    if (isAuthEnabled(config) && !verifyAuthHeader(config, req.headers.authorization)) {
      writeSse(res, { type: "error", message: "未授权：请先登录后再使用 Chat 流式接口。" });
      res.end();
      return;
    }

    const isPost = req.method === "POST";
    const body = (req.body ?? {}) as AgentChatInput & { resumeAfter?: number };
    const requestSessionId = body.sessionId || String(req.query.sessionId || "");
    const afterEventId = Number(body.resumeAfter ?? req.query.resumeAfter ?? 0);
    // POST 且未带 sessionId 时，先以空字符串在 Hub 中占位；等 chatAgentStream 创建真实 session 后再迁移。
    let runSessionId = requestSessionId;

    if (!requestSessionId && !isPost) {
      writeSse(res, { type: "error", message: "缺少 sessionId" });
      res.end();
      return;
    }

    if (isPost) {
      const valid =
        body?.regenerate ||
        body?.retryFromMessageId ||
        body?.editMessageId ||
        (typeof body?.message === "string" && body.message.trim().length > 0);

      if (!valid) {
        writeSse(res, { type: "error", message: "message 不能为空" });
        res.end();
        return;
      }

      // 已归档会话禁止继续发消息（session_rotate 后应去新会话）
      if (requestSessionId) {
        try {
          const sess = await services.session.getByIdLite(requestSessionId);
          if (sess?.status === "archived") {
            writeSse(res, {
              type: "error",
              message: "该会话已归档，请前往新会话继续对话。",
              sessionId: requestSessionId,
              suggestion: sess.rotatedToSessionId
                ? `新会话 id：${sess.rotatedToSessionId}`
                : "请在左侧会话列表打开续写会话。",
            });
            res.end();
            return;
          }
        } catch {
          /* 会话不存在时交给后续逻辑报错 */
        }
      }

      // 幂等：若已有运行中的任务，不再重复启动（可能是前端重连时误发了 POST）
      try {
        await hub.startIfNotRunning(runSessionId, body, (emit, signal) =>
          chatAgentStream(services, config, body, invokeTrpc, emit, signal),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[agentStream] 启动会话 ${runSessionId} Agent 流失败:`, err);
        writeSse(res, { type: "error", message: `启动失败：${message}` });
        res.end();
        return;
      }
    }

    if (!hub.isRunning(runSessionId) && afterEventId === 0) {
      // 不是 POST 且没有运行中的任务，也没有要续传的历史事件
      writeSse(res, { type: "error", message: "该会话没有运行中的 Agent 流" });
      res.end();
      return;
    }

    // 订阅并续传
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      if (tokenFlushTimer) {
        clearTimeout(tokenFlushTimer);
        tokenFlushTimer = null;
      }
      unsubscribe();
      res.end();
    };

    // R2：token 事件合并 —— 累加 delta 到 tokenBuffer，16ms 定时器冲刷为单帧；
    // 非 token 事件先冲刷 tokenBuffer 再发送，保证事件顺序。
    // 合帧携带帧内最后一个事件的 seq，确保 lastEventId 随 token 前进。
    let tokenBuffer = "";
    let tokenFlushSeq: number | undefined;
    let tokenFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushTokens = () => {
      if (tokenFlushTimer) {
        clearTimeout(tokenFlushTimer);
        tokenFlushTimer = null;
      }
      if (tokenBuffer) {
        writeSse(res, { type: "token", delta: tokenBuffer }, tokenFlushSeq);
        tokenBuffer = "";
        tokenFlushSeq = undefined;
      }
    };

    const { unsubscribe, replayHadTerminal } = await hub.subscribe(
      runSessionId,
      afterEventId,
      async (buffered: BufferedEvent) => {
        const event = buffered.event;
        // POST 占位 sessionId 迁移到真实 sessionId，确保刷新/切 tab 后的 GET 续传能命中同一运行。
        if (event.type === "session_start" && event.sessionId && !requestSessionId) {
          if (runSessionId !== event.sessionId) {
            await hub.migrateSessionId(runSessionId, event.sessionId);
            runSessionId = event.sessionId;
          }
        }
        if (event.type === "token") {
          tokenBuffer += event.delta;
          tokenFlushSeq = buffered.id;
          if (tokenBuffer.length >= 512) {
            flushTokens();
          } else if (!tokenFlushTimer) {
            tokenFlushTimer = setTimeout(flushTokens, 16);
          }
        } else {
          flushTokens();
          writeSse(res, event, buffered.id);
        }
        if (event.type === "done" || event.type === "error") {
          flushTokens();
          setTimeout(end, 0);
        }
      },
    );

    // 心跳：防止浏览器/反代因长时间无数据关闭空闲连接
    const heartbeat = setInterval(() => {
      if (!ended) {
        flushTokens();
        res.write(": keepalive\n\n");
      }
    }, 5000);

    res.on("close", () => {
      end();
      // 为什么只取消订阅：后台 Agent 运行可能承载异步任务/子 Agent，abort 会随前端关闭而强制中断它们
    });

    // 订阅时运行已结束：必须显式发 done 让前端从 streaming 归位到 idle，
    // 否则前端会进入无意义重连循环（12 次 ~2min），期间一直卡 "Thinking..."。
    // 若重放已含真实 done/error，禁止再补发 synthetic done（避免双发）。
    if (!hub.isRunning(runSessionId) && ended === false && !replayHadTerminal) {
      setTimeout(() => {
        flushTokens();
        writeSse(res, {
          type: "done",
          sessionId: runSessionId,
          agentId: "",
          content: "",
          toolCalls: [],
          model: "",
          provider: "",
          roundsUsed: 0,
        } as AgentStreamEvent);
        end();
      }, 0);
    }
  };
}

/** Express handler: POST /api/agent/chat/stop */
export function handleAgentChatStop(hub: SessionStreamHub) {
  return (req: Request, res: Response) => {
    const sessionId = (req.body as { sessionId?: string }).sessionId;
    if (!sessionId) {
      res.status(400).json({ error: "缺少 sessionId" });
      return;
    }
    const stopped = hub.stop(sessionId);
    res.json({ stopped });
  };
}

export type { LlmToolCall };
