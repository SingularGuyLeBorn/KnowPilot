/**
 * Agent 运行时 — ReAct 循环 + 工具调用 + 聊天会话
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { resolveEffectiveAgentModel, type LlmMessage } from "./llmClient.js";
import { describeLlmError } from "./resilientLlmClient.js";
import { type StoredToolCall, sanitizePostCompactAssistantContent } from "./chatHistory.js";
import { buildLlmContextSinceCompact } from "./autoCompact.js";
import type { AgentChatInput, AgentRunInput } from "@knowpilot/shared";
import { success, failure } from "../trpc/result.js";
import { runReactLoop, createSyncTransport, withReflection } from "./loop/index.js";
import { buildSystemPromptSkeleton } from "./promptBuilder.js";
import { resolveAgent, logAgentDrift } from "./agentResolver.js";

export interface AgentLoopResult {
  content: string;
  toolCalls: StoredToolCall[];
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  provider: string;
  roundsUsed: number;
  /** W11：内核在 run 入口创建的 Run 行 id（活状态/终态已由内核写回） */
  runId?: string;
}


export async function runAgentLoop(options: {
  config: AppConfig;
  services: ServiceContainer;
  agent: { model: string; systemPrompt: string; tools: string[] };
  messages: LlmMessage[];
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>;
  signal?: AbortSignal;
  /** 工具上下文：传入后 async_task_run / spawn_subagent / sleep(async) 等可在本循环内使用 */
  sessionId?: string;
  agentMeta?: { id: string; name?: string | null; model: string; systemPrompt: string; tools: string[]; tier?: string; parentId?: string | null; workspaceId?: string | null };
  runOrigin?: "user" | "parent" | "heartbeat";
  /** W11：Run.input 业务描述（触发消息等），run 入口落库时写入 */
  runInput?: unknown;
  /** 每完成一轮工具调用后回调，用于异步任务进度日志 */
  onProgress?: (message: string) => void;
}): Promise<AgentLoopResult> {
  const effectiveModel = resolveEffectiveAgentModel(options.config, options.agent.model);
  const result = await runReactLoop({
    config: options.config,
    services: options.services,
    agent: options.agent,
    messages: options.messages,
    invokeTrpc: options.invokeTrpc,
    signal: options.signal,
    sessionId: options.sessionId,
    agentMeta: options.agentMeta,
    runOrigin: options.runOrigin,
    runInput: options.runInput,
    // W7：sync 链路接入反思装饰器（默认关闭）；stream 链路接入点见 agentStream.runAgentLoopStream
    transport: withReflection(createSyncTransport(options.config, effectiveModel), {
      enabled: options.config.reflection.enabled,
      maxRounds: options.config.reflection.maxRounds,
      criticModel: options.config.reflection.criticModel || effectiveModel,
      config: options.config,
    }),
    hooks: {
      onProgress: options.onProgress,
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

export async function runAgent(
  services: ServiceContainer,
  config: AppConfig,
  input: AgentRunInput,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
) {
  const start = Date.now();
  try {
    const { agent, drift } = await resolveAgent(services, input.agentId);
    logAgentDrift(agent.name, drift);
    // 记忆 / tier / 工具引导由 reactLoop 内 contextHooks 在 LLM 调用前注入
    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildSystemPromptSkeleton(agent.systemPrompt),
      },
    ];

    if (input.messages?.length) {
      for (const m of input.messages) {
        messages.push({ role: m.role as LlmMessage["role"], content: m.content });
      }
    } else if (input.input) {
      messages.push({ role: "user", content: input.input });
    } else {
      return failure({
        code: "BAD_REQUEST",
        message: "run 需要 input 或 messages 参数。",
        suggestion: "传入用户问题字符串，或 messages 数组。",
        retryable: false,
        operation: "run",
        entity: "agent",
        durationMs: Date.now() - start,
      });
    }

    const result = await runAgentLoop({
      config,
      services,
      agent,
      messages,
      invokeTrpc,
      sessionId: input.sessionId,
      agentMeta: {
        id: agent.id,
        name: agent.name,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        tier: (agent as { tier?: string }).tier,
        parentId: (agent as { parentId?: string | null }).parentId ?? null,
        workspaceId: (agent as { workspaceId?: string | null }).workspaceId ?? null,
      },
      runInput: input.input ? { input: input.input } : { messages: input.messages },
    });
    // W11：Run 行由内核入口创建（running）并在终态写回；此处仅透传 runId
    return success({
      data: { agentId: agent.id, runId: result.runId, ...result },
      operation: "run",
      entity: "agent",
      durationMs: Date.now() - start,
    });
  } catch (err: unknown) {
    const llm = describeLlmError(err, "检查 .env 中 LLM API Key 是否有效。");
    return failure({
      code: "AGENT_RUN_FAILED",
      message: err instanceof Error ? err.message : String(err),
      suggestion: llm.suggestion,
      retryable: llm.retryable,
      operation: "run",
      entity: "agent",
      durationMs: Date.now() - start,
    });
  }
}

export async function chatAgent(
  services: ServiceContainer,
  config: AppConfig,
  input: AgentChatInput,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
  opts?: { toolsOverride?: string[] },
) {
  const start = Date.now();
  let sessionId = input.sessionId;
  const messageText = input.message?.trim() ?? "";
  const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
  if (!messageText && !hasAttachments) {
    throw new Error("message 不能为空");
  }
  const displayText = messageText || "（见附件）";
  try {
    const { agent, drift } = await resolveAgent(services, input.agentId);
    logAgentDrift(agent.name, drift);
    const effectiveModel = input.model || agent.model;
    const effectiveTools = opts?.toolsOverride?.length ? opts.toolsOverride : agent.tools;

    if (!sessionId) {
      const created = await services.session.create({
        title: displayText.slice(0, 40) || "新对话",
        model: effectiveModel,
        systemPrompt: agent.systemPrompt,
        agentId: agent.id,
      });
      sessionId = created.data!.id;
    }

    await services.message.create({
      sessionId,
      role: "user",
      content: displayText,
      attachments: hasAttachments ? input.attachments : undefined,
    });

    const sessionMeta = await services.session.getByIdLite(sessionId);
    const historyItems = await services.message.listForLlmContext({
      sessionId,
      since: (sessionMeta as { contextCompactedAt?: Date | string | null }).contextCompactedAt,
      limit: 200,
    });
    const messages = buildLlmContextSinceCompact(
      buildSystemPromptSkeleton(agent.systemPrompt),
      historyItems,
      {
        modelId: effectiveModel,
        contextSummary: (sessionMeta as { contextSummary?: string | null }).contextSummary ?? null,
        compactGeneration: (sessionMeta as { compactGeneration?: number | null }).compactGeneration ?? 0,
      },
    );

    // toolsOverride（如 skill_review）需保留 manage 类工具：sub tier 会裁掉 skill_manage
    const effectiveTier = opts?.toolsOverride?.length
      ? agent.tier === "sub"
        ? "manager"
        : agent.tier
      : agent.tier;

    const result = await runAgentLoop({
      config,
      services,
      agent: { ...agent, model: input.model || agent.model, tools: effectiveTools },
      messages,
      invokeTrpc,
      sessionId,
      agentMeta: {
        id: agent.id,
        name: agent.name,
        model: input.model || agent.model,
        systemPrompt: agent.systemPrompt,
        tools: effectiveTools,
        tier: effectiveTier,
        parentId: agent.parentId,
        workspaceId: agent.workspaceId,
      },
      runInput: {
        message: displayText,
        attachments: input.attachments?.length ? input.attachments : undefined,
      },
    });

    const assistantMsg = await services.message.create({
      sessionId,
      role: "assistant",
      content: sanitizePostCompactAssistantContent(result.content, result.toolCalls),
      toolCalls: result.toolCalls,
      tokenUsage: result.tokenUsage,
    });

    // Hermes：有工具调用时沉淀 experience（与 agentStream onDone 同语义）
    void import("./agentEvolution.js")
      .then(({ accumulateExperience }) =>
        accumulateExperience(
          services.prisma,
          services,
          agent.id,
          sessionId!,
          {
            content: result.content,
            toolCalls: result.toolCalls ?? [],
            tokenUsage: result.tokenUsage ?? null,
            roundsUsed: result.roundsUsed ?? 0,
          },
          {
            message: displayText,
            trigger: "chat",
            workspaceId: agent.workspaceId ?? null,
          },
          Date.now() - start,
        ),
      )
      .catch(() => {});

    return success({
      data: {
        sessionId,
        agentId: agent.id,
        message: assistantMsg.data,
        toolCalls: result.toolCalls,
        tokenUsage: result.tokenUsage,
        model: result.model,
        provider: result.provider,
        roundsUsed: result.roundsUsed,
      },
      operation: "chat",
      entity: "agent",
      durationMs: Date.now() - start,
    });
  } catch (err: unknown) {
    const llm = describeLlmError(err, "检查 LLM 配置与会话 ID 是否有效。");
    return failure({
      code: "AGENT_CHAT_FAILED",
      message: err instanceof Error ? err.message : String(err),
      suggestion: llm.suggestion,
      retryable: llm.retryable,
      operation: "chat",
      entity: "agent",
      durationMs: Date.now() - start,
      state: sessionId ? { sessionId } : undefined,
    });
  }
}
