/**
 * Agent 运行时 — ReAct 循环 + 工具调用 + 聊天会话
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { resolveEffectiveAgentModel, type LlmMessage } from "./llmClient.js";
import { describeLlmError } from "./resilientLlmClient.js";
import { buildLlmMessagesFromHistory, type StoredToolCall, sliceHistoryAfterCompactBoundary, sanitizePostCompactAssistantContent } from "./chatHistory.js";
import type { AgentChatInput, AgentRunInput } from "@knowpilot/shared";
import { success, failure } from "../trpc/result.js";
import { runReactLoop, createSyncTransport } from "./loop/index.js";
import { buildMemoryContext, buildSystemPromptWithHints } from "./promptBuilder.js";
import { resolveAgent } from "./agentResolver.js";
export {
  DEFAULT_SUBAGENT_TOOLS,
  resolveToolsForAgentTier,
  parseToolCall,
} from "./loop/setup.js";
// W4：兼容 re-export。新代码请直接引 ./promptBuilder.js / ./agentResolver.js（叶子模块），
// 不要经 agentRuntime 中转——本文件在 ReAct 环内，经它引用会重建循环依赖。
export {
  buildMemoryContext,
  buildAgentToolGuide,
  buildTierIdentityHint,
  buildSystemPromptWithHints,
} from "./promptBuilder.js";
export { resolveAgent } from "./agentResolver.js";

export interface AgentLoopResult {
  content: string;
  toolCalls: StoredToolCall[];
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  provider: string;
  roundsUsed: number;
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
  agentMeta?: { id: string; model: string; systemPrompt: string; tools: string[]; tier?: string; parentId?: string | null; workspaceId?: string | null };
  runOrigin?: "user" | "parent" | "heartbeat";
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
    transport: createSyncTransport(options.config, effectiveModel),
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
    const agent = await resolveAgent(services, input.agentId);
    const memoryHint = input.input ? await buildMemoryContext(services, input.input, { agentId: agent.id }) : "";
    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildSystemPromptWithHints(agent.systemPrompt, agent.tools, memoryHint, {
          tier: agent.tier,
          name: agent.name,
        }),
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

    const result = await runAgentLoop({ config, services, agent, messages, invokeTrpc });
    const runRecord = await services.run.create({
      agentId: agent.id,
      sessionId: input.sessionId,
      status: "success",
      input: input.input ? { input: input.input } : { messages: input.messages },
      output: { content: result.content },
      toolCalls: result.toolCalls,
      tokenUsage: result.tokenUsage,
      durationMs: Date.now() - start,
    });

    return success({
      data: { agentId: agent.id, runId: runRecord.data?.id, ...result },
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
    const agent = await resolveAgent(services, input.agentId);
    const effectiveModel = input.model || agent.model;

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

    const history = await services.message.list({ sessionId, page: 1, pageSize: 50 });
    const memoryHint = await buildMemoryContext(services, displayText, { agentId: agent.id });
    const messages = buildLlmMessagesFromHistory(
      buildSystemPromptWithHints(agent.systemPrompt, agent.tools, memoryHint, {
        tier: agent.tier,
        name: agent.name,
      }),
      sliceHistoryAfterCompactBoundary(history.items),
      { modelId: effectiveModel },
    );

    const result = await runAgentLoop({
      config,
      services,
      agent: { ...agent, model: input.model || agent.model },
      messages,
      invokeTrpc,
      sessionId,
      agentMeta: {
        id: agent.id,
        model: input.model || agent.model,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools,
        tier: agent.tier,
        parentId: agent.parentId,
        workspaceId: agent.workspaceId,
      },
    });

    const assistantMsg = await services.message.create({
      sessionId,
      role: "assistant",
      content: sanitizePostCompactAssistantContent(result.content, result.toolCalls),
      toolCalls: result.toolCalls,
      tokenUsage: result.tokenUsage,
    });

    await services.run.create({
      agentId: agent.id,
      sessionId,
      status: "success",
      input: { message: displayText, attachments: input.attachments?.length ? input.attachments : undefined },
      output: { content: result.content },
      toolCalls: result.toolCalls,
      tokenUsage: result.tokenUsage,
      durationMs: Date.now() - start,
    });

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
