/**
 * Native Swarm 域 — agent_* / workspace_* / skill 进化 / 免费 API Key / 免费模型目录
 *
 * PR-4b：从 nativeTools.ts 迁出，handler 与 schema 保持原语义不变。
 * agentCreateSubTool / agentSendMessageTool 导出供 session 域 spawn_subagent 复用。
 */
import {
  getAllowedToolsForTier,
  checkAgentSendMessagePermission,
} from "../../swarmPermissionGuard.js";
import { getStreamHub } from "../../sessionStreamHub.js";
import { getSwarmBus } from "../../swarmBus.js";
import { getAgentRunLock } from "../../agentRunLock.js";
import { isSessionRunningClaimed } from "../../sessionRunningSignal.js";
import { provisionWorkspace } from "../../workspaceProvision.js";
import { checkWorkspaceAgentAccess } from "../../swarmPermissionGuard.js";
import { optimizeAgentPrompt, generateSkillFromExperience } from "../../agentEvolution.js";
import { parseSkillUsageStats } from "../../skillRunner.js";
import { getSkillUsage, latestActivityAt } from "../../skillUsage.js";
import { parseSkillKind } from "../../skillPackage.js";
import { resolveToolsForAgentTier } from "../../loop/setup.js";
import { buildAllMemoryHints, buildSystemPromptWithHints } from "../../promptBuilder.js";
import { resolveAgent as defaultResolveAgent } from "../../agentResolver.js";
import { createTrpcInvoker } from "../../trpcInvoker.js";
import { createMemoryRepository } from "../../memoryRepository.js";
import { MEMORY_SCOPE_GLOBAL, memoryAgentScope, LLM_PROVIDER_DEEPSEEK } from "@knowpilot/shared";
import {
  filterOpenRouterFreeModels,
  getFreellmGatewayRuntime,
  getOpenRouterFreeModelCatalog,
  getOpenRouterFreeSyncedAt,
  loadOpenRouterFreeCatalogFromDisk,
} from "../../freeLlmRuntime.js";
import { listFreellmChannels } from "../../freeKeysSync.js";

import type { LlmMessage } from "../../llmClient.js";
import { z } from "zod";
import { zodParams } from "./zodParams.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";
import type { AppConfig } from "../../config.js";
import type { ServiceContainer } from "../../serviceContainer.js";

async function agentCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 超级 Agent 创建 Agent 未指定 workspaceId 时，默认挂到系统 Workspace
  let workspaceId = args.workspaceId as string | undefined;
  if (!workspaceId && ctx.agentSnapshot?.tier === "super") {
    const systemWs = await ctx.services.prisma.workspace.findFirst({
      where: { isSystem: true, systemType: "super", status: { not: "deleted" } },
    });
    if (systemWs) workspaceId = systemWs.id;
  }
  const created = await ctx.services.agent.create({
    name: String(args.name || ""),
    description: args.description ? String(args.description) : undefined,
    model: args.model ? String(args.model) : ctx.config.llm.defaultModel,
    systemPrompt: args.systemPrompt ? String(args.systemPrompt) : "",
    tools: Array.isArray(args.tools) ? (args.tools as string[]) : [],
    tier: args.tier as "super" | "manager" | "sub" | undefined,
    workspaceId,
    parentId: args.parentId as string | undefined,
    source: "native_tool:agent_create",
    apiKey: args.apiKey as string | undefined,
    heartbeatModel: args.heartbeatModel as string | undefined,
    heartbeat: args.heartbeat as any,
  });
  if (!created.success || !created.data) {
    return { error: created.error?.message ?? "创建 Agent 失败" };
  }
  // 主会话由 AgentService.afterCreate → ensureMainSession 统一创建（幂等）
  // 审计日志
  await ctx.services.log?.create?.({
    level: "info",
    component: "swarm",
    event: "agent_created",
    message: `Agent ${created.data.name} 被创建（tier: ${args.tier ?? "sub"}）`,
    metadata: { agentId: created.data.id, operatorAgentId: ctx.agentSnapshot?.id, tier: args.tier ?? "sub" },
  }).catch(() => {});
  return { success: true, agentId: created.data.id, name: created.data.name };
}

async function agentUpdateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { id, ...updateData } = args;
  const targetId = String(id || "");
  const existing = await ctx.services.agent.getById(targetId);
  if (!existing) return { error: "Agent 不存在" };
  const scopeErr = checkWorkspaceAgentAccess(
    { tier: ctx.agentSnapshot?.tier ?? "sub", workspaceId: ctx.agentSnapshot?.workspaceId },
    { tier: existing.tier, workspaceId: existing.workspaceId, id: targetId },
    "agent_update",
  );
  if (scopeErr) return { error: `[${scopeErr.code}] ${scopeErr.reason}` };
  // 管理 Agent 禁止改 tier / 迁出 Workspace
  if (ctx.agentSnapshot?.tier === "manager") {
    if (updateData.tier !== undefined && String(updateData.tier) !== existing.tier) {
      return { error: "[TIER_PROTECTED] 管理 Agent 不能修改目标 Agent 的 tier。" };
    }
    if (updateData.workspaceId !== undefined && String(updateData.workspaceId) !== (existing.workspaceId ?? "")) {
      return { error: "[CROSS_WORKSPACE_FORBIDDEN] 管理 Agent 不能把 Agent 迁出本 Workspace。" };
    }
  }
  const result = await ctx.services.agent.update({
    id: targetId,
    name: updateData.name ? String(updateData.name) : undefined,
    description: updateData.description ? String(updateData.description) : undefined,
    model: updateData.model ? String(updateData.model) : undefined,
    systemPrompt: updateData.systemPrompt ? String(updateData.systemPrompt) : undefined,
    tools: Array.isArray(updateData.tools) ? (updateData.tools as string[]) : undefined,
    apiKey: updateData.apiKey !== undefined ? String(updateData.apiKey) : undefined,
    heartbeatModel: updateData.heartbeatModel ? String(updateData.heartbeatModel) : undefined,
    heartbeat: updateData.heartbeat as any,
    status: updateData.status as any,
    tier: ctx.agentSnapshot?.tier === "super" && updateData.tier !== undefined
      ? (updateData.tier as any)
      : undefined,
  } as any);
  if (!result.success) return { error: result.error?.message ?? "更新 Agent 失败" };
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "agent_updated",
    message: `Agent ${id} 被更新`,
    metadata: { agentId: String(id), operatorAgentId: ctx.agentSnapshot?.id },
  }).catch(() => {});
  return { success: true };
}

async function agentDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const targetId = String(args.id || "");
  // tombstone 删除：先 abort 运行中任务，再标记 deleted（不真删 DB 记录）
  const existing = await ctx.services.agent.getById(targetId);
  if (!existing) return { error: "Agent 不存在" };
  // Q1：任何超级 Agent 不可删（含自己；权限层亦拦 SELF_DELETE）
  if (existing.tier === "super") {
    return { error: "[SUPER_AGENT_NOT_DELETABLE] 超级 Agent 不可删除。" };
  }
  const scopeErr = checkWorkspaceAgentAccess(
    { tier: ctx.agentSnapshot?.tier ?? "sub", workspaceId: ctx.agentSnapshot?.workspaceId },
    { tier: existing.tier, workspaceId: existing.workspaceId, id: targetId },
    "agent_delete",
  );
  if (scopeErr) return { error: `[${scopeErr.code}] ${scopeErr.reason}` };
  // 先标记 deleted（tombstone），保留记录
  await ctx.services.agent.update({
    id: targetId,
    status: "deleted",
  } as any).catch(() => {});
  // 审计日志
  await ctx.services.log?.create?.({
    level: "warn", component: "swarm", event: "agent_deleted",
    message: `Agent ${existing.name} 被删除（tombstone）`,
    metadata: { agentId: targetId, agentName: existing.name, operatorAgentId: ctx.agentSnapshot?.id, deletedAt: new Date().toISOString() },
  }).catch(() => {});
  return { success: true, message: `Agent ${existing.name} 已标记为 deleted（tombstone 保留）。session/message/memory 将级联清理。` };
}

/**
 * Swarm 作战简报：manager/super 一览作用域内 Agent 健康，便于先消费再派活。
 */
async function swarmBriefTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const tier = ctx.agentSnapshot?.tier ?? "sub";
  if (tier !== "super" && tier !== "manager") {
    return { error: "[TIER_DENIED] swarm_brief 仅超级 / 管理 Agent 可用。" };
  }
  if (!ctx.prisma) return { error: "swarm_brief 需要 prisma 上下文" };

  let workspaceId: string | null | undefined =
    typeof args.workspaceId === "string" && args.workspaceId.trim()
      ? args.workspaceId.trim()
      : undefined;
  if (tier === "manager") {
    workspaceId = ctx.agentSnapshot?.workspaceId ?? null;
    if (!workspaceId) {
      return { error: "管理 Agent 无 workspaceId，无法生成作用域简报。" };
    }
  } else if (workspaceId === undefined) {
    // super 默认全局；可显式传 workspaceId 收窄
    workspaceId = null;
  }

  const limit = typeof args.limit === "number" ? args.limit : 12;
  const { buildSwarmBrief } = await import("../../swarmHealth.js");
  const brief = await buildSwarmBrief(ctx.prisma, {
    workspaceId: workspaceId === null ? null : workspaceId,
    limit,
  });
  return {
    markdown: brief.markdown,
    agentCount: brief.agents.length,
    attentionCount: brief.agents.filter((a) => a.needsAttention).length,
    notifyChannels: brief.notifyChannels,
    generatedAt: brief.generatedAt,
    hint: "先处理「需关注」项（inbox / ask_user / paused / 熔断），再派新任务。markdown 可直接给用户看。",
  };
}

async function agentInspectTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const targetId = String(args.id || "");
  // 默认不附带全局 Memory：experience 会污染父 Agent 上下文，导致把「旧任务经验」当成当前结果
  const includeMemory = args.includeMemory === true;
  const includeSwarm = args.includeSwarm === true;
  const agent = await ctx.services.agent.getById(targetId);
  if (!agent) return { error: "Agent 不存在" };
  const scopeErr = checkWorkspaceAgentAccess(
    { tier: ctx.agentSnapshot?.tier ?? "sub", workspaceId: ctx.agentSnapshot?.workspaceId },
    { tier: agent.tier, workspaceId: agent.workspaceId, id: targetId },
    "agent_inspect",
  );
  // 管理 Agent 可 inspect 本空间；对超级仅允许看公开元信息（id/name/tier），禁止读会话/记忆
  if (scopeErr && !(scopeErr.code === "TIER_PROTECTED" && ctx.agentSnapshot?.tier === "manager" && agent.tier === "super")) {
    return { error: `[${scopeErr.code}] ${scopeErr.reason}` };
  }
  if (scopeErr?.code === "TIER_PROTECTED" && agent.tier === "super") {
    return {
      id: agent.id,
      name: agent.name,
      tier: agent.tier,
      status: agent.status,
      note: "超级 Agent 仅返回公开元信息；详情请通过消息/报告通道沟通。",
    };
  }
  // 获取最近 session + 消息
  const sessions = await ctx.prisma?.chatSession.findMany({
    where: { agentId: targetId },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 20 } },
    take: 5,
    orderBy: { updatedAt: "desc" },
  });
  let memories: unknown[] = [];
  if (includeMemory) {
    // W5：走 MemoryRepository 按 type 字段查（删除 startsWith("{") 猜 JSON 启发式），
    // scopes = global + 目标 Agent，experience 等其他 Agent 私有记忆天然隔离
    const repo = createMemoryRepository(ctx.services);
    const rows = await repo.read({
      types: ["preference", "semantic", "episodic"],
      scopes: [MEMORY_SCOPE_GLOBAL, memoryAgentScope(targetId)],
      limit: 5,
    });
    memories = rows.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content.slice(0, 200),
    }));
  }
  let swarm: unknown;
  if (includeSwarm && ctx.prisma) {
    const { getSwarmHealthSnapshot } = await import("../../swarmHealth.js");
    swarm = await getSwarmHealthSnapshot(ctx.prisma, targetId);
  }
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      tier: agent.tier,
      status: agent.status,
      model: agent.model,
      systemPrompt: agent.systemPrompt.slice(0, 200),
    },
    sessions:
      sessions?.map((s: any) => ({
        id: s.id,
        title: s.title,
        isMainSession: s.isMainSession,
        messageCount: s.messages?.length,
      })) ?? [],
    recentMessages:
      sessions?.flatMap(
        (s: any) =>
          s.messages?.map((m: any) => ({
            role: m.role,
            content: m.content?.slice(0, 100),
            source: m.source,
          })) ?? [],
      ) ?? [],
    memories,
    swarm,
    hint: [
      includeMemory ? null : "默认不返回 Memory；需要时传 includeMemory=true。",
      includeSwarm ? null : "需要 inbox/队列/ask_user 积压时传 includeSwarm=true。",
      "请以 agent.id（cuid）为准，勿编造 ID。",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

type PrepareAgentRunResult =
  /** 已起流（或 dedup 命中已有答案）：completion 解析为本轮最终 assistant 文本 */
  | { kind: "started"; subagentSessionId: string; completion: Promise<string> }
  /** 子会话忙（或队列有残留）：消息已入服务端持久队列；drainPromise 为 per-session 串行 drain 链 promise
   * （随队列排空解析——FIFO 保证本 item 先于链尾被处理，await 它即等到「本 item 处理完成」，可能多等后排入队项） */
  | { kind: "queued"; subagentSessionId: string; drainPromise: Promise<void> }
  /** 入队被守卫拒绝（QUEUE_FULL / DELEGATION_DEPTH_EXCEEDED 等） */
  | { kind: "failed"; subagentSessionId: string; error: string };

/**
 * 派活准备段：解析 Agent → 主会话 find-or-create → busy 判定 → 入队 或（dedup/写消息/起流）。
 *
 * W-E busy 分支（写 ChatMessage 之前判定）：
 * - hub.isRunning(主会话) → 消息进服务端持久队列（bus.send 写 AgentMessage 走 depth/queue-size
 *   守卫 + sessionQueueItem.create superior 镜像，幂等），注册服务端 drain，子等闲自动处理；
 *   不写 ChatMessage（本轮结束前消息不进子历史）。旧实现是等本轮结束直接返回旧 assistant，
 *   新消息躺在历史里无人处理。
 * - idle 但队列有残留（服务端重启链丢失场景）：新消息同样入队尾，drain 立即触发，FIFO 保序。
 *   已知限制：pending 项跨重启留存，靠下次发送或前端打开会话 drain 兜底
 *   （与 AGENTS.md「运行中任务随重启丢失」一致）。
 * - opts.fromDrain（drain 重入）跳过残留检查：残留项由 drain 循环自身按序处理，
 *   否则「认领队首 → 见残留再入队尾」会活锁。
 */
async function prepareAgentRun(
  targetAgentId: string,
  input: string,
  ctx: NativeToolContext,
  opts?: { messageType?: "command" | "query" | "report" | "forward"; fromDrain?: boolean },
): Promise<PrepareAgentRunResult> {
  // 锁仅覆盖 prepare 段（会话 find-or-create / busy / dedup / 写消息 / 起流），不盖整轮 run。
  // SWARM_MODE=redis 时走 Redis SET NX，多实例互斥；local 走进程内链。
  return getAgentRunLock().withLock(targetAgentId, async () => {
    let sessionIdForCleanup: string | undefined;
    try {
      // W4：优先用 ctx 注入的 resolveAgent（见 createAgentToolContext），缺省回退到 agentResolver 叶子模块
      const resolveAgent = ctx.resolveAgent ?? defaultResolveAgent;
      const { agent } = await resolveAgent(ctx.services, targetAgentId);
      if (!agent || agent.status === "deleted") throw new Error("目标 Agent 不存在或已删除");

      let mainSession = await ctx.prisma?.chatSession.findFirst({
        where: { agentId: targetAgentId, isMainSession: true, status: { not: "deleted" } },
        // 存量若曾双主会话，取最近更新的一条（SessionService 已阻止新建双主）
        orderBy: { updatedAt: "desc" },
      });
      if (!mainSession) {
        const created = await ctx.services.session.create({
          title: `${agent.name} 主会话`,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          agentId: targetAgentId,
          isMainSession: true,
          kind: "subagent",
          parentSessionId: ctx.sessionId ?? undefined,
          status: "running",
          taskDescription: input.slice(0, 200),
        });
        if (created.success && created.data) {
          mainSession = await ctx.prisma?.chatSession.findUnique({ where: { id: (created.data as { id: string }).id } }) ?? null;
        }
      } else {
        // 已有主会话（含 P11 空壳主会话）：刷新血缘 + running，保证 report_back / 队列查询可定位
        const patch: Record<string, unknown> = { status: "running" };
        if (mainSession.kind !== "subagent") patch.kind = "subagent";
        if (ctx.sessionId && mainSession.parentSessionId !== ctx.sessionId) {
          patch.parentSessionId = ctx.sessionId;
        }
        if (Object.keys(patch).length > 0) {
          try {
            await ctx.services.session.update({ id: mainSession.id, ...patch } as any);
            mainSession = { ...mainSession, ...patch } as typeof mainSession;
          } catch {
            /* 补齐失败不阻塞运行 */
          }
        }
      }
      if (!mainSession) throw new Error("无法创建或找到目标 Agent 的主会话");
      sessionIdForCleanup = mainSession.id;

      // W-E busy 判定（写 ChatMessage 之前）。hub 缺失时跳过判定，idle 路径在起流前再报错（原语义）
      // SWARM_MODE=redis 时再看跨实例 running 宣称（本进程 hub 看不到他机内存 runs）
      const hub = getStreamHub();
      let shouldQueue = false;
      if (hub) {
        shouldQueue = hub.isRunning(mainSession.id);
        if (!shouldQueue) {
          shouldQueue = await isSessionRunningClaimed(mainSession.id);
        }
        if (!shouldQueue && !opts?.fromDrain) {
          const residual = (await ctx.services.sessionQueueItem?.listBySession(mainSession.id)) ?? [];
          shouldQueue = residual.length > 0;
        }
      }

      if (shouldQueue && hub) {
        if (!ctx.prisma) throw new Error("agent_send_message 需要 prisma 上下文");
        const bus = getSwarmBus(ctx.prisma, ctx.services);
        // 走 bus.send（depth/queue-size/向上时机守卫）——旧 autoRun 路绕过守卫，此路径顺带补上
        const sent = await bus.send(
          {
            fromAgentId: ctx.agentSnapshot?.id ?? "",
            toAgentId: targetAgentId,
            content: input,
            messageType: opts?.messageType,
            source: ctx.agentSnapshot?.tier as any,
          },
          ctx.agentSnapshot?.tier ?? "sub",
          ctx.agentSnapshot?.workspaceId ?? null,
          ctx.inToolRound ?? false,
        );
        if (!sent.success || !sent.messageId) {
          return {
            kind: "failed",
            subagentSessionId: mainSession.id,
            error: `[${sent.error?.code ?? "SEND_FAILED"}] ${sent.error?.reason ?? "消息入队失败"}`,
          };
        }
        // 发送方名称（队列项展示用），解析失败不阻塞
        let sourceName: string | undefined;
        if (ctx.agentSnapshot?.id) {
          try {
            const fromAgent = await ctx.services.agent.getById(ctx.agentSnapshot.id);
            sourceName = (fromAgent as { name?: string } | null)?.name;
          } catch { /* ignore */ }
        }
        // superior 镜像入队：同 agentMessageId 幂等不重复；shouldSkipSuperiorMirror 对账逻辑不动
        await ctx.services.sessionQueueItem.create({
          sessionId: mainSession.id,
          kind: "superior",
          content: input,
          source: ctx.agentSnapshot?.id ?? "unknown",
          sourceName,
          agentMessageId: sent.messageId,
        });
        // 服务端 drain：子等闲时按 FIFO 自动处理（复用 per-session 串行链）。
        // 动态 import：asyncJobManager 经 agentRuntime/agentStream/agentTools 处于 ReAct 环内
        const { enqueueSuperiorQueueDrain } = await import("../../asyncJobManager.js");
        const drainPromise = enqueueSuperiorQueueDrain({
          sessionId: mainSession.id,
          config: ctx.config,
          services: ctx.services,
          runItem: async (item) => {
            const next = await prepareAgentRun(targetAgentId, item.content, ctx, { fromDrain: true });
            if (next.kind === "started") {
              await next.completion;
            } else if (next.kind === "failed") {
              // 守卫拒绝（QUEUE_FULL 等）：不重试，记日志（item 已认领，消息终结于此）
              console.warn(`[agent_send_message] drain 重入被守卫拒绝 target=${targetAgentId}: ${next.error}`);
            }
            // kind=queued：claim 后、start 前会话又被占的极端竞态——内容已重新入队尾，交给链后续迭代
          },
        });
        return { kind: "queued", subagentSessionId: mainSession.id, drainPromise };
      }

      const messageSource = (ctx.agentSnapshot?.tier ?? "super") as "super" | "manager" | "sub" | "user" | "system";
      // 幂等：同内容父任务只写一次；若已有对应 assistant 则直接返回，避免双写/双跑
      const dupUser = await ctx.prisma?.chatMessage.findFirst({
        where: {
          sessionId: mainSession.id,
          role: "user",
          content: input,
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      if (dupUser) {
        const lastAssistant = await ctx.prisma?.chatMessage.findFirst({
          where: {
            sessionId: mainSession.id,
            role: "assistant",
            createdAt: { gte: dupUser.createdAt },
          },
          select: { content: true },
          orderBy: { createdAt: "desc" },
        });
        if (lastAssistant) {
          try {
            await ctx.services.session.update({ id: mainSession.id, status: "completed" } as any);
          } catch { /* ignore */ }
          return {
            kind: "started",
            subagentSessionId: mainSession.id,
            completion: Promise.resolve(lastAssistant.content || "(无文本输出)"),
          };
        }
      } else {
        await ctx.services.message.create({
          sessionId: mainSession.id,
          role: "user",
          content: input,
          source: messageSource,
        });
      }

      // 动态 import：agentStream 经 agentRuntime/loop 处于 ReAct 环内，静态导入会重建循环依赖
      const { runAgentLoopStream } = await import("../../agentStream.js");
      if (!hub) {
        throw new Error("SessionStreamHub 未初始化，无法启动子 Agent 流式运行");
      }

      const memoryHint = await buildAllMemoryHints(ctx.services, input, {
        agentId: agent.id,
        sessionId: mainSession.id,
      });
      const tierTools = resolveToolsForAgentTier(agent.tier, agent.tools);
      const systemPrompt = buildSystemPromptWithHints(agent.systemPrompt, tierTools, memoryHint, {
        tier: agent.tier,
        name: agent.name,
      });
      // 会话 model 优先：spawn_subagent 复用 agentId 时可通过 session.model 覆盖本轮模型
      const runModel = (mainSession.model && String(mainSession.model).trim()) || agent.model;
      const messages: LlmMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: input },
      ];
      const invokeTrpc = createTrpcInvoker({ services: ctx.services });
      const agentMeta = {
        id: agent.id,
        model: runModel,
        systemPrompt,
        tools: tierTools,
        tier: agent.tier,
        parentId: agent.parentId,
        workspaceId: agent.workspaceId,
      };

      let assistantContent = "(无文本输出)";

      await hub.start(mainSession.id, {
        sessionId: mainSession.id,
        agentId: agent.id,
        message: input,
      }, async (emit, hubSignal) => {
        try {
          const loop = await runAgentLoopStream({
            config: ctx.config,
            services: ctx.services,
            agent: { model: runModel, systemPrompt, tools: tierTools },
            messages,
            llmOptions: {},
            invokeTrpc,
            emit,
            sessionId: mainSession!.id,
            agentMeta,
            signal: hubSignal,
            runOrigin: "parent",
          });

          assistantContent =
            (loop.content && loop.content.trim()) ||
            loop.toolCalls
              .filter((t) => t.kind === "content")
              .map((t) => String(t.result ?? ""))
              .join("\n")
              .trim() ||
            "(无文本输出)";

          // 运行成功：把最终文本落库为 assistant 消息，供 report_back / 同步等待抓取
          await ctx.services.message.create({
            sessionId: mainSession!.id,
            role: "assistant",
            content: assistantContent,
            toolCalls: loop.toolCalls as any,
            tokenUsage: loop.tokenUsage,
            source: "sub",
          });

          try {
            // 子 Agent 运行完成：主会话进入 completed，释放后续 drain 的 idle 条件
            await ctx.services.session.update({ id: mainSession!.id, status: "completed" } as any);
          } catch { /* ignore */ }

          emit({
            type: "done",
            sessionId: mainSession!.id,
            agentId: agent.id,
            content: assistantContent,
            toolCalls: loop.toolCalls,
            model: loop.model,
            provider: loop.provider,
            roundsUsed: loop.roundsUsed,
            tokenUsage: loop.tokenUsage,
          });
        } catch (err: unknown) {
          const errorText = err instanceof Error ? err.message : String(err);
          try {
            await ctx.services.message.create({
              sessionId: mainSession!.id,
              role: "assistant",
              content: `任务未能完成：${errorText}`,
              source: "sub",
            });
          } catch { /* ignore */ }
          try {
            // 运行异常：标 failed 阻止重复 drain，保留人工排查现场
            await ctx.services.session.update({ id: mainSession!.id, status: "failed" } as any);
          } catch { /* ignore */ }
          emit({ type: "error", message: errorText, sessionId: mainSession!.id });
          throw err;
        }
      });

      // 通知前端立刻挂接子会话流（避免切到子页后空白、刷新才出现）
      hub.pushExternalEvent(mainSession.id, {
        type: "session_run_started",
        sessionId: mainSession.id,
        reason: "subagent_start",
      });
      if (ctx.sessionId && ctx.sessionId !== mainSession.id) {
        hub.pushExternalEvent(ctx.sessionId, {
          type: "session_run_started",
          sessionId: mainSession.id,
          reason: "subagent_start",
        });
      }

      // completion 独立成 promise：调用方决定等（waitForRun / drain runItem）或后台跑
      const completion = (async () => {
        await hub.waitFor(mainSession.id);
        return assistantContent;
      })();
      return { kind: "started", subagentSessionId: mainSession.id, completion };
    } catch (err) {
      // S1：运行中的会话状态归 runner 所有——prepare 段失败（busy 分支 DB 异常，或起流
      // TOCTOU 被「已有运行中的 Agent 流」拒绝）不得把健康 running 会话误标 failed；
      // 仅当无活跃流（失败真实发生在起流前）才由 prepare 段兜底标 failed
      if (sessionIdForCleanup) {
        let hasLiveRun = false;
        try {
          hasLiveRun = getStreamHub()?.isRunning(sessionIdForCleanup) ?? false;
        } catch { /* ignore */ }
        if (!hasLiveRun) {
          try {
            await ctx.services.session.update({ id: sessionIdForCleanup, status: "failed" } as any);
          } catch { /* ignore */ }
        }
      }
      throw err;
    }
  });
}

/**
 * 为单个会话挂 superior FIFO drain（与 busy 入队 / R-2 重注册同源）。
 * 幂等：重复注册只是链上多一次空转；consume 原子认领保证同一项只被处理一次。
 */
export async function enqueueSuperiorDrainForSession(options: {
  sessionId: string;
  targetAgentId: string;
  config: AppConfig;
  services: ServiceContainer;
}): Promise<void> {
  const { sessionId, targetAgentId, config, services } = options;
  const { enqueueSuperiorQueueDrain } = await import("../../asyncJobManager.js");
  return enqueueSuperiorQueueDrain({
    sessionId,
    config,
    services,
    runItem: async (item) => {
      // 重建最小 NativeToolContext：sessionId 留空——不刷新 parentSessionId，
      // 保留原 spawn 的 report_back 路由；发送方 tier 实时解析（仅决定注入消息 source 标识）
      let tier: string | undefined;
      if (item.source) {
        try {
          const fromAgent = await services.agent.getById(item.source);
          tier = (fromAgent as { tier?: string } | null)?.tier;
        } catch {
          /* 解析失败按缺省处理 */
        }
      }
      const drainCtx: NativeToolContext = {
        config,
        services,
        prisma: services.prisma,
        invokeTrpc: createTrpcInvoker({ services }),
        agentSnapshot: { id: item.source ?? "unknown", model: "", systemPrompt: "", tools: [], tier },
        inToolRound: false,
      };
      const next = await prepareAgentRun(targetAgentId, item.content, drainCtx, { fromDrain: true });
      if (next.kind === "started") {
        await next.completion;
      } else if (next.kind === "failed") {
        console.warn(
          `[enqueueSuperiorDrainForSession] drain 重入被守卫拒绝 session=${sessionId}: ${next.error}`,
        );
      }
    },
  });
}

/**
 * R-2 启动恢复动作 3：superior 孤儿队列项重注册服务端 drain。
 *
 * 进程内 drain 链随重启丢失，pending 队列项跨重启留存于 SQLite（W-E 已知限制）。
 * 重启首扫为每个有待处理 superior 项的活跃会话重新注册 drain，会话空闲后按 FIFO consume。
 * 返回重注册 drain 的会话数。
 */
export async function requeueOrphanedSuperiorDrains(
  config: AppConfig,
  services: ServiceContainer,
): Promise<number> {
  const hub = getStreamHub();
  if (!hub) return 0;
  const items = await services.prisma.sessionQueueItem.findMany({
    where: { kind: "superior" },
    select: { sessionId: true },
  });
  const sessionIds = [...new Set(items.map((i) => i.sessionId))];
  if (sessionIds.length === 0) return 0;
  const liveSessions = await services.prisma.chatSession.findMany({
    where: { id: { in: sessionIds }, status: { notIn: ["deleted", "archived"] }, agentId: { not: null } },
    select: { id: true, agentId: true },
  });
  let registered = 0;
  for (const session of liveSessions) {
    void enqueueSuperiorDrainForSession({
      sessionId: session.id,
      targetAgentId: session.agentId as string,
      config,
      services,
    });
    registered++;
  }
  return registered;
}

export async function agentSendMessageTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("agent_send_message 需要 prisma 上下文");
  const bus = getSwarmBus(ctx.prisma, ctx.services);
  const content = String(args.content || "");
  const autoRun = args.autoRun !== false;
  const waitForRun = args.waitForRun === true;
  const toAgentId = String(args.toAgentId || "");

  // 层级/范围权限硬拦截（#49）
  const toAgent = await ctx.prisma.agent.findUnique({ where: { id: toAgentId } });
  if (!toAgent || toAgent.status === "deleted") {
    return {
      success: false,
      error: `目标 Agent ${toAgentId} 不存在或已删除。`,
      permissionDenied: true,
    };
  }
  const permissionError = await checkAgentSendMessagePermission(ctx.prisma, {
    fromAgentId: ctx.agentSnapshot?.id ?? "",
    fromTier: ctx.agentSnapshot?.tier ?? "sub",
    fromWorkspaceId: ctx.agentSnapshot?.workspaceId,
  }, toAgent);
  if (permissionError) {
    return {
      success: false,
      error: `[${permissionError.code}] ${permissionError.reason}`,
      permissionDenied: true,
    };
  }

  // autoRun：走 prepareAgentRun（busy 判定 → 入队 或 写 ChatMessage + 起流），绝不先写 pending AgentMessage
  // 再直接起流。否则前端 pullAgentMessages → SessionQueueItem → consumeQueue → runStream
  // 会与起流路径各写一条同内容 user 气泡，并可能二次跑 Agent。
  if (autoRun && content.trim()) {
    let prepared: PrepareAgentRunResult;
    try {
      prepared = await prepareAgentRun(toAgentId, content, ctx, { messageType: args.messageType as any });
    } catch (err: unknown) {
      // 准备段失败（会话/StreamHub 不可用、起流竞态等）：runner 已把会话标 failed + 错误气泡，
      // 非阻塞派活语义保持「已派活」返回（spawn_subagent 的 fire-and-forget 依赖此契约）
      console.warn(`[agent_send_message] 自动触发目标 Agent ${toAgentId} 运行失败:`, err);
      if (waitForRun) {
        // S4：同步等待语义必须如实报错——success:true + 空 content 会让 LLM 误以为等待成功、拿到空结果
        return { success: false, error: `派活准备失败：${err instanceof Error ? err.message : String(err)}` };
      }
      return { success: true, message: "已派活并自动运行（子会话可实时查看流式输出）。" };
    }

    // 入队被 depth/queue-size 等守卫拒绝：如实回传，调用方（LLM）需感知并换策略
    if (prepared.kind === "failed") {
      return { success: false, error: prepared.error };
    }

    if (prepared.kind === "queued") {
      if (!waitForRun) {
        return {
          success: true,
          queued: true,
          message: "子 Agent 正在运行，消息已入队，其空闲时自动处理。",
        };
      }
      // waitForRun=true + busy：等该 item 的 drain 完成（链 promise），再读子会话最后 assistant
      await prepared.drainPromise;
      const lastAssistant = await ctx.prisma.chatMessage.findFirst({
        where: { sessionId: prepared.subagentSessionId, role: "assistant" },
        select: { content: true },
        orderBy: { createdAt: "desc" },
      });
      return {
        success: true,
        queued: true,
        message: "子 Agent 正在运行，消息已入队并已在空闲时处理。",
        content: lastAssistant?.content || "(无文本输出)",
        subagentSessionId: prepared.subagentSessionId,
      };
    }

    if (waitForRun) {
      const content = await prepared.completion;
      return {
        success: true,
        message: "已派活并自动运行。",
        content,
        subagentSessionId: prepared.subagentSessionId,
      };
    }
    // 非阻塞：后台跑 StreamHub；失败时 runner 内部会写 failed + 错误气泡
    void prepared.completion.catch((err: unknown) => {
      console.warn(`[agent_send_message] 目标 Agent ${toAgentId} 后台运行失败:`, err);
    });
    return { success: true, message: "已派活并自动运行（子会话可实时查看流式输出）。" };
  }

  // 非 autoRun：写入收件箱，由子会话 UI 队列消费后再 runStream
  // taskRef 是对账键，只允许服务端内部赋值（W16a-3），不接受 LLM 入参
  const result = await bus.send(
    {
      fromAgentId: ctx.agentSnapshot?.id ?? "",
      toAgentId,
      content,
      messageType: args.messageType as any,
      source: ctx.agentSnapshot?.tier as any,
    },
    ctx.agentSnapshot?.tier ?? "sub",
    ctx.agentSnapshot?.workspaceId ?? null,
    ctx.inToolRound ?? false,
  );

  return result.success ? { success: true, message: result.message } : { error: `[${result.error?.code}] ${result.error?.reason}` };
}

async function agentReportBackTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 软限制：有上级即可回报。异步续跑 / 用户在子会话补充后也应能 report_back。
  // 投递目标由 parentSessionId（spawn 绑定）决定，见下方桥接逻辑。
  if (!ctx.agentSnapshot?.parentId) {
    return { error: "当前 Agent 无上级（parentId 为空），无法 report_back。" };
  }
  if (!ctx.prisma) throw new Error("agent_report_back 需要 prisma 上下文");
  const content = String(args.content || "");
  const bus = getSwarmBus(ctx.prisma, ctx.services);
  // report_back 本身就是正式向上回报通道，即使在工具轮次中也必须放行。
  // taskRef 不接受 LLM 入参（W16a-3）：桥接找到跟踪 Task 后由服务端强制写 jobId（下方）
  const result = await bus.send(
    {
      fromAgentId: ctx.agentSnapshot.id,
      toAgentId: ctx.agentSnapshot.parentId,
      content,
      messageType: (args.messageType as any) ?? "report",
      source: ctx.agentSnapshot.tier as any,
    },
    ctx.agentSnapshot?.tier ?? "sub",
    ctx.agentSnapshot?.workspaceId ?? null,
    false,
  );
  if (!result.success) {
    return { error: `[${result.error?.code}] ${result.error?.reason}` };
  }

  // 桥接：完成父会话跟踪 Task（spawn 时创建）或新建投递，供 pullAsyncQueue / 异步列表消费
  try {
    let parentSessionId: string | undefined;
    if (ctx.sessionId) {
      const subSession = await ctx.prisma.chatSession.findUnique({
        where: { id: ctx.sessionId },
        select: { parentSessionId: true },
      });
      parentSessionId = subSession?.parentSessionId ?? undefined;
    }

    // 子会话未绑 parentSessionId 时：按「跟踪 Task」反查 spawn 时的父 session（多父会话场景）
    if (!parentSessionId && ctx.prisma) {
      const trackers = await ctx.prisma.task.findMany({
        where: {
          OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
          status: { in: ["running", "queued", "success"] },
        },
        orderBy: { createdAt: "desc" },
        take: 40,
      });
      const bySubSession = trackers.find((row) => {
        const input = row.input as { subagentSessionId?: string } | null;
        return !!ctx.sessionId && input?.subagentSessionId === ctx.sessionId;
      });
      if (bySubSession?.sessionId) {
        parentSessionId = bySubSession.sessionId;
      } else {
        const byAgent = trackers.find((row) => {
          const input = row.input as { agentSnapshot?: { id?: string } } | null;
          return input?.agentSnapshot?.id === ctx.agentSnapshot?.id;
        });
        if (byAgent?.sessionId) parentSessionId = byAgent.sessionId;
      }
    }

    // 仍找不到则跳过队列桥接（SwarmBus 消息已发出）；不再回退到父 Agent isMainSession，避免投错会话
    if (!parentSessionId) {
      console.warn(
        `[agent_report_back] 无法解析父 session（子会话 ${ctx.sessionId ?? "?"} 无 parentSessionId 且无跟踪 Task），跳过异步队列投递`,
      );
    }

    if (parentSessionId) {
      const snapshot = ctx.agentSnapshot!;
      let fromName: string | undefined;
      try {
        const me = await ctx.services.agent.getById(snapshot.id);
        fromName = (me as { name?: string })?.name;
      } catch { /* ignore */ }
      const taskLabel = fromName
        ? `子 Agent 回报 · ${fromName}`
        : `子 Agent 回报 · ${snapshot.id.slice(0, 6)}`;

      // 优先完成 spawn 时挂在父会话上的 running 跟踪 Task。
      // 关联键是 subagentSessionId（spawn Phase A 写入 input）——必须按血缘键精确匹配，
      // 不能用「最新 N 条活跃任务」时间窗：高并发 spawn（活跃跟踪任务超过窗口）会把
      // 早完成子 Agent 的跟踪 Task 挤出窗口 → 失配后僵尸 running + 重复投递行（TP-4 压测暴露）。
      let jobId: string | undefined;
      let matched: { id: string; input: unknown } | null = null;
      if (ctx.sessionId) {
        matched = await ctx.prisma.task.findFirst({
          where: {
            sessionId: parentSessionId,
            status: { in: ["running", "queued"] },
            OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
            input: { path: "$.subagentSessionId", equals: ctx.sessionId },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, input: true },
        });
      }
      // 零兼容纪律：精确匹配是唯一匹配方式，miss 时**不做**任何模糊兜底（旧「take:20 时间窗 +
      // agentSnapshot.id」语义已删除）——同 Agent 并发任务的跟踪 Task 会被误完成。matched=null
      // 走下方 create 新 success Task 投递结果：不丢、不误投。

      if (matched) {
        await ctx.services.task.update({
          id: matched.id,
          status: "success",
          finishedAt: new Date(),
          output: { asyncResult: content },
        } as any);
        jobId = matched.id;
      } else {
        const created = await ctx.services.task.create({
          name: `[async] ${taskLabel}`,
          type: "async_agent",
          status: "success",
          sessionId: parentSessionId,
          finishedAt: new Date(),
          delivered: false,
          input: {
            kind: "async_agent",
            sessionId: parentSessionId,
            task: content.slice(0, 200),
            taskLabel,
            agentSnapshot: {
              id: snapshot.id,
              model: snapshot.model,
              systemPrompt: "",
              tools: [],
              tier: snapshot.tier,
              parentId: snapshot.parentId,
              workspaceId: snapshot.workspaceId,
              name: fromName,
            },
            subagentSessionId: ctx.sessionId,
            sourceType: "subagent",
          },
          output: { asyncResult: content },
        } as any);
        if (created.success && created.data) {
          jobId = (created.data as { id: string }).id;
        }
      }

      if (jobId) {
        // W14：AgentMessage ↔ 跟踪 Task 关联（taskRef=jobId）。report_back 的消费发生在 Task 管道，
        // 投递记账（delivered/consumed 回写）全靠这个关联按 taskRef 对账；关联失败不阻塞投递。
        if (result.messageId) {
          try {
            await ctx.prisma.agentMessage.update({
              where: { id: result.messageId },
              data: { taskRef: jobId },
            });
          } catch (ledgerErr) {
            console.warn("[agent_report_back] AgentMessage taskRef 关联失败（不阻塞投递）:", ledgerErr);
          }
        }
        const matchedInput = (matched?.input ?? null) as { deliverToQueue?: boolean } | null;
        if (matchedInput?.deliverToQueue === false) {
          // waitForResult（W16a-2）：结果已由 spawn 工具同步返回（tool return 即交付，此刻发生），
          // 消息链路就此终结——直接把旁路邮箱记账 consumed，deliveredAt 如实记为 report_back 时刻。
          // 不终结的话：Task 永不 CLAIM → 回写永不触发 → AgentMessage 永远 pending，
          // 修复脚本 content 匹配永远 MISS 告警不消解，且 pending 计入 SWARM_MAX_QUEUE_SIZE 会堵到 QUEUE_FULL。
          if (result.messageId) {
            try {
              await ctx.prisma.agentMessage.update({
                where: { id: result.messageId },
                data: { status: "consumed", deliveredAt: new Date() },
              });
            } catch (ledgerErr) {
              console.warn("[agent_report_back] waitForResult 消息终结记账失败（不阻塞回报）:", ledgerErr);
            }
          }
        } else {
          // 动态 import：asyncJobManager 经 agentRuntime/agentStream/agentTools 处于 ReAct 环内，静态导入会重建循环依赖
          const { notifyAndAutoConsumeAsyncDelivery } = await import("../../asyncJobManager.js");
          await notifyAndAutoConsumeAsyncDelivery({
            sessionId: parentSessionId,
            jobId,
            status: "done",
            taskLabel,
            services: ctx.services,
            config: ctx.config,
          });
        }
      }
    }
  } catch (err) {
    console.warn("[agent_report_back] 桥接父会话异步投递失败:", err);
  }

  return { success: true, message: "已向上级回报。" };
}

export async function agentCreateSubTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 默认落在当前父 Agent 所在 Workspace；仅超级 Agent 可通过 workspaceId 跨 Workspace 创建
  const callerTier = ctx.agentSnapshot?.tier ?? "sub";
  let workspaceId = ctx.agentSnapshot?.workspaceId ?? undefined;
  if (callerTier === "super" && args.workspaceId) {
    workspaceId = String(args.workspaceId);
  }
  if (!workspaceId && ctx.prisma) {
    const systemWs = await ctx.prisma.workspace.findFirst({
      where: { isSystem: true, status: { not: "deleted" } },
      select: { id: true },
    });
    workspaceId = systemWs?.id;
  }
  const rawTools = Array.isArray(args.tools) ? (args.tools as string[]) : [];
  const tools = getAllowedToolsForTier("sub", resolveToolsForAgentTier("sub", rawTools));
  const created = await ctx.services.agent.create({
    name: String(args.name || ""),
    description: args.description ? String(args.description) : undefined,
    model: args.model ? String(args.model) : ctx.config.llm.defaultModel,
    systemPrompt: args.systemPrompt ? String(args.systemPrompt) : "",
    tools,
    tier: "sub",
    workspaceId,
    parentId: ctx.agentSnapshot?.id,
    source: "native_tool:agent_create_sub",
    apiKey: args.apiKey as string | undefined,
  });
  if (!created.success || !created.data) return { error: created.error?.message ?? "创建子 Agent 失败" };
  // 审计日志
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "sub_agent_created",
    message: `子 Agent ${created.data.name} 被创建`,
    metadata: { agentId: created.data.id, parentAgentId: ctx.agentSnapshot?.id, workspaceId: ctx.agentSnapshot?.workspaceId },
  }).catch(() => {});
  return { success: true, agentId: created.data.id, name: created.data.name };
}

async function workspaceCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const name = String(args.name || "");
  const path = String(args.path || "");
  if (!name || !path) return { error: "workspace_create 需要 name 和 path" };
  const withManager =
    args.withManager === undefined && args.autoCreateManager === undefined
      ? undefined
      : args.withManager !== false && args.autoCreateManager !== false;
  const result = await provisionWorkspace(ctx.config, ctx.services, {
    name,
    path,
    description: args.description as string | undefined,
    managerModel: args.managerModel as string | undefined,
    managerSystemPrompt: args.managerSystemPrompt as string | undefined,
    managerName: args.managerName as string | undefined,
    withManager,
    autoCreateManager: withManager,
    initialTask: args.initialTask as string | undefined,
    asyncSlotQuota:
      args.asyncSlotQuota !== undefined ? Number(args.asyncSlotQuota) : undefined,
    operatorAgentId: ctx.agentSnapshot?.id,
    managerParentId: ctx.agentSnapshot?.id,
  });
  if (!result.success) return { error: result.error };
  return {
    success: true,
    workspaceId: result.workspaceId,
    managerAgentId: result.managerAgentId,
    managerSessionId: result.managerSessionId,
    initialTaskStatus: result.initialTaskStatus,
    message: result.managerAgentId
      ? `Workspace ${name} 已创建，管理 Agent 已就绪。`
      : `Workspace ${name} 已创建（未创建管理 Agent）。`,
  };
}

async function workspaceArchiveTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const wsId = String(args.id || "");
  const ws = await ctx.services.workspace.getById(wsId).catch(() => null);
  if (!ws) return { error: "Workspace 不存在" };
  if ((ws as { isSystem?: boolean }).isSystem) {
    return { error: "[SYSTEM_WORKSPACE_IMMUTABLE] Root / 系统 Workspace 不可归档。" };
  }
  // 归档：Workspace status=archived + 所有 Agent status=dormant
  const updated = await ctx.services.workspace.update({ id: wsId, status: "archived" } as any);
  if (!updated.success) return { error: updated.error?.message ?? "归档失败" };
  const agents = await ctx.prisma?.agent.findMany({ where: { workspaceId: wsId, status: { not: "deleted" } } }) ?? [];
  for (const a of agents) {
    await ctx.services.agent.update({ id: a.id, status: "dormant" } as any).catch(() => {});
  }
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "workspace_archived",
    message: `Workspace ${wsId} 已归档（${agents.length} 个 Agent 设为 dormant）`,
    metadata: { workspaceId: wsId, agentCount: agents.length, operatorAgentId: ctx.agentSnapshot?.id },
  }).catch(() => {});
  return { success: true, message: `Workspace 已归档，${agents.length} 个 Agent 设为 dormant。可随时恢复。` };
}

// ─── 免费 API Key 工具 ───

async function freeApiKeysListTool(_args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const creds = await ctx.prisma.credential.findMany({
    where: { scope: { contains: "llm" } },
    select: { id: true, name: true, type: true, scope: true, lastUsedAt: true, metadata: true },
  });
  // 过滤出免费 key（metadata.source === "free"）
  const freeKeys = creds.filter((c) => {
    try {
      const meta = JSON.parse(c.metadata || "{}");
      return meta.source === "free";
    } catch {
      return false;
    }
  });
  return {
    count: freeKeys.length,
    keys: freeKeys.map((c) => ({
      id: c.id,
      name: c.name,
      lastUsedAt: c.lastUsedAt,
      // 不返回 value（安全）
    })),
  };
}

async function freeApiKeysFetchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const provider = args.provider as string | undefined;
  const where: any = { scope: { contains: "llm" } };
  // 按 lastUsedAt 升序排列，取最久未使用的
  const creds = await ctx.prisma.credential.findMany({
    where,
    orderBy: { lastUsedAt: "asc" },
    take: 20,
  });
  // 过滤免费 key + 可选 provider 匹配
  const freeKeys = creds.filter((c) => {
    try {
      const meta = JSON.parse(c.metadata || "{}");
      if (meta.source !== "free") return false;
      if (provider && meta.provider !== provider) return false;
      return true;
    } catch {
      return false;
    }
  });
  if (freeKeys.length === 0) {
    return { error: "无可用免费 API Key。请先运行 sync-free-keys 同步，或配置 LLM_API_KEY 环境变量。" };
  }
  const picked = freeKeys[0];
  // 标记 lastUsedAt
  await ctx.prisma.credential.update({
    where: { id: picked.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(picked.metadata || "{}") as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {
    apiKey: picked.value,
    credentialId: picked.id,
    name: picked.name,
    baseUrl: typeof meta.baseUrl === "string" ? meta.baseUrl : undefined,
    model: typeof meta.model === "string" ? meta.model : undefined,
    provider: typeof meta.provider === "string" ? meta.provider : undefined,
    hint: "使用后请勿持久化此 key，每次需要时重新获取。",
  };
}


async function freeModelsListTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!getOpenRouterFreeModelCatalog()) {
    loadOpenRouterFreeCatalogFromDisk(ctx.config.projectRoot);
  }

  const q = typeof args.q === "string" ? args.q.trim() : undefined;
  const modalityRaw = typeof args.modality === "string" ? args.modality : "all";
  const modality =
    modalityRaw === "text" || modalityRaw === "multimodal" || modalityRaw === "all"
      ? modalityRaw
      : "all";
  const sortRaw = typeof args.sort === "string" ? args.sort : "context_desc";
  const sort =
    sortRaw === "context_asc" || sortRaw === "name" || sortRaw === "context_desc"
      ? sortRaw
      : "context_desc";
  const limit = Math.min(100, Math.max(1, Math.floor(Number(args.limit) || 30)));
  const includeFreellm = args.includeFreellm !== false;

  const all = filterOpenRouterFreeModels({ q: q || undefined, modality, sort });
  const sliced = all.slice(0, limit);
  const items = sliced.map((m) => ({
    id: m.id,
    name: m.name,
    contextLength: m.contextLength,
    modality: m.modality,
    // 截断说明，避免一次把整份目录塞进上下文
    description: m.description ? m.description.slice(0, 240) : undefined,
  }));

  const result: Record<string, unknown> = {
    openRouter: {
      syncedAt: getOpenRouterFreeSyncedAt(),
      hasApiKey: !!ctx.config.llm.providers.openrouter?.apiKey?.trim(),
      totalMatched: all.length,
      returned: items.length,
      truncated: all.length > items.length,
      items,
      hint: "复制模型 id 到 Chat / spawn_subagent.model / compact.summaryModel 即可使用（:free 需 OPENROUTER_API_KEY）",
    },
  };

  if (includeFreellm && ctx.prisma) {
    const channels = await listFreellmChannels(ctx.prisma);
    const runtime = getFreellmGatewayRuntime();
    result.freellm = {
      runtimeModel: runtime?.model ?? null,
      total: channels.length,
      channels: channels.slice(0, limit).map((c) => ({
        model: c.model,
        name: c.name,
        provider: c.provider,
        validated: c.validated,
        isRuntime: c.isRuntime,
        status: c.status,
      })),
    };
  }

  return result;
}

// ─── Hermes 进化：Skill 发现与推广（#45）───

async function skillDiscoverTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const minSuccessRate = (args.minSuccessRate as number) ?? 80;
  const minUsageCount = Math.max(1, (args.minUsageCount as number) ?? 1);
  const limit = (args.limit as number) ?? 10;
  const skillsRoot = ctx.config.contentPaths.skills;
  const skills = await ctx.prisma.skill.findMany({
    where: { enabled: true },
    select: { id: true, name: true, description: true, icon: true, metaJson: true },
  });
  // 真实用量：.usage.json（view/patch）+ executable metaJson.stats；无统计不进榜
  const candidates = skills
    .map((s) => {
      const kind = parseSkillKind(s.metaJson, "executable");
      if (kind === "reference") return null;
      const side = getSkillUsage(s.name, skillsRoot);
      const execStats = parseSkillUsageStats(s.metaJson);
      const usageCount = Math.max(side?.viewCount ?? 0, side?.patchCount ?? 0, execStats?.usageCount ?? 0);
      if (usageCount < minUsageCount) return null;
      const successRate = execStats?.successRate ?? (usageCount > 0 ? 100 : 0);
      if (successRate < minSuccessRate) return null;
      return {
        ...s,
        kind,
        usageCount,
        successRate,
        lastUsedAt: latestActivityAt(side ?? { state: "active", viewCount: 0, patchCount: 0, createCount: 0 }) || execStats?.lastUsedAt,
      };
    })
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => b.usageCount - a.usageCount || b.successRate - a.successRate)
    .slice(0, limit);

  return {
    count: candidates.length,
    skills: candidates.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      icon: s.icon,
      kind: s.kind,
      usageCount: s.usageCount,
      successRate: s.successRate,
      lastUsedAt: s.lastUsedAt || undefined,
    })),
    hint: "仅含有真实调用/查看统计的已启用 Skill。skill_promote 需审批；主路径是 skill_manage 维护 procedural 包。",
  };
}

async function skillEnableTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const skillId = String(args.skillId || "");
  if (!skillId) return { error: "skill_enable 需要 skillId" };
  const skill = await ctx.services.skill.getById(skillId);
  if (!skill) return { error: `Skill ${skillId} 不存在` };
  if (skill.enabled) {
    return { success: true, alreadyEnabled: true, skillId, name: skill.name, message: `Skill ${skill.name} 已启用。` };
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(skill.metaJson || "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  meta.draft = false;
  meta.enabledAt = new Date().toISOString();
  meta.enabledByAgentId = ctx.agentSnapshot?.id ?? null;
  const updated = await ctx.services.skill.update({
    id: skillId,
    enabled: true,
    metaJson: JSON.stringify(meta),
  } as never);
  if (!updated.success) {
    return { error: updated.error?.message ?? "启用失败" };
  }
  await ctx.services.log?.create?.({
    level: "info",
    component: "swarm",
    event: "skill_enabled",
    message: `Skill ${skill.name} 已启用（经审批）`,
    metadata: { skillId, skillName: skill.name, operatorAgentId: ctx.agentSnapshot?.id },
  }).catch(() => {});
  return {
    success: true,
    skillId,
    name: skill.name,
    message: `Skill ${skill.name} 已启用，可被 Agent 调度；跨 Workspace 推广请用 skill_promote（亦需审批）。`,
  };
}

async function skillPromoteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const skillId = String(args.skillId || "");
  const targetAgentIds = Array.isArray(args.targetAgentIds) ? (args.targetAgentIds as string[]) : [];
  if (!skillId || targetAgentIds.length === 0) {
    return { error: "skill_promote 需要 skillId 和 targetAgentIds" };
  }
  const skill = await ctx.services.skill.getById(skillId);
  if (!skill) return { error: `Skill ${skillId} 不存在` };
  if (!skill.enabled) {
    return { error: `Skill ${skill.name} 仍是 draft（未启用）。请先 skill_enable 经审批启用后再推广。` };
  }
  const skillToolName = `skill:${skill.name}`;
  let promoted = 0;
  const errors: string[] = [];
  for (const agentId of targetAgentIds) {
    try {
      const agent = await ctx.services.agent.getById(agentId);
      if (!agent) { errors.push(`Agent ${agentId} 不存在`); continue; }
      const currentTools = agent.tools || [];
      if (currentTools.includes(skillToolName)) {
        errors.push(`Agent ${agent.name} 已有 Skill ${skill.name}`);
        continue;
      }
      await ctx.services.agent.update({
        id: agentId,
        tools: [...currentTools, skillToolName],
      } as any);
      promoted++;
    } catch (err) {
      errors.push(`Agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "skill_promoted",
    message: `Skill ${skill.name} 推广到 ${promoted} 个 Agent`,
    metadata: { skillId, skillName: skill.name, targetAgentIds, promoted, errors, operatorAgentId: ctx.agentSnapshot?.id },
  }).catch(() => {});
  return { success: true, promoted, errors: errors.length > 0 ? errors : undefined, message: `Skill ${skill.name} 已推广到 ${promoted} 个 Agent。` };
}

// ─── Agent 进化高级版 ───

async function optimizeAgentPromptTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const result = await optimizeAgentPrompt(
    ctx.prisma,
    ctx.services,
    String(args.agentId || ""),
    ctx.agentSnapshot?.id ?? "",
  );
  return result.success
    ? { success: true, message: "Prompt 已优化", optimized: result.optimized }
    : { error: result.reason ?? "优化失败" };
}

async function generateSkillFromExperienceTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const result = await generateSkillFromExperience(
    ctx.prisma,
    ctx.services,
    String(args.agentId || ""),
    String(args.skillName || ""),
    String(args.skillDescription || ""),
  );
  return result.success
    ? {
        success: true,
        skillId: result.skillId,
        draft: true,
        message:
          `已生成 executable draft（enabled=false）。注意：这不是 Hermes 主路径；` +
          `程序记忆请用 skill_manage 写 procedural SKILL.md 包，并经 skills_list/skill_view 加载。`,
      }
    : { error: result.reason ?? "生成失败" };
}

const SWARM_DEFS: NativeToolDefinition[] = [
  {
    name: "agent_create",
    description: "创建一个新 Agent（需超级权限）。可指定 tier/workspaceId/parentId。创建管理 Agent 时会自动生成主 session。",
    parameters: zodParams(
      z.object({
        name: z.string().describe("Agent 名称（可重复，id 全局唯一）"),
        description: z.string().optional(),
        model: z.string().describe("模型 ID").optional(),
        systemPrompt: z.string().optional(),
        tools: z.array(z.string()).describe("工具列表").optional(),
        tier: z.enum(["super", "manager", "sub"]).describe("层级").optional(),
        workspaceId: z.string().describe("所属 Workspace id（super 不需要）").optional(),
        parentId: z.string().describe("上级 Agent id").optional(),
        apiKey: z.string().describe("专属 API Key").optional(),
        heartbeatModel: z.string().describe("心跳用便宜模型").optional(),
        heartbeat: z.record(z.unknown()).describe("心跳配置 { enabled, cron, goal }").optional(),
      }),
    ),
  },
  {
    name: "agent_update",
    description: "更新 Agent 配置（超级=全局；管理 Agent=仅本 Workspace 内，不能改 tier/迁出空间）。超级 Agent 不可被降级。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("目标 Agent id"),
        name: z.string().optional(),
        description: z.string().optional(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
        tools: z.array(z.string()).optional(),
        apiKey: z.string().optional(),
        heartbeatModel: z.string().optional(),
        heartbeat: z.record(z.unknown()).describe("心跳配置").optional(),
        status: z.enum(["active", "idle", "dormant"]).describe("Agent 状态").optional(),
      }),
    ),
  },
  {
    name: "agent_delete",
    destructive: true,
    description: "删除 Agent（超级=全局；管理 Agent=仅本 Workspace）。超级 Agent 不可删除。tombstone 保留。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("目标 Agent id"),
      }),
    ),
  },
  {
    name: "agent_update_sub",
    description: "更新本 Workspace 内子 Agent（管理 Agent 工具别名，等同 agent_update + 出域硬拦）。",
    parameters: zodParams(z.object({
      id: z.string().describe("目标 Agent id"),
      name: z.string().optional(),
      description: z.string().optional(),
      model: z.string().optional(),
      systemPrompt: z.string().optional(),
      tools: z.array(z.string()).optional(),
      status: z.enum(["active", "idle", "dormant"]).optional(),
    })),
  },
  {
    name: "agent_delete_sub",
    destructive: true,
    description: "删除本 Workspace 内子 Agent（管理 Agent 工具别名，等同 agent_delete + 出域硬拦）。",
    parameters: zodParams(z.object({ id: z.string().describe("目标 Agent id") })),
  },
  {
    name: "agent_inspect",
    reentrant: true, // 只读：agent/session/memory/swarm 查询
    description:
      "查看 Agent 上下文（超级=全局；管理 Agent=本 Workspace；对超级仅返回公开元信息）。" +
      "includeSwarm=true 时附带 inbox 积压、会话运行态、ask_user pending、心跳熔断、superior 队列。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("目标 Agent id"),
        includeMemory: z.boolean().describe("是否包含 memory（默认 false）").optional(),
        includeSwarm: z
          .boolean()
          .describe("是否包含 Swarm 健康快照（inbox/队列/ask_user/心跳，默认 false）")
          .optional(),
      }),
    ),
  },
  {
    name: "swarm_brief",
    reentrant: true,
    description:
      "生成 Swarm 作战简报（markdown）：作用域内各 Agent 的 inbox/ask_user/paused/心跳/superior 队列与通知通道熔断。" +
      "超级默认全局，可传 workspaceId；管理 Agent 仅本 Workspace。派活前建议先调用，优先处理积压。",
    parameters: zodParams(
      z.object({
        workspaceId: z
          .string()
          .describe("收窄到某 Workspace（仅超级；管理 Agent 忽略并强制本空间）")
          .optional(),
        limit: z.number().describe("最多扫描多少个 Agent（默认 12，上限 30）").optional(),
      }),
    ),
  },
  {
    name: "agent_send_message",
    description: "向另一个 Agent 发送消息。向下发（super→manager、manager→sub）可在工具调用中发；向上发（sub→manager、manager→super）只能在正式回复中发。跨 Workspace 只有超级能发。目标正在运行时消息进入其服务端持久队列（返回 queued=true），其空闲时自动处理。",
    parameters: zodParams(
      z.object({
        toAgentId: z.string().describe("目标 Agent id"),
        content: z.string().describe("消息内容（纯文本或含文件路径引用）"),
        messageType: z.enum(["command", "query", "report", "forward"]).describe("消息类型").optional(),
      }),
    ),
  },
  {
    name: "agent_report_back",
    description:
      "【正式任务结果】把本轮任务的最终结果回报给上级，进入父会话「异步任务结果队列」（右栏待消费），父 Agent 会据此继续工作。" +
      "与 agent_notify_parent 的区别：report_back=任务完成/失败的正式交付；notify_parent=过程中的进度/催问/闲聊通知，走发送队列，不是任务结果。" +
      "非阻塞派活（waitForResult=false）完成后必须调用本工具；不要用 notify_parent 代替本工具交结果。",
    parameters: zodParams(
      z.object({
        content: z.string().describe("回报内容（任务最终结果全文）"),
        messageType: z.enum(["report", "query"]).describe("回报或请求帮助").optional(),
      }),
    ),
  },
  {
    name: "agent_create_sub",
    description:
      "创建子 Agent。默认落在当前父 Agent 所在 Workspace；超级 Agent 可传 workspaceId 跨 Workspace 创建。",
    parameters: zodParams(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
        tools: z.array(z.string()).optional(),
        workspaceId: z
          .string()
          .describe("目标 Workspace（仅超级 Agent 可跨 Workspace；默认=父 Agent 所在 Workspace）")
          .optional(),
        apiKey: z.string().optional(),
      }),
    ),
  },
  {
    name: "workspace_create",
    description:
      "创建业务 Workspace（需超级权限）。默认自动创建管理 Agent + 主 session + .knowpilot/；可设 withManager、initialTask、asyncSlotQuota（本空间后台 LLM 槽上限，默认 2，0=不限仍受全局硬顶）。",
    parameters: zodParams(
      z.object({
        name: z.string().describe("Workspace 名称"),
        description: z.string().optional(),
        path: z.string().describe("磁盘目录路径"),
        withManager: z.boolean().describe("是否创建管理 Agent（默认 true）").optional(),
        autoCreateManager: z.boolean().describe("同 withManager").optional(),
        managerName: z.string().describe("管理 Agent 名称").optional(),
        managerModel: z.string().describe("管理 Agent 的模型").optional(),
        managerSystemPrompt: z.string().describe("管理 Agent 的 system prompt（不填用默认模板）").optional(),
        initialTask: z.string().describe("发给管理 Agent 主会话的初始任务").optional(),
        asyncSlotQuota: z.number().describe("本 Workspace 后台 LLM 异步槽上限；0=不限；默认 2").optional(),
      }),
    ),
  },
  {
    name: "workspace_archive",
    description: "归档 Workspace（需超级权限）。归档 = 所有 Agent 设为 dormant，不跑心跳，不接收消息。可恢复。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("Workspace id"),
      }),
    ),
  },
  {
    name: "free_api_keys_list",
    reentrant: true, // 只读：Credential findMany（不触碰 lastUsedAt）
    description: "列出可用的免费 API Key 元数据（不返回明文；Credential 中 source=free）。仅管理 Agent（manager）及以上可调用。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "free_api_keys_fetch",
    description: "获取一个可用的免费 API Key（轮询分配，标记 lastUsedAt，返回明文）。仅管理 Agent（manager）及以上可调用；子 Agent 禁止。",
    parameters: zodParams(
      z.object({
        provider: z.string().describe(`偏好提供商（如 ${LLM_PROVIDER_DEEPSEEK}/openai），不填则随机分配`).optional(),
      }),
    ),
  },
  {
    name: "free_models_list",
    reentrant: true, // 只读：进程内/落盘目录 + freellm 通道元数据，永不返回明文 key
    description:
      "列出可用免费模型：OpenRouter :free 目录（id/上下文/模态/说明）+ 可选 freellm 网关通道元数据（无明文 key）。仅管理 Agent（manager）及以上可调用。可用 q/modality/sort/limit 缩小结果，避免撑爆上下文。",
    parameters: zodParams(
      z.object({
        q: z.string().describe("搜索模型 id / 名称 / 描述关键词").optional(),
        modality: z
          .enum(["all", "text", "multimodal"])
          .describe("模态筛选：all | text | multimodal，默认 all")
          .optional(),
        sort: z
          .enum(["context_desc", "context_asc", "name"])
          .describe("排序：context_desc（默认）| context_asc | name")
          .optional(),
        limit: z.number().describe("返回条数上限，默认 30，最大 100").optional(),
        includeFreellm: z
          .boolean()
          .describe("是否附带 freellm 网关通道列表（默认 true；不含明文 key）")
          .optional(),
      }),
    ),
  },
  {
    name: "skill_discover",
    reentrant: true, // 只读：Skill metaJson.stats 扫描
    description:
      "发现值得推广的 Skill（超级 Agent，Hermes）。仅返回已启用且有真实调用统计（executeSkill 回写）的候选，按 usageCount/successRate 排序。",
    parameters: zodParams(
      z.object({
        minSuccessRate: z.number().describe("最低成功率阈值（0-100），默认 80").optional(),
        minUsageCount: z.number().describe("最低调用次数，默认 1（无统计不进榜）").optional(),
        limit: z.number().describe("返回数量上限，默认 10").optional(),
      }),
    ),
  },
  {
    name: "skill_enable",
    description:
      "启用 Skill draft（enabled=false→true，管理 Agent+，Hermes）。默认需人工审批；启用后才会进入 Agent 调度与 skill_discover。",
    parameters: zodParams(
      z.object({
        skillId: z.string().describe("要启用的 Skill id"),
      }),
    ),
  },
  {
    name: "skill_promote",
    description:
      "将已启用的优秀 Skill 加入目标 Agent 工具列表（超级 Agent，Hermes）。默认需人工审批；未启用的 draft 不可推广。",
    parameters: zodParams(
      z.object({
        skillId: z.string().describe("要推广的 Skill id"),
        targetAgentIds: z.array(z.string()).describe("目标 Agent id 列表（将 Skill 加入其工具列表）"),
      }),
    ),
  },
  {
    name: "optimize_agent_prompt",
    description: "自动优化子 Agent 的 system prompt（管理 Agent 专用，Agent 进化高级版）。基于近期运行经验分析成功率与工具使用模式，追加优化建议到 prompt。",
    parameters: zodParams(
      z.object({
        agentId: z.string().describe("目标子 Agent id"),
      }),
    ),
  },
  {
    name: "generate_skill_from_experience",
    description:
      "从 Agent 运行经验中生成 Skill **draft**（管理 Agent+，Hermes）。分析高频工具组合；新建 Skill 默认 enabled=false，需 skill_enable 审批启用后再推广。",
    parameters: zodParams(
      z.object({
        agentId: z.string().describe("分析哪个 Agent 的经验"),
        skillName: z.string().describe("新 Skill 的名称"),
        skillDescription: z.string().describe("新 Skill 的描述"),
      }),
    ),
  },
];

const SWARM_HANDLERS: Record<string, NativeToolHandler> = {
  agent_create: agentCreateTool,
  agent_update: agentUpdateTool,
  agent_delete: agentDeleteTool,
  // *_sub：管理 Agent 工具清单别名，与 update/delete 同实现（出域硬拦在 handler 内）
  agent_update_sub: agentUpdateTool,
  agent_delete_sub: agentDeleteTool,
  agent_inspect: agentInspectTool,
  swarm_brief: swarmBriefTool,
  agent_send_message: agentSendMessageTool,
  agent_report_back: agentReportBackTool,
  agent_create_sub: agentCreateSubTool,
  workspace_create: workspaceCreateTool,
  workspace_archive: workspaceArchiveTool,
  free_api_keys_list: freeApiKeysListTool,
  free_api_keys_fetch: freeApiKeysFetchTool,
  free_models_list: freeModelsListTool,
  skill_discover: skillDiscoverTool,
  skill_enable: skillEnableTool,
  skill_promote: skillPromoteTool,
  optimize_agent_prompt: optimizeAgentPromptTool,
  generate_skill_from_experience: generateSkillFromExperienceTool,
};

export function registerSwarmTools(): void {
  registerNativeDomain(SWARM_DEFS, SWARM_HANDLERS);
}
