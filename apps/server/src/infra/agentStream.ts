/**
 * Agent 流式聊天 — SSE 事件 + 流式 ReAct 循环 + 多版本 / 编辑 / Skill
 */

import type { Request, Response } from "express";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import {
  chatCompletionStream,
  chatCompletion,
  resolveEffectiveAgentModel,
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
import type { AgentChatInput, ChatConfigInput, ChatImageAttachment } from "@knowpilot/shared";
import { formatToolResultHint } from "@knowpilot/shared";
import { resolveAgent, buildMemoryContext, parseToolCall, buildSystemPromptWithHints } from "./agentRuntime.js";
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
  | { type: "error"; message: string; sessionId?: string; suggestion?: string };

function writeSse(res: Response, event: AgentStreamEvent) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

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

/** 捕获工具轮次中 probe 返回的中间正式回复（后续仍有 tool_calls），进导轨时间线 */
function pushIntermediateContent(
  executedTools: StoredToolCall[],
  round: number,
  content: string,
  emit: (event: AgentStreamEvent) => void,
) {
  if (!content?.trim()) return;
  emit({ type: "intermediate_content", content, round });
  const id = `content_${round}`;
  const existing = executedTools.find((t) => t.id === id);
  if (existing) {
    existing.result = String(existing.result ?? "") + content;
  } else {
    executedTools.push({
      id,
      name: "__content__",
      args: { round },
      result: content,
      kind: "content",
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
  sessionId?: string;
  agentMeta?: { id: string; model: string; systemPrompt: string; tools: string[] };
  signal?: AbortSignal;
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
  const toolCtx = createAgentToolContext(options.config, options.services, options.invokeTrpc, parsed, undefined, {
    sessionId: options.sessionId,
    agentSnapshot: options.agentMeta,
  });
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
      reasoningEffort: options.llmOptions.reasoningEffort,
      signal: options.signal,
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
      // 工具轮次中 probe 可能同时返回 content（中间正式回复，后续仍有工具调用）
      // 捕获并 emit，使其进入左侧导轨时间线（对标 Kimi Code / Cursor）
      if (probe.content && probe.content.trim()) {
        pushIntermediateContent(executedTools, roundsUsed, probe.content, options.emit);
      }

      const roundReasoning =
        probe.reasoningContent ||
        executedTools
          .filter((t) => t.kind === "thinking" && t.id === `think_${roundsUsed}`)
          .map((t) => String(t.result ?? ""))
          .join("") ||
        null;

      llmMessages.push({
        role: "assistant",
        content: probe.content,
        reasoning_content: roundReasoning,
        tool_calls: probe.toolCalls,
      });

      for (const call of probe.toolCalls) {
        const parsedCall = parseToolCall(call);
        options.emit({
          type: "tool_start",
          toolCallId: call.id,
          name: parsedCall.name,
          args: parsedCall.args,
          round: roundsUsed,
        });
      }

      if (options.signal?.aborted) {
        const err = new Error("流式输出已被用户中断");
        err.name = "AbortError";
        throw err;
      }

      const batchResults = await executeToolCallsBatch(probe.toolCalls, toolCtx, registry, parsed, options.signal);
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
          toolCallId: call.id,
          name: parsedCall.name,
          result,
          round: roundsUsed,
          hint: formatToolResultHint(result) ?? undefined,
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

    // probe 无 tool_calls：复用 probe.content 作为最终答案，避免二次 chatCompletionStream
    // 调用浪费 token/延迟（probe 已是完整 LLM 响应）。
    // 仅当 probe 无 reasoningContent 时短路：有思考链的场景走 stream 路径以保留 token-by-token
    // 的思考流式 UX（reasoningContent 已通过 pushThinking 单次 emit，但流式版渐进输出体验更好）。
    if (probe.content && probe.content.trim() && !probe.reasoningContent) {
      finalContent = probe.content;
      for (const token of probe.content.split("")) {
        options.emit({ type: "token", delta: token });
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

    finalContent = "";
    for await (const chunk of chatCompletionStream({
      config: options.config,
      model: options.agent.model,
      messages: llmMessages,
      temperature: options.llmOptions.temperature,
      maxTokens: options.llmOptions.maxTokens,
      enableReasoning: options.llmOptions.enableReasoning,
      reasoningEffort: options.llmOptions.reasoningEffort,
      signal: options.signal,
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

  // maxRounds 耗尽：若末轮执行过工具，再做一次无 tools 的合成调用读取 tool 结果，
  // 而不是直接吐兜底文案（用户至少能看到基于工具结果的最终回答）
  if (executedTools.some((t) => t.kind === "tool") && !options.signal?.aborted) {
    try {
      finalContent = "";
      for await (const chunk of chatCompletionStream({
        config: options.config,
        model: options.agent.model,
        messages: llmMessages,
        temperature: options.llmOptions.temperature,
        maxTokens: options.llmOptions.maxTokens,
        enableReasoning: options.llmOptions.enableReasoning,
        reasoningEffort: options.llmOptions.reasoningEffort,
        signal: options.signal,
      })) {
        if (chunk.type === "reasoning" && chunk.delta) {
          pushThinking(executedTools, maxRounds, chunk.delta, options.emit);
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
      if (finalContent.trim()) {
        return {
          content: finalContent,
          toolCalls: executedTools,
          tokenUsage: totalUsage,
          model: lastModel,
          provider: lastProvider,
          roundsUsed: maxRounds,
        };
      }
    } catch {
      // 合成失败则落兜底文案
    }
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
    const agent = await resolveAgent(services, input.agentId);
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
      const created = await services.session.create({
        title: prepared.messageText.slice(0, 40) || "新对话",
        model: effectiveModel,
        systemPrompt: effectiveSystemPrompt,
        agentId: agent.id,
      });
      sessionId = created.data!.id;
    } else if (input.model || input.config?.systemPrompt !== undefined || skillResolved.prompt || input.agentId) {
      await services.session.update({
        id: sessionId,
        ...(input.model ? { model: input.model } : {}),
        ...(effectiveSystemPrompt !== undefined ? { systemPrompt: effectiveSystemPrompt } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
    }

    if (!prepared.skipUserCreate) {
      await services.message.create({
        sessionId,
        role: "user",
        content: prepared.messageText,
        attachments: prepared.attachments?.length ? prepared.attachments : undefined,
        toolResults: skillResolved.meta ? { skill: skillResolved.meta.skill } : undefined,
      });
    }

    const history = await services.message.list({ sessionId, page: 1, pageSize: 100 });
    const historyForLlm = prepared!.excludeAssistantId
      ? history.items.filter((m) => m.id !== prepared!.excludeAssistantId)
      : history.items;

    const memoryHint = await buildMemoryContext(services, prepared.messageText);
    const messages = buildLlmMessagesFromHistory(
      buildSystemPromptWithHints(effectiveSystemPrompt || agent.systemPrompt, agent.tools, memoryHint),
      historyForLlm,
      { modelId: effectiveModel },
    );

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
      },
      signal,
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
    const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("用户中断"));
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

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    res.on("close", onClose);

    try {
      await chatAgentStream(services, config, body, invokeTrpc, (event) => writeSse(res, event), abortController.signal);
    } finally {
      res.off("close", onClose);
      res.end();
    }
  };
}

export type { LlmToolCall };
