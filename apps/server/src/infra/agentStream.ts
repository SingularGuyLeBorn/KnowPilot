/**
 * Agent 流式聊天 — SSE 事件 + 流式 ReAct 循环 + 多版本 / 编辑 / Skill
 */

import type { Request, Response } from "express";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import {
  chatCompletionStream,
  chatCompletion,
  type LlmMessage,
  type LlmToolCall,
} from "./llmClient.js";
import {
  parseAgentTools,
  buildAgentToolSchemas,
  executeToolCallsBatch,
  createAgentToolContext,
  type ToolRegistryEntry,
} from "./agentTools.js";
import { buildLlmMessagesFromHistory, type StoredToolCall } from "./chatHistory.js";
import type { AgentChatInput, ChatConfigInput } from "@knowpilot/shared";
import { resolveAgent, buildMemoryContext, parseToolCall } from "./agentRuntime.js";
import { maybeCompactMessages } from "./autoCompact.js";
import { assertLlmBudget, recordTokenUsage } from "./llmBudget.js";
import { verifyAuthHeader, isAuthEnabled } from "./auth.js";
import {
  appendAssistantVersion,
  buildInitialVersionMeta,
  getActiveAssistantPayload,
} from "./messageVersions.js";

export type AgentStreamEvent =
  | { type: "round_start"; round: number }
  | { type: "thinking"; delta: string }
  | { type: "token"; delta: string }
  | { type: "tool_start"; name: string; args: unknown; round: number }
  | { type: "tool_end"; name: string; result: unknown; round: number }
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
  | { type: "error"; message: string; sessionId?: string; suggestion?: string };

function writeSse(res: Response, event: AgentStreamEvent) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  enableReasoning?: boolean;
}

interface PrepareResult {
  messageText: string;
  skipUserCreate: boolean;
  excludeAssistantId?: string;
  updateAssistantId?: string;
  userMessageMeta?: { skill?: { id: string; name: string; icon?: string | null } };
}

function pushThinking(
  executedTools: StoredToolCall[],
  round: number,
  delta: string,
  emit: (event: AgentStreamEvent) => void,
) {
  if (!delta) return;
  emit({ type: "thinking", delta });
  const id = `think_${round}`;
  const existing = executedTools.find((t) => t.id === id);
  if (existing) {
    existing.result = String(existing.result ?? "") + delta;
  } else {
    executedTools.push({
      id,
      name: "__thinking__",
      args: { round },
      result: delta,
      kind: "thinking",
    });
  }
}

async function runAgentLoopStream(options: {
  config: AppConfig;
  services: ServiceContainer;
  agent: { model: string; systemPrompt: string; tools: string[] };
  messages: LlmMessage[];
  llmOptions: LlmCallOptions;
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>;
  emit: (event: AgentStreamEvent) => void;
}): Promise<{
  content: string;
  toolCalls: StoredToolCall[];
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  provider: string;
  roundsUsed: number;
}> {
  const parsed = parseAgentTools(options.agent.tools);
  const registry = new Map<string, ToolRegistryEntry>();
  const toolSchemas = await buildAgentToolSchemas(options.services, parsed, registry);
  const toolCtx = createAgentToolContext(options.config, options.services, options.invokeTrpc, parsed);
  const maxRounds = options.config.llm.maxToolRounds;

  let llmMessages: LlmMessage[] = [...options.messages];
  const compacted = await maybeCompactMessages(options.config, llmMessages, options.agent.model);
  llmMessages = compacted.messages;

  const executedTools: StoredToolCall[] = [];
  let totalUsage = { prompt: 0, completion: 0, total: 0 };
  let lastModel = options.agent.model;
  let lastProvider = options.config.llm.defaultProvider;
  let roundsUsed = 0;
  let finalContent = "";

  for (let round = 0; round < maxRounds; round++) {
    roundsUsed = round + 1;
    options.emit({ type: "round_start", round: roundsUsed });

    const probe = await chatCompletion({
      config: options.config,
      model: options.agent.model,
      messages: llmMessages,
      tools: toolSchemas,
      temperature: options.llmOptions.temperature,
      maxTokens: options.llmOptions.maxTokens,
      enableReasoning: options.llmOptions.enableReasoning,
    });

    lastModel = probe.model;
    lastProvider = probe.provider;
    if (probe.tokenUsage) {
      totalUsage.prompt += probe.tokenUsage.prompt;
      totalUsage.completion += probe.tokenUsage.completion;
      totalUsage.total += probe.tokenUsage.total;
      recordTokenUsage(options.config, probe.tokenUsage);
    }

    if (probe.reasoningContent) {
      pushThinking(executedTools, roundsUsed, probe.reasoningContent, options.emit);
    }

    if (probe.toolCalls.length > 0) {
      llmMessages.push({
        role: "assistant",
        content: probe.content,
        tool_calls: probe.toolCalls,
      });

      for (const call of probe.toolCalls) {
        const parsedCall = parseToolCall(call);
        options.emit({
          type: "tool_start",
          name: parsedCall.name,
          args: parsedCall.args,
          round: roundsUsed,
        });
      }

      const batchResults = await executeToolCallsBatch(probe.toolCalls, toolCtx, registry, parsed);
      for (const { call, parsed: parsedCall, result } of batchResults) {
        executedTools.push({
          id: call.id,
          name: parsedCall.name,
          args: parsedCall.args,
          result,
          kind: "tool",
        });
        options.emit({
          type: "tool_end",
          name: parsedCall.name,
          result,
          round: roundsUsed,
        });

        llmMessages.push({
          role: "tool",
          tool_call_id: call.id,
          name: parsedCall.name,
          content: JSON.stringify(result).slice(0, 16000),
        });
      }
      continue;
    }

    finalContent = "";
    for await (const chunk of chatCompletionStream({
      config: options.config,
      model: options.agent.model,
      messages: llmMessages,
      temperature: options.llmOptions.temperature,
      maxTokens: options.llmOptions.maxTokens,
      enableReasoning: options.llmOptions.enableReasoning,
    })) {
      if (chunk.type === "reasoning" && chunk.delta) {
        pushThinking(executedTools, roundsUsed, chunk.delta, options.emit);
      }
      if (chunk.type === "token" && chunk.delta) {
        finalContent += chunk.delta;
        options.emit({ type: "token", delta: chunk.delta });
      }
      if (chunk.model) lastModel = chunk.model;
      if (chunk.provider) lastProvider = chunk.provider;
      if (chunk.tokenUsage) {
        totalUsage.prompt += chunk.tokenUsage.prompt;
        totalUsage.completion += chunk.tokenUsage.completion;
        totalUsage.total += chunk.tokenUsage.total;
        recordTokenUsage(options.config, chunk.tokenUsage);
      }
    }

    return {
      content: finalContent,
      toolCalls: executedTools,
      tokenUsage: totalUsage,
      model: lastModel,
      provider: lastProvider,
      roundsUsed,
    };
  }

  finalContent = `已达到最大工具调用轮次（${maxRounds}）。`;
  options.emit({ type: "token", delta: finalContent });
  return {
    content: finalContent,
    toolCalls: executedTools,
    tokenUsage: totalUsage,
    model: lastModel,
    provider: lastProvider,
    roundsUsed: maxRounds,
  };
}

async function prepareMessage(
  services: ServiceContainer,
  input: AgentChatInput,
): Promise<PrepareResult> {
  const loadHistory = async (sessionId: string) => {
    const res = await services.message.list({ sessionId, page: 1, pageSize: 200 });
    return res.items;
  };

  if (input.editMessageId && input.sessionId) {
    const items = await loadHistory(input.sessionId);
    const idx = items.findIndex((m) => m.id === input.editMessageId);
    if (idx === -1) throw new Error(`消息 ${input.editMessageId} 不存在`);
    if (items[idx].role !== "user") throw new Error("只能编辑用户消息");
    const newContent = input.editContent!.trim();
    await services.message.update({ id: input.editMessageId, content: newContent });
    for (let i = items.length - 1; i > idx; i--) {
      await services.message.delete(items[i].id);
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
    for (let i = items.length - 1; i > idx; i--) {
      await services.message.delete(items[i].id);
    }
    return { messageText: items[idx].content, skipUserCreate: true };
  }

  const messageText = input.message?.trim() ?? "";
  if (!messageText) throw new Error("message 不能为空");
  return { messageText, skipUserCreate: false };
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
  };
}

export async function chatAgentStream(
  services: ServiceContainer,
  config: AppConfig,
  input: AgentChatInput,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
  emit: (event: AgentStreamEvent) => void,
): Promise<void> {
  const start = Date.now();
  let sessionId = input.sessionId;

  try {
    assertLlmBudget(config);
    const agent = await resolveAgent(services, input.agentId);
    const skillResolved = await resolveSkillPrompt(services, input.skillId);
    const prepared = await prepareMessage(services, input);

    const effectiveModel = input.model || agent.model;
    let effectiveSystemPrompt =
      skillResolved.prompt ??
      (input.config?.systemPrompt !== undefined ? input.config.systemPrompt : agent.systemPrompt);

    if (!sessionId) {
      const created = await services.session.create({
        title: prepared.messageText.slice(0, 40) || "新对话",
        model: effectiveModel,
        systemPrompt: effectiveSystemPrompt,
      });
      sessionId = created.data!.id;
    } else if (input.model || input.config?.systemPrompt !== undefined || skillResolved.prompt) {
      await services.session.update({
        id: sessionId,
        ...(input.model ? { model: input.model } : {}),
        ...(effectiveSystemPrompt !== undefined ? { systemPrompt: effectiveSystemPrompt } : {}),
      });
    }

    if (!prepared.skipUserCreate) {
      await services.message.create({
        sessionId,
        role: "user",
        content: prepared.messageText,
        toolResults: skillResolved.meta ?? undefined,
      });
    }

    const history = await services.message.list({ sessionId, page: 1, pageSize: 100 });
    const historyForLlm = prepared.excludeAssistantId
      ? history.items.filter((m) => m.id !== prepared.excludeAssistantId)
      : history.items;

    const memoryHint = await buildMemoryContext(services, prepared.messageText);
    const messages = buildLlmMessagesFromHistory(
      (effectiveSystemPrompt || "你是 KnowPilot 助手。") + memoryHint,
      historyForLlm,
    );

    const result = await runAgentLoopStream({
      config,
      services,
      agent: { ...agent, model: effectiveModel },
      messages,
      llmOptions: resolveLlmOptions(input.config),
      invokeTrpc,
      emit,
    });

    let assistantMessageId: string | undefined;
    let versionIndex = 0;
    let versionCount = 1;

    if (prepared.updateAssistantId) {
      const existing = history.items.find((m) => m.id === prepared.updateAssistantId);
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

    if (!assistantMessageId) {
      const initial = buildInitialVersionMeta(result.content, result.toolCalls);
      const created = await services.message.create({
        sessionId,
        role: "assistant",
        content: result.content,
        toolCalls: result.toolCalls,
        toolResults: initial.toolResults,
        tokenUsage: result.tokenUsage,
      });
      assistantMessageId = created.data?.id;
    }

    await services.run.create({
      agentId: agent.id,
      sessionId,
      status: "success",
      input: {
        message: prepared.messageText,
        regenerate: input.regenerate,
        edit: input.editMessageId,
        skillId: input.skillId,
      },
      output: { content: result.content, assistantMessageId },
      toolCalls: result.toolCalls,
      tokenUsage: result.tokenUsage,
      durationMs: Date.now() - start,
    });

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
    const message = err instanceof Error ? err.message : String(err);
    const isBudget = message.includes("LLM 预算");
    emit({
      type: "error",
      message,
      sessionId,
      suggestion: isBudget
        ? "可在 .env 提高 LLM_DAILY_BUDGET，或明日再试。"
        : "检查 LLM 配置与会话 ID 是否有效。",
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

/** Express SSE handler: POST /api/agent/chat/stream */
export function handleAgentChatStream(
  services: ServiceContainer,
  config: AppConfig,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    if (isAuthEnabled(config) && !verifyAuthHeader(config, req.headers.authorization)) {
      writeSse(res, { type: "error", message: "未授权：请先登录后再使用 Chat 流式接口。" });
      res.end();
      return;
    }

    const body = req.body as AgentChatInput;
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

    await chatAgentStream(services, config, body, invokeTrpc, (event) => writeSse(res, event));
    res.end();
  };
}

export type { LlmToolCall };
