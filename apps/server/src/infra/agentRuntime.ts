/**
 * Agent 运行时 — ReAct 循环 + 工具调用 + 聊天会话
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { chatCompletion, resolveEffectiveAgentModel, type LlmMessage, type LlmToolCall } from "./llmClient.js";
import {
  parseAgentTools,
  buildAgentToolSchemas,
  executeToolCallsBatch,
  createAgentToolContext,
  type ToolRegistryEntry,
} from "./agentTools.js";
import { assertLlmBudget, recordTokenUsage } from "./llmBudget.js";
import { buildLlmMessagesFromHistory, type StoredToolCall } from "./chatHistory.js";
import { maybeCompactMessages, persistCompactResult } from "./autoCompact.js";
import { searchFts } from "./ftsIndex.js";
import { isMemoryInjectable } from "@knowpilot/shared";
import type { AgentChatInput, AgentRunInput } from "@knowpilot/shared";
import { success, failure } from "../trpc/result.js";
import { getAllowedToolsForTier } from "./swarmPermissionGuard.js";

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
  // R11：优先 FTS 召回 memory（已索引，P11），避免 LIKE 扫 content 全表；FTS 无命中/不可用回退 LIKE
  let memories: any[] = [];
  try {
    const hits = await searchFts(services.prisma, keyword, 5);
    const memIds = hits.filter((h) => h.entity === "memory").map((h) => h.entityId);
    if (memIds.length > 0) {
      memories = await services.prisma.memory.findMany({
        where: { id: { in: memIds }, type: { not: "experience" } },
      });
    }
  } catch {
    // FTS 未就绪等，回退 LIKE
  }
  if (memories.length === 0) {
    const fb = await services.memory.list({ page: 1, pageSize: 8, keyword });
    memories = fb.items.filter((m) => isMemoryInjectable(m.type));
  } else {
    memories = memories.filter((m) => isMemoryInjectable(m.type));
  }
  if (!memories.length) return "";
  const lines = memories.slice(0, 5).map((m) => `- [${m.type}] ${m.content.slice(0, 300)}`);
  return `\n\n## 相关长期记忆\n${lines.join("\n")}`;
}

const WEB_TOOL_GUIDE = `## 网络工具用法
- web_search：查最新信息、文档、新闻；返回标题+URL+摘要，优先用结果中的 URL 继续深挖。已配置 Tavily/SerpAPI 时按 SEARCH_ENGINE_PRIORITY 自动降级；在 /sources 启用信息源后，Tavily/SerpAPI 会优先在信息源域名内 scoped 搜索（hint 含 infoSource-scoped / N 信息源）。
- read_article：读取单篇网页正文（Markdown）。支持知乎/微信/小红书/B站/掘金/CSDN/InfoQ/SegmentFault/开源中国/博客园/简书/GitHub 等；GitHub blob→raw + jsDelivr/API（~1s）；InfoQ/OSChina API；SegmentFault/CSDN/掘金/博客园 SSR HTTP；简书 Mobile HTTP；知乎 Cookie HTTP（~1s，需 ZHIHU_COOKIE）；HTTP 404 秒级报错；正文偏短（<150 字）时返回 contentWarning 并建议 scrape_web_page。
- scrape_web_page：Playwright 采集复杂 SPA/需 JS 渲染页面；返回 method=playwright 与 platform；read_article 失败或页面高度动态时再试。
建议流程：web_search 找 URL → read_article 读正文 → 必要时 scrape_web_page。知乎/微信/小红书/抖音若被登录墙拦截，可在 .env 配置 ZHIHU_COOKIE / WECHAT_COOKIE / XHS_COOKIE / DOUYIN_COOKIE；GitHub 可选 GITHUB_TOKEN 提高 API 限速余量。`;

/** 根据 Agent 已授权工具追加简短使用指引 */
export function buildAgentToolGuide(tools: string[]): string {
  const has = (name: string) => tools.some((t) => t === `native:${name}` || t === name);
  if (has("web_search") || has("read_article") || has("scrape_web_page")) {
    return WEB_TOOL_GUIDE;
  }
  return "";
}

/** 按层级注入身份约束，防止子 Agent 误认自己是超级/管理 Agent */
export function buildTierIdentityHint(tier?: string | null, name?: string | null): string {
  if (tier === "sub") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份（硬约束）
你是子 Agent${who}，**不是**超级 Agent，也**不是**管理 Agent。
- 只执行上级下发的当前任务；完成后必须调用 agent_report_back 向上级汇报。
- 异步任务（如 sleep async）到期后续跑时，仍应继续完成任务并 agent_report_back，不要把续跑当成「用户闲聊」。
- 用户在本会话直接发消息时，也可酌情 report_back（补充汇报），但请在内容中说明这是补充。
- 禁止创建/派生子 Agent 或管理其他 Agent（不得使用 spawn_subagent、agent_create、agent_create_sub 等）。
- 禁止创建或归档 Workspace；不要自称超级 Agent / 管理 Agent。
- 可用 sleep / 读写 / 搜索等执行类工具完成任务本身。`;
  }
  if (tier === "manager") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份
你是管理 Agent${who}，负责**当前 Workspace** 内的子 Agent。
- 可在本 Workspace 创建/派生子 Agent；不可跨 Workspace，也不可创建 Workspace。
- 不要自称超级 Agent。`;
  }
  if (tier === "super") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份
你是超级 Agent${who}，可跨 Workspace 管理；创建子 Agent 时应指定目标 Workspace（默认落在当前上下文 Workspace）。`;
  }
  return "";
}

export function buildSystemPromptWithHints(
  basePrompt: string,
  tools: string[],
  memoryHint: string,
  identity?: { tier?: string | null; name?: string | null },
): string {
  const identityHint = buildTierIdentityHint(identity?.tier, identity?.name);
  const base = (basePrompt || "你是 KnowPilot 助手。") + identityHint + memoryHint;
  const guide = buildAgentToolGuide(tools);
  return guide ? `${base}\n\n${guide}` : base;
}

/** 子 Agent 默认执行工具（带 native: 前缀，避免物化成空 → native:all） */
export const DEFAULT_SUBAGENT_TOOLS = [
  "native:sleep",
  "native:async_task_run",
  "native:agent_report_back",
  "native:read_file",
  "native:list_directory",
  "native:web_search",
] as const;

/** 规范化 + 按 tier 裁剪工具列表，供 runAgentLoop / stream 使用 */
export function resolveToolsForAgentTier(tier: string | undefined | null, tools: string[]): string[] {
  const t = tier || "sub";
  let normalized = (tools ?? []).map((tool) => {
    if (tool.startsWith("native:") || tool.startsWith("skill:") || tool.startsWith("mcp:")) return tool;
    if (tool.includes(":")) return tool;
    return `native:${tool}`;
  });
  if (normalized.length === 0 && t === "sub") {
    normalized = [...DEFAULT_SUBAGENT_TOOLS];
  }
  return getAllowedToolsForTier(t, normalized);
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

const DEFAULT_ASSISTANT_TOOLS = [
  "native:web_search",
  "native:read_article",
  "native:scrape_web_page",
  "native:read_file",
  "native:write_file",
  "native:list_directory",
  "native:invoke_api",
  "native:spawn_subagent",
  "native:async_task_run",
  "native:session_rotate",
  "native:session_compact",
  "native:sleep",
  "native:git_status",
  "native:memory_create",
  "native:memory_search",
  "skill:*",
  "mcp:filesystem",
];

const DEFAULT_ASSISTANT_SYSTEM_PROMPT =
  "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。对于需要多步骤研究、耗时较长或需要并行的复杂任务，请使用 native:spawn_subagent 或 native:async_task_run 派生子代理执行，而不是在单轮对话中连续调用 read_article/web_search。用户偏好与跨会话稳定事实请用 native:memory_create 沉淀（必要时先 memory_search）；子 Agent 无记忆工具。当前会话上下文过长或用户要求压缩时，调用 native:session_compact（不换会话）；话题明显切换或用户要求换干净上下文时，先写好总结再调用 native:session_rotate 归档并开新会话。";

const LEGACY_ASSISTANT_SYSTEM_PROMPT =
  "你是 KnowPilot 智能助手，可以阅读本地 Markdown 知识库、搜索网络、抓取网页、操作 Git、调用 Skill 与 MCP 工具。回答请简洁、准确，优先使用工具获取事实。";

export async function resolveAgent(services: ServiceContainer, agentId?: string) {
  if (agentId) return services.agent.getById(agentId);

  const list = await services.agent.list({ page: 1, pageSize: 20, keyword: "assistant" });
  let exact = list.items.find((a: { name: string }) => a.name === "assistant");
  if (!exact && list.items[0]) exact = list.items[0];

  // 自动补齐默认 assistant 的工具与系统提示，确保老数据库也能获得子代理/写文件能力
  if (exact) {
    const tools = Array.isArray(exact.tools) ? exact.tools : [];
    // 子 Agent 不自动追加 spawn/async_task_run 等编排工具，其工具集由创建/运行时的权限层过滤
    const needsToolsUpdate =
      exact.tier !== "sub" &&
      (!tools.includes("native:write_file") ||
        !tools.includes("native:spawn_subagent") ||
        !tools.includes("native:async_task_run") ||
        !tools.includes("native:session_rotate") ||
        !tools.includes("native:session_compact") ||
        !tools.includes("native:memory_create") ||
        !tools.includes("native:memory_search"));
    // 仅当系统提示还是旧版默认（或空）时才自动升级，避免覆盖用户自定义提示词
    const needsPromptUpdate =
      !exact.systemPrompt || exact.systemPrompt === LEGACY_ASSISTANT_SYSTEM_PROMPT;
    // 默认 assistant 必须是 manager 层级；已明确指定 super/manager/sub 的 Agent 不再改动
    const needsTierUpdate = !exact.tier;
    const needsUpdate = needsToolsUpdate || needsPromptUpdate || needsTierUpdate;
    if (needsUpdate) {
      try {
        const updated = await services.agent.update({
          id: exact.id,
          tools: Array.from(new Set([...tools, ...DEFAULT_ASSISTANT_TOOLS])),
          ...(needsPromptUpdate ? { systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT } : {}),
          ...(needsTierUpdate ? { tier: "manager" } : {}),
        });
        if (updated.success && updated.data) {
          return updated.data;
        }
      } catch (err) {
        console.warn("[resolveAgent] 更新默认 assistant 工具/层级失败:", err);
      }
    }
    return exact;
  }

  const created = await services.agent.create({
    name: "assistant",
    description: "KnowPilot 默认助手",
    model: "deepseek-v4-flash",
    systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    tools: DEFAULT_ASSISTANT_TOOLS,
    tier: "manager",
  });
  return created.data!;
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
  assertLlmBudget(options.config);
  const effectiveModel = resolveEffectiveAgentModel(options.config, options.agent.model);
  const tierTools = resolveToolsForAgentTier(options.agentMeta?.tier, options.agent.tools);
  const parsed = parseAgentTools(tierTools);
  // 双保险：子 Agent 绝不能拿到 native:all
  if (parsed.native === "all" && (options.agentMeta?.tier === "sub" || !options.agentMeta?.tier)) {
    parsed.native = DEFAULT_SUBAGENT_TOOLS.map((t) => t.replace(/^native:/, ""));
  }
  const registry = new Map<string, ToolRegistryEntry>();
  const toolSchemas = await buildAgentToolSchemas(options.services, parsed, registry);
  const toolCtx = createAgentToolContext(options.config, options.services, options.invokeTrpc, parsed, undefined, {
    sessionId: options.sessionId,
    agentSnapshot: options.agentMeta
      ? { ...options.agentMeta, tools: tierTools }
      : options.agentMeta,
    runOrigin: options.runOrigin,
  });

  let llmMessages: LlmMessage[] = [...options.messages];
  let existingSummary: string | null = null;
  if (options.sessionId) {
    try {
      const sess = await options.services.session.getByIdLite?.(options.sessionId)
        ?? await options.services.session.getById(options.sessionId);
      existingSummary = (sess as { contextSummary?: string | null } | null)?.contextSummary ?? null;
    } catch {
      /* ignore */
    }
  }
  const compacted = await maybeCompactMessages(options.config, llmMessages, effectiveModel, {
    existingSummary,
    flushContext: options.sessionId
      ? { services: options.services, sessionId: options.sessionId }
      : undefined,
  });
  llmMessages = compacted.messages;
  if (compacted.compacted) {
    console.log("[Agent] 长对话已自动压缩上下文");
    if (compacted.summaryText && options.sessionId && !compacted.reused) {
      try {
        await persistCompactResult(options.services, options.sessionId, compacted, { trigger: "auto" });
      } catch (err) {
        console.warn("[AutoCompact] 持久化摘要失败:", err instanceof Error ? err.message : err);
      }
    }
  }

  const executedTools: StoredToolCall[] = [];
  let totalUsage = { prompt: 0, completion: 0, total: 0 };
  let lastModel = effectiveModel;
  let lastProvider = options.config.llm.defaultProvider;
  let roundsUsed = 0;
  const maxRounds = options.config.llm.maxToolRounds;

  /** 与 agentStream.pushThinking 对齐：把思考链写入 toolCalls，供 Chat UI 时间线渲染 */
  const pushThinking = (round: number, delta: string) => {
    if (!delta) return;
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
  };

  /** 工具轮次中的中间正式回复，进导轨时间线（与 agentStream.pushIntermediateContent 对齐） */
  const pushIntermediateContent = (round: number, content: string) => {
    if (!content?.trim()) return;
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
  };

  for (let round = 0; round < maxRounds; round++) {
    roundsUsed = round + 1;
    const completion = await chatCompletion({
      config: options.config,
      model: effectiveModel,
      messages: llmMessages,
      tools: toolSchemas,
      signal: options.signal,
    });

    lastModel = completion.model;
    lastProvider = completion.provider;
    if (completion.tokenUsage) {
      totalUsage.prompt += completion.tokenUsage.prompt;
      totalUsage.completion += completion.tokenUsage.completion;
      totalUsage.total += completion.tokenUsage.total;
      recordTokenUsage(options.config, completion.tokenUsage);
    }

    // 非流式路径也必须持久化思考链，否则 spawn/triggerAgentRun 子会话只剩工具调用
    if (completion.reasoningContent) {
      pushThinking(roundsUsed, completion.reasoningContent);
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

    // 本轮仍有工具调用时，把中间正文也写入时间线（最终轮正文走 content 字段）
    if (completion.content?.trim()) {
      pushIntermediateContent(roundsUsed, completion.content);
    }

    llmMessages.push({
      role: "assistant",
      content: completion.content,
      reasoning_content: completion.reasoningContent ?? null,
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
    options.onProgress?.(`第 ${round + 1} 轮工具调用完成，共调用 ${batchResults.length} 个工具`);
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
    const memoryHint = await buildMemoryContext(services, displayText);
    const messages = buildLlmMessagesFromHistory(
      buildSystemPromptWithHints(agent.systemPrompt, agent.tools, memoryHint, {
        tier: agent.tier,
        name: agent.name,
      }),
      history.items,
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
      content: result.content,
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
