/**
 * Native Swarm 域 — agent_* / workspace_* / skill 进化 / 免费 API Key
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
import { provisionWorkspace } from "../../workspaceProvision.js";
import { optimizeAgentPrompt, generateSkillFromExperience } from "../../agentEvolution.js";
import { resolveToolsForAgentTier } from "../../loop/setup.js";
import { buildMemoryContext, buildSystemPromptWithHints } from "../../promptBuilder.js";
import { resolveAgent as defaultResolveAgent } from "../../agentResolver.js";
import { createTrpcInvoker } from "../../trpcInvoker.js";
import { createMemoryRepository } from "../../memoryRepository.js";
import { MEMORY_SCOPE_GLOBAL, memoryAgentScope, LLM_PROVIDER_DEEPSEEK } from "@knowpilot/shared";
import type { LlmMessage } from "../../llmClient.js";
import { z } from "zod";
import { zodParams } from "./zodParams.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

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
  // 管理 Agent / 子 Agent：自动创建主 session
  if ((args.tier === "manager" || args.tier === "sub") && created.data.id) {
    await ctx.services.session.create({
      title: `${args.name} 主会话`,
      model: args.model ? String(args.model) : ctx.config.llm.defaultModel,
      agentId: created.data.id,
      isMainSession: true,
    }).catch(() => { /* 主 session 创建失败不阻塞 */ });
  }
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
  const result = await ctx.services.agent.update({
    id: String(id),
    name: updateData.name ? String(updateData.name) : undefined,
    description: updateData.description ? String(updateData.description) : undefined,
    model: updateData.model ? String(updateData.model) : undefined,
    systemPrompt: updateData.systemPrompt ? String(updateData.systemPrompt) : undefined,
    tools: Array.isArray(updateData.tools) ? (updateData.tools as string[]) : undefined,
    apiKey: updateData.apiKey !== undefined ? String(updateData.apiKey) : undefined,
    heartbeatModel: updateData.heartbeatModel ? String(updateData.heartbeatModel) : undefined,
    heartbeat: updateData.heartbeat as any,
    status: updateData.status as any,
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
  // 超级不能删其他 super（#16）
  if (existing.tier === "super" && ctx.agentSnapshot?.tier === "super" && targetId !== ctx.agentSnapshot.id) {
    // super 删其他 super → 检查目标是不是自己也想删（已在权限层拦截 self delete）
    return { error: "[TIER_PROTECTED] 超级 Agent 不能删除其他超级 Agent。" };
  }
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

async function agentInspectTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const targetId = String(args.id || "");
  // 默认不附带全局 Memory：experience 会污染父 Agent 上下文，导致把「旧任务经验」当成当前结果
  const includeMemory = args.includeMemory === true;
  const agent = await ctx.services.agent.getById(targetId);
  if (!agent) return { error: "Agent 不存在" };
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
    hint: includeMemory
      ? undefined
      : "默认不返回 Memory。需要长期偏好时可传 includeMemory=true（不会返回 experience 任务日志）。请以 agent.id（cuid）为准，勿编造 ID。",
  };
}

/**
 * 防止同一 Agent 被并发触发自动运行。
 * 锁仅覆盖 prepare 段（会话 find-or-create / busy 判定 / dedup / 写消息 / 起流），
 * 不覆盖运行本身——运行期间再次派活走 busy 判定入队（W-E），而不是在锁上干等。
 */
const agentRunLocks = new Map<string, Promise<PrepareAgentRunResult>>();

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
  const existing = agentRunLocks.get(targetAgentId);
  if (existing) await existing;

  const preparePromise = (async (): Promise<PrepareAgentRunResult> => {
    let sessionIdForCleanup: string | undefined;
    try {
      // W4：优先用 ctx 注入的 resolveAgent（见 createAgentToolContext），缺省回退到 agentResolver 叶子模块
      const resolveAgent = ctx.resolveAgent ?? defaultResolveAgent;
      const { agent } = await resolveAgent(ctx.services, targetAgentId);
      if (!agent || agent.status === "deleted") throw new Error("目标 Agent 不存在或已删除");

      let mainSession = await ctx.prisma?.chatSession.findFirst({
        where: { agentId: targetAgentId, isMainSession: true, status: { not: "deleted" } },
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
        // 已有主会话：每次派活都刷新 parentSessionId，保证 report_back 回到「本次 spawn 的父会话」
        const patch: Record<string, unknown> = { status: "running" };
        if (mainSession.kind !== "subagent") patch.kind = "subagent";
        if (ctx.sessionId) patch.parentSessionId = ctx.sessionId;
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
      const hub = getStreamHub();
      let shouldQueue = false;
      if (hub) {
        shouldQueue = hub.isRunning(mainSession.id);
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

      const memoryHint = await buildMemoryContext(ctx.services, input, { agentId: agent.id });
      const tierTools = resolveToolsForAgentTier(agent.tier, agent.tools);
      const systemPrompt = buildSystemPromptWithHints(agent.systemPrompt, tierTools, memoryHint, {
        tier: agent.tier,
        name: agent.name,
      });
      const messages: LlmMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: input }
];
      const invokeTrpc = createTrpcInvoker({ services: ctx.services });
      const agentMeta = {
        id: agent.id,
        model: agent.model,
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
            agent: { model: agent.model, systemPrompt, tools: tierTools },
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

          await ctx.services.message.create({
            sessionId: mainSession!.id,
            role: "assistant",
            content: assistantContent,
            toolCalls: loop.toolCalls as any,
            tokenUsage: loop.tokenUsage,
            source: "sub",
          });

          try {
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
    } finally {
      agentRunLocks.delete(targetAgentId);
    }
  })();

  agentRunLocks.set(targetAgentId, preparePromise);
  return preparePromise;
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
  // 复用 workspaceProvision 编排（与 workspace.create tRPC 路由共享逻辑）
  const result = await provisionWorkspace(ctx.config, ctx.services, {
    name,
    path,
    description: args.description as string | undefined,
    managerModel: args.managerModel as string | undefined,
    managerSystemPrompt: args.managerSystemPrompt as string | undefined,
    operatorAgentId: ctx.agentSnapshot?.id,
    managerParentId: ctx.agentSnapshot?.id,
  });
  if (!result.success) return { error: result.error };
  return {
    success: true,
    workspaceId: result.workspaceId,
    managerAgentId: result.managerAgentId,
    message: `Workspace ${name} 已创建，管理 Agent 已就绪。`,
  };
}

async function workspaceArchiveTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const wsId = String(args.id || "");
  // 归档：Workspace status=archived + 所有 Agent status=dormant
  await ctx.services.workspace.update({ id: wsId, status: "archived" } as any).catch(() => {});
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
  return {
    apiKey: picked.value,
    credentialId: picked.id,
    name: picked.name,
    hint: "使用后请勿持久化此 key，每次需要时重新获取。",
  };
}

// ─── Hermes 进化：Skill 发现与推广（#45）───

async function skillDiscoverTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const minSuccessRate = (args.minSuccessRate as number) ?? 80;
  const limit = (args.limit as number) ?? 10;
  // 查所有启用的 Skill
  const skills = await ctx.prisma.skill.findMany({
    where: { enabled: true },
    select: { id: true, name: true, description: true, icon: true, metaJson: true },
  });
  // 按 Run 表中使用该 skill 的成功率排序
  // Run.toolCalls 中可能包含 skill 调用记录，此处简化：按 skill name 在 Run 中出现次数排序
  // 完整实现需要 Run 表记录 skill 调用明细，此处用 metaJson 中的统计作为近似
  const candidates = skills.map((s) => {
    let stats = { usageCount: 0, successRate: 100 };
    try {
      const meta = JSON.parse(s.metaJson || "{}");
      if (meta.stats) stats = meta.stats;
    } catch { /* ignore */ }
    return { ...s, ...stats };
  }).filter((s) => s.successRate >= minSuccessRate)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, limit);

  return {
    count: candidates.length,
    skills: candidates.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      icon: s.icon,
      usageCount: s.usageCount,
      successRate: s.successRate,
    })),
    hint: "使用 skill_promote 将优秀 Skill 推广到其他 Workspace 的 Agent。",
  };
}

async function skillPromoteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const skillId = String(args.skillId || "");
  const targetAgentIds = Array.isArray(args.targetAgentIds) ? (args.targetAgentIds as string[]) : [];
  if (!skillId || targetAgentIds.length === 0) {
    return { error: "skill_promote 需要 skillId 和 targetAgentIds" };
  }
  // 验证 Skill 存在
  const skill = await ctx.services.skill.getById(skillId);
  if (!skill) return { error: `Skill ${skillId} 不存在` };
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
      // 加入 Skill 到工具列表
      await ctx.services.agent.update({
        id: agentId,
        tools: [...currentTools, skillToolName],
      } as any);
      promoted++;
    } catch (err) {
      errors.push(`Agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 审计日志
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
    ? { success: true, skillId: result.skillId, message: `Skill 已从经验中生成` }
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
    description: "更新 Agent 配置（需超级权限，不能改自己 tier）。运行中的 Agent 用旧配置跑完，下次启动用新配置。",
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
    description: "删除 Agent（需超级权限，不能删自己或其他 super）。先停止运行中任务，再级联删 session/message/memory，留 tombstone。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("目标 Agent id"),
      }),
    ),
  },
  {
    name: "agent_inspect",
    description: "获取任意 Agent 的完整上下文（需超级权限）。包括 session 消息、memory、运行记录。默认管理 Agent 运行过程对超级不可见，此工具用于越级查看。",
    parameters: zodParams(
      z.object({
        id: z.string().describe("目标 Agent id"),
        includeMemory: z.boolean().describe("是否包含 memory（默认 true）").optional(),
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
    description: "向上级 Agent 回报结果（默认工具，所有 Agent 可用）。只能在正式回复中调用（不能在工具调用轮次中）。",
    parameters: zodParams(
      z.object({
        content: z.string().describe("回报内容"),
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
    description: "创建 Workspace（需超级权限）。自动创建该 Workspace 的管理 Agent + 主 session + .knowpilot/ 目录结构。",
    parameters: zodParams(
      z.object({
        name: z.string().describe("Workspace 名称"),
        description: z.string().optional(),
        path: z.string().describe("磁盘目录路径"),
        managerModel: z.string().describe("管理 Agent 的模型").optional(),
        managerSystemPrompt: z.string().describe("管理 Agent 的 system prompt（不填用默认模板）").optional(),
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
    description: "列出可用的免费 API Key（从 Credential 表中 scope=llm 且 metadata.source=free 的记录）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "free_api_keys_fetch",
    description: "获取一个可用的免费 API Key（轮询分配，标记 lastUsedAt）。用于 Agent 无专属 key 时获取临时 key。",
    parameters: zodParams(
      z.object({
        provider: z.string().describe(`偏好提供商（如 ${LLM_PROVIDER_DEEPSEEK}/openai），不填则随机分配`).optional(),
      }),
    ),
  },
  {
    name: "skill_discover",
    description: "发现跨 Workspace 的优秀 Skill（超级 Agent 专用，Hermes 进化 #45）。扫描所有 Skill，按使用频率/成功率排序，返回值得推广的候选。",
    parameters: zodParams(
      z.object({
        minSuccessRate: z.number().describe("最低成功率阈值（0-100），默认 80").optional(),
        limit: z.number().describe("返回数量上限，默认 10").optional(),
      }),
    ),
  },
  {
    name: "skill_promote",
    description: "将一个优秀 Skill 推广到其他 Workspace（超级 Agent 专用，Hermes 进化 #45）。把 Skill 复制到目标 Workspace 的 Agent 工具列表中。",
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
    description: "从 Agent 运行经验中自动生成 Skill（管理 Agent 专用，Agent 进化高级版）。分析高频工具组合，提炼为可复用的 Skill。",
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
  agent_inspect: agentInspectTool,
  agent_send_message: agentSendMessageTool,
  agent_report_back: agentReportBackTool,
  agent_create_sub: agentCreateSubTool,
  workspace_create: workspaceCreateTool,
  workspace_archive: workspaceArchiveTool,
  free_api_keys_list: freeApiKeysListTool,
  free_api_keys_fetch: freeApiKeysFetchTool,
  skill_discover: skillDiscoverTool,
  skill_promote: skillPromoteTool,
  optimize_agent_prompt: optimizeAgentPromptTool,
  generate_skill_from_experience: generateSkillFromExperienceTool,
};

export function registerSwarmTools(): void {
  registerNativeDomain(SWARM_DEFS, SWARM_HANDLERS);
}
