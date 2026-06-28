/**
 * Agent 运行时 — ReAct 循环 + 工具调用 + 聊天会话
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { chatCompletion, type LlmMessage, type LlmToolCall } from "./llmClient.js";
import {
  parseAgentTools,
  buildAgentToolSchemas,
  executeToolCallsBatch,
  createAgentToolContext,
  type ToolRegistryEntry,
} from "./agentTools.js";
import { assertLlmBudget, recordTokenUsage } from "./llmBudget.js";
import { buildLlmMessagesFromHistory, type StoredToolCall } from "./chatHistory.js";
import { maybeCompactMessages } from "./autoCompact.js";
import type { AgentChatInput, AgentRunInput } from "@knowpilot/shared";
import { success, failure } from "../trpc/result.js";

export interface AgentLoopResult {
  content: string;
  toolCalls: StoredToolCall[];
  tokenUsage: { prompt: number; completion: number; total: number };
  model: string;
  provider: string;
  roundsUsed: number;
}

export async function buildMemoryContext(services: ServiceContainer, userText: string): Promise<string> {
  const keyword = userText.slice(0, 80).trim();
  if (!keyword) return "";
  const memories = await services.memory.list({ page: 1, pageSize: 5, keyword });
  if (!memories.items.length) return "";
  const lines = memories.items.map((m) => `- [${m.type}] ${m.content.slice(0, 300)}`);
  return `\n\n## 相关长期记忆\n${lines.join("\n")}`;
}

export function parseToolCall(call: LlmToolCall): { name: string; args: Record<string, unknown> } {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    args = { raw: call.function.arguments };
  }
  return { name: call.function.name, args };
}

export async function resolveAgent(services: ServiceContainer, agentId?: string) {
  if (agentId) return services.agent.getById(agentId);

  const list = await services.agent.list({ page: 1, pageSize: 20, keyword: "assistant" });
  const exact = list.items.find((a: { name: string }) => a.name === "assistant");
  if (exact) return exact;
  if (list.items[0]) return list.items[0];

  const created = await services.agent.create({
    name: "assistant",
    description: "KnowPilot 默认助手",
    model: "deepseek-chat",
    systemPrompt:
      "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。",
    tools: [
      "native:web_search",
      "native:read_file",
      "native:list_directory",
      "native:invoke_api",
      "native:git_status",
      "skill:*",
      "mcp:filesystem",
    ],
  });
  return created.data!;
}

export async function runAgentLoop(options: {
  config: AppConfig;
  services: ServiceContainer;
  agent: { model: string; systemPrompt: string; tools: string[] };
  messages: LlmMessage[];
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>;
}): Promise<AgentLoopResult> {
  assertLlmBudget(options.config);
  const parsed = parseAgentTools(options.agent.tools);
  const registry = new Map<string, ToolRegistryEntry>();
  const toolSchemas = await buildAgentToolSchemas(options.services, parsed, registry);
  const toolCtx = createAgentToolContext(options.config, options.services, options.invokeTrpc, parsed);

  let llmMessages: LlmMessage[] = [...options.messages];
  const compacted = await maybeCompactMessages(options.config, llmMessages, options.agent.model);
  llmMessages = compacted.messages;
  if (compacted.compacted) {
    console.log("[Agent] 长对话已自动压缩上下文");
  }

  const executedTools: StoredToolCall[] = [];
  let totalUsage = { prompt: 0, completion: 0, total: 0 };
  let lastModel = options.agent.model;
  let lastProvider = options.config.llm.defaultProvider;
  let roundsUsed = 0;
  const maxRounds = options.config.llm.maxToolRounds;

  for (let round = 0; round < maxRounds; round++) {
    roundsUsed = round + 1;
    const completion = await chatCompletion({
      config: options.config,
      model: options.agent.model,
      messages: llmMessages,
      tools: toolSchemas,
    });

    lastModel = completion.model;
    lastProvider = completion.provider;
    if (completion.tokenUsage) {
      totalUsage.prompt += completion.tokenUsage.prompt;
      totalUsage.completion += completion.tokenUsage.completion;
      totalUsage.total += completion.tokenUsage.total;
      recordTokenUsage(options.config, completion.tokenUsage);
    }

    if (!completion.toolCalls.length) {
      return {
        content: completion.content || "",
        toolCalls: executedTools,
        tokenUsage: totalUsage,
        model: lastModel,
        provider: lastProvider,
        roundsUsed,
      };
    }

    llmMessages.push({
      role: "assistant",
      content: completion.content,
      tool_calls: completion.toolCalls,
    });

    const batchResults = await executeToolCallsBatch(completion.toolCalls, toolCtx, registry, parsed);
    for (const { call, parsed: parsedCall, result } of batchResults) {
      executedTools.push({
        id: call.id,
        name: parsedCall.name,
        args: parsedCall.args,
        result,
      });
      llmMessages.push({
        role: "tool",
        tool_call_id: call.id,
        name: parsedCall.name,
        content: JSON.stringify(result).slice(0, 16000),
      });
    }
  }

  return {
    content: `已达到最大工具调用轮次（${maxRounds}）。可通过环境变量 AGENT_MAX_TOOL_ROUNDS 调整上限。`,
    toolCalls: executedTools,
    tokenUsage: totalUsage,
    model: lastModel,
    provider: lastProvider,
    roundsUsed: maxRounds,
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
    const memoryHint = input.input ? await buildMemoryContext(services, input.input) : "";
    const messages: LlmMessage[] = [
      { role: "system", content: (agent.systemPrompt || "你是 KnowPilot 助手。") + memoryHint },
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
    return failure({
      code: "AGENT_RUN_FAILED",
      message: err instanceof Error ? err.message : String(err),
      suggestion: "检查 .env 中 LLM API Key 是否有效。",
      retryable: true,
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
  const messageText = input.message?.trim();
  if (!messageText) {
    throw new Error("message 不能为空");
  }
  try {
    const agent = await resolveAgent(services, input.agentId);

    if (!sessionId) {
      const created = await services.session.create({
        title: messageText.slice(0, 40) || "新对话",
        model: input.model || agent.model,
        systemPrompt: agent.systemPrompt,
      });
      sessionId = created.data!.id;
    }

    await services.message.create({ sessionId, role: "user", content: messageText });

    const history = await services.message.list({ sessionId, page: 1, pageSize: 50 });
    const memoryHint = await buildMemoryContext(services, messageText);
    const messages = buildLlmMessagesFromHistory(
      (agent.systemPrompt || "你是 KnowPilot 助手。") + memoryHint,
      history.items,
    );

    const result = await runAgentLoop({
      config,
      services,
      agent: { ...agent, model: input.model || agent.model },
      messages,
      invokeTrpc,
    });

    const assistantMsg = await services.message.create({
      sessionId,
      role: "assistant",
      content: result.content,
      toolCalls: result.toolCalls,
      tokenUsage: result.tokenUsage,
    });

    await services.run.create({
      agentId: agent.id,
      sessionId,
      status: "success",
      input: { message: messageText },
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
    return failure({
      code: "AGENT_CHAT_FAILED",
      message: err instanceof Error ? err.message : String(err),
      suggestion: "检查 LLM 配置与会话 ID 是否有效。",
      retryable: true,
      operation: "chat",
      entity: "agent",
      durationMs: Date.now() - start,
      state: sessionId ? { sessionId } : undefined,
    });
  }
}
