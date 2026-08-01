/**
 * session tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createSessionSchema, updateSessionSchema, listSessionsSchema, stopSessionSchema, rerunSessionSchema,
  resumeSessionSchema, ensureMainSessionSchema, openNewSessionSchema, compactSessionSchema,
  setSessionGoalSchema, sessionGoalControlSchema, listSideRunsSchema, rotateLineageSchema,
  listRecentRotatesSchema, rotateGraphSchema, createSessionQueueItemSchema, reorderSessionQueueItemsSchema,
  switchBranchSchema, sessionTreeSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { TRPCError } from "@trpc/server";
import { getStreamHub } from "../sessionStreamHub.js";
import { createTrpcInvoker } from "../trpcInvoker.js";
import {
  pullAsyncDeliveries,
  pullConsumedAsyncDeliveries,
  markAsyncDeliveryConsumed,
  listRunningAsyncJobs,
  cancelAsyncJob,
  retryAsyncJob,
  getAsyncQueueStats,
  startAsyncAgentTask,
  listQueuedAsyncJobs,
  listSyncAsyncJobs,
} from "../asyncJobManager.js";
import { resolveAgent } from "../agentResolver.js";

const createTrpcInvokerForCtx = createTrpcInvoker;

export const sessionRouter = router({
  create: publicProcedure.meta({ description: "创建聊天会话。", aiReadable: true }).input(createSessionSchema).mutation(({ ctx, input }) => ctx.services.session.create(input)),
  getById: publicProcedure.meta({ description: "获取会话详情（含消息列表）。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.session.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有聊天会话。", aiReadable: true }).input(listSessionsSchema).query(({ ctx, input }) => ctx.services.session.list(input)),
  ensureMain: publicProcedure
    .meta({
      description: "确保 Agent 有一条主会话（空亦可）。Chat 进入无会话态时调用，幂等返回 sessionId。",
      aiReadable: true,
    })
    .input(ensureMainSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.services.agent.getById(input.agentId);
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Agent 不存在: ${input.agentId}` });
      }
      const { ensureMainSession } = await import("../ensureMainSession.js");
      const { session, created } = await ensureMainSession(ctx.prisma, {
        agentId: agent.id,
        title: `${agent.name} 主会话`,
        model: agent.model || ctx.config.llm.defaultModel,
      });
      return {
        id: session.id,
        title: session.title,
        agentId: session.agentId,
        model: session.model,
        created,
      };
    }),
  openNew: publicProcedure
    .meta({
      description:
        "新对话：已有空会话则复用（焦点已在其上则 already_here）；否则新建空会话。",
      aiReadable: true,
    })
    .input(openNewSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.services.agent.getById(input.agentId);
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Agent 不存在: ${input.agentId}` });
      }
      const { openNewSession } = await import("../openNewSession.js");
      const { session, action } = await openNewSession(ctx.prisma, {
        agentId: agent.id,
        focusedSessionId: input.focusedSessionId,
        title: input.title ?? "新对话",
        model: input.model || agent.model || ctx.config.llm.defaultModel,
      });
      return {
        id: session.id,
        title: session.title,
        agentId: session.agentId,
        model: session.model,
        action,
      };
    }),
  exportTrace: publicProcedure
    .meta({
      description: "导出会话消息轨迹为 JSONL，供离线评测。",
      aiReadable: true,
    })
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { exportSessionTraceJsonl } = await import("../runTraceExport.js");
      try {
        return await exportSessionTraceJsonl(ctx.prisma, input.id);
      } catch (err) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  listRunning: publicProcedure
    .meta({ description: "列出当前服务器上正在运行的 Agent 流式会话（用于前端断线/跨标签恢复）。", aiReadable: false })
    .input(z.void().optional())
    .output(z.object({ items: z.array(z.object({ sessionId: z.string(), lastEventId: z.number().int().min(0), runningSince: z.number().int() })) }))
    .query(({ ctx }) => {
      const hub = ctx.streamHub;
      return { items: hub ? hub.listRunning() : [] };
    }),
  listChildren: publicProcedure
    .meta({ description: "列出指定父会话的子代理会话（Subagent）。", aiReadable: true })
    .input(z.object({ parentSessionId: z.string().cuid(), pageSize: z.number().int().min(1).max(100).optional() }))
    .query(({ ctx, input }) =>
      ctx.services.session.list({
        page: 1,
        pageSize: input.pageSize ?? 50,
        parentSessionId: input.parentSessionId,
        kind: "subagent",
      }),
    ),
  rotateLineage: publicProcedure
    .meta({
      description:
        "session_rotate 血缘链派生视图：沿 rotatedFrom/rotatedTo 拉链（只读，非新协议）。",
      aiReadable: true,
    })
    .input(rotateLineageSchema)
    .query(async ({ ctx, input }) => {
      const { getRotateLineage } = await import("../sessionRotateLineage.js");
      const result = await getRotateLineage(ctx.prisma, input.sessionId);
      if (result.nodes.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `会话不存在: ${input.sessionId}` });
      }
      return result;
    }),
  listRecentRotates: publicProcedure
    .meta({
      description: "最近由 session_rotate 产生的会话（看板派生列表）。",
      aiReadable: true,
    })
    .input(listRecentRotatesSchema)
    .query(async ({ ctx, input }) => {
      const { listRecentRotates } = await import("../sessionRotateLineage.js");
      return { items: await listRecentRotates(ctx.prisma, input.limit) };
    }),
  rotateGraph: publicProcedure
    .meta({
      description:
        "session_rotate 全图派生：nodes/edges/chains 均只读 rotatedFrom/rotatedTo，供管理页血缘链与图。",
      aiReadable: true,
    })
    .input(rotateGraphSchema)
    .query(async ({ ctx, input }) => {
      const { getRotateGraph } = await import("../sessionRotateLineage.js");
      return getRotateGraph(ctx.prisma, input.limit);
    }),
  listSideRuns: publicProcedure
    .meta({
      description: "列出父会话下的旁路复盘会话（kind=skill_review），供 Chat 运行栏展示。",
      aiReadable: true,
    })
    .input(listSideRunsSchema)
    .query(async ({ ctx, input }) => {
      const { listSkillReviewSideRuns } = await import("../skillBackgroundReview.js");
      return listSkillReviewSideRuns(ctx.services, input.parentSessionId, input.pageSize);
    }),
  setGoal: publicProcedure
    .meta({ description: "设定会话 Goal 或 Deep Research，可选立刻起第一轮。", aiReadable: true })
    .input(setSessionGoalSchema)
    .mutation(async ({ ctx, input }) => {
      const { setSessionGoal, buildGoalKickoffMessage } = await import("../goalLoop.js");
      const goal = await setSessionGoal({
        services: ctx.services,
        config: ctx.config,
        sessionId: input.sessionId,
        text: input.text,
        mode: input.mode,
        maxTurns: input.maxTurns,
        judgeModel: input.judgeModel,
        execModel: input.execModel,
      });
      let streamStarted = false;
      if (input.startNow) {
        const hub = getStreamHub();
        if (hub) {
          const body = {
            sessionId: input.sessionId,
            message: buildGoalKickoffMessage(goal),
            model: goal.execModel,
            source: "system" as const,
          };
          const session = await ctx.services.session.getByIdLite(input.sessionId);
          const fullBody = {
            ...body,
            agentId: session.agentId ?? undefined,
            model: goal.execModel || session.model,
          };
          const invoke = createTrpcInvoker({
            services: ctx.services,
            config: ctx.config,
            prisma: ctx.prisma,
          });
          streamStarted =
            (await hub.startIfNotRunning(input.sessionId, fullBody, (emit, signal) =>
              import("../agentStream.js").then(({ chatAgentStream }) =>
                chatAgentStream(ctx.services, ctx.config, fullBody, invoke, emit, signal),
              ),
            )) === "started";
        }
      }
      return { goal, streamStarted };
    }),
  pauseGoal: publicProcedure
    .meta({ description: "暂停会话 Goal 自动续跑。", aiReadable: true })
    .input(sessionGoalControlSchema)
    .mutation(async ({ ctx, input }) => {
      const { pauseSessionGoal } = await import("../goalLoop.js");
      const goal = await pauseSessionGoal(ctx.services, input.sessionId);
      return { goal };
    }),
  resumeGoal: publicProcedure
    .meta({ description: "恢复会话 Goal（重置 turnsUsed）。", aiReadable: true })
    .input(sessionGoalControlSchema)
    .mutation(async ({ ctx, input }) => {
      const { resumeSessionGoal, buildGoalContinueMessage } = await import("../goalLoop.js");
      const goal = await resumeSessionGoal(ctx.services, input.sessionId);
      if (!goal) return { goal: null, streamStarted: false };
      const hub = getStreamHub();
      let streamStarted = false;
      if (hub) {
        const session = await ctx.services.session.getByIdLite(input.sessionId);
        const message = buildGoalContinueMessage(goal, "Resumed by user.");
        const body = {
          sessionId: input.sessionId,
          agentId: session.agentId ?? undefined,
          message,
          model: goal.execModel || session.model,
          source: "system" as const,
        };
        const invoke = createTrpcInvoker({
          services: ctx.services,
          config: ctx.config,
          prisma: ctx.prisma,
        });
        streamStarted =
          (await hub.startIfNotRunning(input.sessionId, body, (emit, signal) =>
            import("../agentStream.js").then(({ chatAgentStream }) =>
              chatAgentStream(ctx.services, ctx.config, body, invoke, emit, signal),
            ),
          )) === "started";
      }
      return { goal, streamStarted };
    }),
  clearGoal: publicProcedure
    .meta({ description: "清除会话 Goal / Deep Research。", aiReadable: true })
    .input(sessionGoalControlSchema)
    .mutation(async ({ ctx, input }) => {
      const { clearSessionGoal } = await import("../goalLoop.js");
      await clearSessionGoal(ctx.services, input.sessionId);
      return { ok: true as const };
    }),
  getGoal: publicProcedure
    .meta({ description: "读取会话当前 Goal 状态。", aiReadable: true })
    .input(sessionGoalControlSchema)
    .query(async ({ input }) => {
      const { readGoalStateRaw } = await import("../goalLoop.js");
      const { getSessionTokenAttribution } = await import("../llmBudget.js");
      const goal = await readGoalStateRaw(input.sessionId);
      const tokens = getSessionTokenAttribution(input.sessionId);
      return { goal, tokens };
    }),
  update: publicProcedure.meta({ description: "更新会话标题或系统提示。", aiReadable: true }).input(updateSessionSchema).mutation(({ ctx, input }) => ctx.services.session.update(input)),
  compact: publicProcedure
    .meta({ description: "手动压缩会话上下文：生成摘要、写入 contextSummary 并落库边界消息。", aiReadable: true })
    .input(compactSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.services.session.getByIdLite(input.id);
      const { runSessionCompact } = await import("../autoCompact.js");
      const result = await runSessionCompact({
        config: ctx.config,
        services: ctx.services,
        sessionId: input.id,
        model: session.model || ctx.config.llm.defaultModel,
        systemPrompt: session.systemPrompt || "你是 KnowPilot 助手。",
        existingSummary: session.contextSummary,
        existingGeneration: (session as { compactGeneration?: number }).compactGeneration ?? 0,
        trigger: "manual",
      });
      if (!result.compacted) {
        return { success: true as const, compacted: false, message: result.message };
      }
      return {
        success: true as const,
        compacted: true,
        summaryPreview: result.summaryPreview,
        boundaryMessageId: result.boundaryMessageId,
        message: result.message,
      };
    }),
  stop: publicProcedure
    .meta({ description: "停止子代理会话（状态置为 paused 并真正 abort 运行中后台任务）。", aiReadable: false })
    .input(stopSessionSchema)
    .mutation(async ({ ctx, input }) => {
      // A4：stop 只需 kind/status，用轻量 getByIdLite 避免拉 500 条消息
      const session = await ctx.services.session.getByIdLite(input.id);
      if (session.kind === "subagent") {
        const { stopSubagentSession } = await import("../asyncJobManager.js");
        const result = stopSubagentSession(session.id, ctx.config);
        // 排队中任务被移出队列后 orchestrator 不会触发 catch，需手动回写 Task 为 interrupted
        if (result.stopped && !result.wasRunning && result.jobId) {
          try {
            await ctx.services.task.update({
              id: result.jobId,
              status: "interrupted",
              finishedAt: new Date(),
              delivered: true,
              deliveredAt: new Date(),
              output: {
                error: "异步任务已中断（用户停止）",
                deliveryExempt: true,
              },
            } as any);
          } catch (err) {
            console.warn(`[session.stop] 回写排队任务 ${result.jobId} 为 interrupted 失败:`, err);
          }
        }
        // 运行中任务的 session 状态由 buildAsyncExecute catch 统一回写为 paused（用户停止），
        // 此处仅对排队/未命中任务显式置 paused，避免与 catch 的 paused 写入竞争
        if (!result.wasRunning) {
          return ctx.services.session.update({ id: input.id, status: "paused" });
        }
        // 运行中：catch 会把 session 置 paused；这里不重复写，避免覆盖
        return ctx.services.session.getByIdLite(input.id);
      }
      // 普通 chat：hub.stop 归 active；禁止只改 DB 导致「DB 已停但流仍在跑」
      try {
        const { getStreamHub } = await import("../sessionStreamHub.js");
        getStreamHub()?.stop(session.id, "user");
      } catch {
        /* hub 未初始化 */
      }
      return ctx.services.session.update({ id: input.id, status: "active" });
    }),
  // 保留 API：重启僵尸 paused 可程序化续跑；Chat UI 已去掉「恢复运行」，用户直接发消息即可
  resume: publicProcedure
    .meta({ description: "手动恢复已暂停（paused）会话：续跑服务端重启前未完成的 ReAct 轮。幂等——并发/重复调用不报错、不重复起流。", aiReadable: false })
    .input(resumeSessionSchema)
    .mutation(({ ctx, input }) => ctx.services.session.resume(input)),
  // W1：会话树分支切换（更新 activeLeafId；旁路可生成 branch_summary）
  switchBranch: publicProcedure
    .meta({ description: "切换会话树当前叶（游标）。切到当前叶幂等；若放弃旁路有新内容则生成 branch_summary。", aiReadable: false })
    .input(switchBranchSchema)
    .mutation(async ({ ctx, input }) => {
      const { switchBranch } = await import("../chatTree.js");
      return switchBranch(ctx.prisma, ctx.config, input);
    }),
  tree: publicProcedure
    .meta({ description: "返回会话消息树邻接表（nodes + children），供 UI 渲染分支指示。", aiReadable: false })
    .input(sessionTreeSchema)
    .query(async ({ ctx, input }) => {
      const { getSessionTree } = await import("../chatTree.js");
      return getSessionTree(ctx.prisma, input.sessionId);
    }),
  spawn: publicProcedure
    .meta({ description: "创建并启动子代理任务（subagent）。返回 subagentSessionId 与 jobId。", aiReadable: false })
    .input(
      z.object({
        parentSessionId: z.string().cuid(),
        agentId: z.string().cuid().optional(),
        task: z.string().min(1).max(2000),
        label: z.string().max(120).optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { agent } = await resolveAgent(ctx.services, input.agentId);
      const model = input.model || agent.model;
      const started = await startAsyncAgentTask({
        sessionId: input.parentSessionId,
        task: input.task,
        label: input.label,
        config: ctx.config,
        services: ctx.services,
        agent: { id: agent.id, model, systemPrompt: agent.systemPrompt, tools: agent.tools },
        source: "session.spawn",
        isSubagent: true,
      });
      return {
        subagentSessionId: started.subagentSessionId,
        jobId: started.jobId,
        status: started.status,
        message: started.message,
      };
    }),
  rerun: publicProcedure
    .meta({ description: "基于原子代理会话重跑：创建新 subagent 并启动后台任务。", aiReadable: false })
    .input(rerunSessionSchema)
    .mutation(async ({ ctx, input }) => {
      // A4：rerun 只需 parentSessionId/agentId/model/taskDescription，用轻量查询
      const original = await ctx.services.session.getByIdLite(input.id);
      if (!original) throw new Error("原子代理会话不存在");
      const orig = original as { parentSessionId?: string | null; agentId?: string | null; model?: string; taskDescription?: string | null };
      if (!orig.parentSessionId) throw new Error("该会话不是子代理，无法重跑");
      const { agent } = await resolveAgent(ctx.services, orig.agentId ?? undefined);
      const task = input.taskDescription ?? orig.taskDescription ?? "重跑任务";
      const started = await startAsyncAgentTask({
        sessionId: orig.parentSessionId,
        task,
        label: `${orig.model ?? agent.model} 重跑`,
        config: ctx.config,
        services: ctx.services,
        agent: { id: agent.id, model: orig.model ?? agent.model, systemPrompt: agent.systemPrompt, tools: agent.tools },
        source: "session.rerun",
        isSubagent: true,
      });
      return {
        subagentSessionId: started.subagentSessionId,
        jobId: started.jobId,
        status: started.status,
        message: started.message,
      };
    }),
  delete: publicProcedure.meta({ description: "删除会话及其所有消息（级联删除）。", aiReadable: false }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.session.delete(input.id)),
  // #11 批量删除：多选会话一次删除
  bulkDelete: publicProcedure
    .meta({ description: "批量删除多个会话及其消息。", aiReadable: false })
    .input(z.object({ ids: z.array(z.string().cuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      let deleted = 0;
      const errors: string[] = [];
      for (const id of input.ids) {
        try {
          await ctx.services.session.delete(id);
          deleted++;
        } catch (err) {
          errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return { deleted, errors: errors.length > 0 ? errors : undefined };
    }),
});
