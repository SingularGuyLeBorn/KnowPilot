/**
 * agent tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createAgentSchema, updateAgentSchema, listAgentsSchema, agentRunSchema, agentChatSchema,
  submitAgentInjectSchema, editorAgentCompleteSchema, editorFormulaCopilotSchema,
  deleteByIdWithApprovalSchema, runWorkflowSchema,
  createSessionQueueItemSchema, reorderSessionQueueItemsSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { TRPCError } from "@trpc/server";
import { success, failure } from "../../trpc/result.js";
import { listConfiguredLlmProviders } from "../config.js";
import { getStreamHub } from "../sessionStreamHub.js";
import { runAgent, chatAgent } from "../agentRuntime.js";
import { summarizeAgentTools } from "../agentTools.js";
import { createTrpcInvoker } from "../trpcInvoker.js";
import { resolveAgent, getAssistantDriftStatus } from "../agentResolver.js";
import { getLlmBudgetStatus } from "../llmBudget.js";
import { extractTextFromImage, getOcrStatus, probeOcrPython } from "../ocrService.js";
import {
  pullAsyncDeliveries,
  pullConsumedAsyncDeliveries,
  markAsyncDeliveryConsumed,
  listRunningAsyncJobs,
  cancelAsyncJob,
  resumeAsyncJob,
  retryAsyncJob,
  getAsyncQueueStats,
  listQueuedAsyncJobs,
  listSyncAsyncJobs,
} from "../asyncJobManager.js";
import { withApprovalGuard } from "./withApprovalGuard.js";

const createTrpcInvokerForCtx = createTrpcInvoker;

export const agentRouter = router({
  create: publicProcedure.meta({ description: "创建一个新的 AI Agent。name 必须唯一。", aiReadable: true }).input(createAgentSchema).mutation(({ ctx, input }) => ctx.services.agent.create(input)),
  getById: publicProcedure.meta({ description: "获取 Agent 详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.agent.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有 Agent，支持分页和关键词搜索。", aiReadable: true }).input(listAgentsSchema).query(({ ctx, input }) => ctx.services.agent.list(input)),
  editorComplete: publicProcedure
    .meta({
      description: "编辑器 @Agent 补全：注入 Agent systemPrompt，一次生成 Markdown 片段（不建会话、不跑工具）。",
      aiReadable: false,
    })
    .input(editorAgentCompleteSchema)
    .mutation(async ({ ctx, input }) => {
      const { completeEditorWithAgent } = await import("../editorAgentComplete.js");
      return completeEditorWithAgent(ctx.services, input);
    }),
  formulaCopilot: publicProcedure
    .meta({
      description:
        "公式块 Copilot：抽取前后文（约 10 行）后用默认 assistant 直接补全 LaTeX（不建会话、不跑工具）；前端 Tab 接受。",
      aiReadable: false,
    })
    .input(editorFormulaCopilotSchema)
    .mutation(async ({ ctx, input }) => {
      const { completeFormulaCopilot } = await import("../editorAgentComplete.js");
      return completeFormulaCopilot(ctx.services, input);
    }),
  update: publicProcedure.meta({ description: "更新 Agent 配置。", aiReadable: true }).input(updateAgentSchema).mutation(({ ctx, input }) => ctx.services.agent.update(input)),
  delete: publicProcedure.meta({ description: "删除 Agent 及其本地配置文件。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "agent.delete", { id: input.id }, input.approvalId, () => ctx.services.agent.delete(input.id)),
  ),
  bulkDelete: publicProcedure
    .meta({ description: "批量删除多个 Agent 及其本地配置文件。", aiReadable: false })
    .input(z.object({ ids: z.array(z.string().cuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      // A6：改用 AgentService.bulkDelete 单次 deleteMany + 批量文件/FTS 清理
      const res = await ctx.services.agent.bulkDelete(input.ids);
      return { deleted: res.deleted, errors: res.errors.length > 0 ? res.errors : undefined };
    }),
  llmProviders: publicProcedure
    .meta({ description: "列出已配置 API Key 的 LLM 厂商。", aiReadable: true })
    .query(() => listConfiguredLlmProviders()),
  run: publicProcedure
    .meta({ description: "运行 Agent 推理循环（含工具调用）。", aiReadable: true })
    .input(agentRunSchema)
    .mutation(({ ctx, input }) => runAgent(ctx.services, ctx.config, input, createTrpcInvokerForCtx(ctx))),
  chat: publicProcedure
    .meta({ description: "Agent 聊天：持久化会话并自动调用工具（Chat 是 Agent 子集）。", aiReadable: true })
    .input(agentChatSchema)
    .mutation(({ ctx, input }) => chatAgent(ctx.services, ctx.config, input, createTrpcInvokerForCtx(ctx))),
  submitInject: publicProcedure
    .meta({
      description:
        "运行中补充用户消息：写入发送队列（kind=user），当前流结束后由 Inbox drain。不再走 steer/follow_up。",
      aiReadable: false,
    })
    .input(submitAgentInjectSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.services.sessionQueueItem.create({
        sessionId: input.sessionId,
        kind: "user",
        content: input.content.trim(),
        source: "user",
      });
      if (!created.success || !created.data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: created.error?.message ?? "入队失败",
        });
      }
      return success({
        data: { id: created.data.id, kind: "user" as const, queued: true },
        operation: "create",
        entity: "sessionQueueItem",
      });
    }),
  driftStatus: publicProcedure
    .meta({
      description:
        "检测默认 assistant 相对内置默认配置的漂移（W9 只读，不创建不修改）；供 /agents 管理页横幅展示，含一次性迁移脚本提示。",
      aiReadable: true,
    })
    .query(({ ctx }) => getAssistantDriftStatus(ctx.services)),
  swarmHealth: publicProcedure
    .meta({
      description:
        "只读 Swarm 健康快照（inbox/会话态/ask_user pending/心跳熔断/superior 队列）；与 agent_inspect(includeSwarm) 同源。",
      aiReadable: true,
    })
    .input(z.object({ agentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { getSwarmHealthSnapshot } = await import("../swarmHealth.js");
      return getSwarmHealthSnapshot(ctx.prisma, input.agentId);
    }),
  swarmAlerts: publicProcedure
    .meta({
      description:
        "全仓 Swarm 轻量告警（ask_user 积压 / 心跳熔断 / inbox 偏高）；供 /agents 列表顶栏。",
      aiReadable: true,
    })
    .query(async ({ ctx }) => {
      const { getSwarmAlertsOverview } = await import("../swarmHealth.js");
      return getSwarmAlertsOverview(ctx.prisma);
    }),
  getLoopContract: publicProcedure
    .meta({ description: "读取超级 Agent 心跳 Loop Contract（控制平面只读）。", aiReadable: true })
    .input(z.object({ agentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { getHeartbeatEngine } = await import("../heartbeatEngine.js");
      const engine = getHeartbeatEngine(ctx.prisma, ctx.services, ctx.config);
      const contract = await engine.getLoopContract(input.agentId);
      return contract;
    }),
  resumeLoopContract: publicProcedure
    .meta({ description: "人工恢复超级 Agent Loop Contract（开 gate + handoff）。", aiReadable: false })
    .input(z.object({ agentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const { getHeartbeatEngine } = await import("../heartbeatEngine.js");
      const engine = getHeartbeatEngine(ctx.prisma, ctx.services, ctx.config);
      try {
        return await engine.resumeLoopContract(input.agentId);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  closeLoopGate: publicProcedure
    .meta({ description: "人工关闭超级 Agent Loop Contract gate（停心跳触发）。", aiReadable: false })
    .input(z.object({ agentId: z.string().cuid(), reason: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { getHeartbeatEngine } = await import("../heartbeatEngine.js");
      const engine = getHeartbeatEngine(ctx.prisma, ctx.services, ctx.config);
      try {
        return await engine.closeLoopGate(input.agentId, input.reason);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  resumeHeartbeat: publicProcedure
    .meta({
      description: "手动恢复熔断暂停的 Agent 心跳（清零连续失败计数并重挂 cron）。",
      aiReadable: false,
    })
    .input(z.object({ agentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const { getHeartbeatEngine } = await import("../heartbeatEngine.js");
      const engine = getHeartbeatEngine(ctx.prisma, ctx.services, ctx.config);
      return engine.resumeHeartbeat(input.agentId);
    }),
  toolSummary: publicProcedure
    .meta({ description: "解析 Agent tools 授权并统计 LLM 可见工具规模。", aiReadable: true })
    .input(z.object({ tools: z.array(z.string()) }))
    .query(({ ctx, input }) => summarizeAgentTools(ctx.services, input.tools)),
  llmBudgetStatus: publicProcedure
    .meta({ description: "获取今日 LLM 美元预算消耗状态。", aiReadable: true })
    .query(({ ctx }) => getLlmBudgetStatus(ctx.config)),
  pullAsyncQueue: publicProcedure
    .meta({ description: "拉取会话内后台异步任务队列（结果 + 运行中 + 排队中 + 已消费 + 同步任务（deliverToQueue=false，只展示））。", aiReadable: false })
    .input(z.object({ sessionId: z.string().cuid() }))
    .query(async ({ input, ctx }) => ({
      deliveries: await pullAsyncDeliveries(input.sessionId),
      running: await listRunningAsyncJobs(input.sessionId),
      queued: await listQueuedAsyncJobs(input.sessionId, ctx.config),
      consumed: await pullConsumedAsyncDeliveries(input.sessionId),
      syncTasks: await listSyncAsyncJobs(input.sessionId, ctx.config),
    })),
  cancelAsyncJob: publicProcedure
    .meta({
      description: "中断本会话创建的后台异步任务（running/queued→interrupted）。须传 sessionId 做归属校验。",
      aiReadable: false,
    })
    .input(z.object({ jobId: z.string().cuid(), sessionId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) =>
      cancelAsyncJob(input.jobId, ctx.config, ctx.services, {
        ownerSessionId: input.sessionId,
      }),
    ),
  resumeAsyncJob: publicProcedure
    .meta({
      description: "恢复本会话已中断的异步任务（interrupted→queued/running，同 jobId）。须传 sessionId。",
      aiReadable: false,
    })
    .input(z.object({ jobId: z.string().cuid(), sessionId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) =>
      resumeAsyncJob(input.jobId, ctx.config, ctx.services, {
        ownerSessionId: input.sessionId,
      }),
    ),
  retryAsyncJob: publicProcedure
    .meta({ description: "重试一条失败的异步任务。", aiReadable: false })
    .input(z.object({ jobId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => retryAsyncJob(input.jobId, ctx.config, ctx.services)),
  asyncQueueStats: publicProcedure
    .meta({ description: "获取异步任务队列实时统计。", aiReadable: false })
    .query(({ ctx }) => getAsyncQueueStats(ctx.config)),
  toggleAsyncJobPinned: publicProcedure
    .meta({ description: "切换异步任务的 pinned 状态。pinned 的结果不被自动消费。", aiReadable: false })
    .input(z.object({ jobId: z.string().cuid(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.task.update({
        where: { id: input.jobId },
        data: { pinned: input.pinned },
      });
      return { success: true };
    }),
  ackAsyncDelivery: publicProcedure
    .meta({ description: "确认异步结果已消费（标记 delivered）。返回 claimed：是否抢到 CLAIM（与服务端自动消费竞态）。", aiReadable: false })
    .input(z.object({ jobId: z.string().cuid() }))
    .mutation(async ({ input }) => {
      const claimed = await markAsyncDeliveryConsumed(input.jobId);
      return { success: true, claimed };
    }),
  listSessionQueueItems: publicProcedure
    .meta({ description: "列出指定会话的发送队列项（user + superior 合并）。", aiReadable: false })
    .input(z.object({ sessionId: z.string().cuid() }))
    .query(({ ctx, input }) => ctx.services.sessionQueueItem.listBySession(input.sessionId)),
  createSessionQueueItem: publicProcedure
    .meta({ description: "创建一条会话发送队列项。", aiReadable: false })
    .input(createSessionQueueItemSchema)
    .mutation(({ ctx, input }) => ctx.services.sessionQueueItem.create(input)),
  consumeSessionQueueItem: publicProcedure
    .meta({
      description:
        "软认领一条会话发送队列项（置 claimedAt，不删行）。返回 claimed：是否抢到认领（前端 drain 与服务端 superior drain 竞态，落选 false 静默跳过）。ChatMessage 落地后须再调 finalizeSessionQueueItem。",
      aiReadable: false,
    })
    .input(z.object({ id: z.string().cuid() }))
    .mutation(({ ctx, input }) => ctx.services.sessionQueueItem.consume(input.id)),
  finalizeSessionQueueItem: publicProcedure
    .meta({
      description:
        "确认队列项内容已写入 ChatMessage：删除行并标记关联 AgentMessage consumed。须在 consume 软认领成功且消息落地之后调用。",
      aiReadable: false,
    })
    .input(z.object({ id: z.string().cuid() }))
    .mutation(({ ctx, input }) => ctx.services.sessionQueueItem.finalize(input.id)),
  unclaimSessionQueueItem: publicProcedure
    .meta({
      description:
        "回滚软认领（claimedAt→null）。起流 begin 被拒 / 409 SESSION_BUSY 时由前端调用，避免 tombstone+认领后待发蒸发。",
      aiReadable: false,
    })
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.services.sessionQueueItem.unclaim(input.id);
      return success({ data: { unclaimed: ok }, operation: "update", entity: "sessionQueueItem" });
    }),
  reorderSessionQueueItems: publicProcedure
    .meta({ description: "批量重排会话发送队列项顺序。", aiReadable: false })
    .input(reorderSessionQueueItemsSchema)
    .mutation(({ ctx, input }) => ctx.services.sessionQueueItem.reorder(input.sessionId, input.orderedIds)),
  deleteSessionQueueItem: publicProcedure
    .meta({ description: "删除一条会话发送队列项（用户手动移除，不消费）。", aiReadable: false })
    .input(z.object({ id: z.string().cuid() }))
    .mutation(({ ctx, input }) => ctx.services.sessionQueueItem.delete(input.id)),
  // Swarm：Agent 间消息轮询
  pullAgentMessages: publicProcedure
    .meta({ description: "拉取发给指定 Agent 的待投递消息（Swarm 通信）。", aiReadable: false })
    .input(z.object({ agentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { getSwarmBus } = await import("../swarmBus.js");
      const bus = getSwarmBus(ctx.prisma, ctx.services);
      return bus.poll(input.agentId);
    }),
  markAgentMessageConsumed: publicProcedure
    .meta({ description: "标记 Agent 间消息已消费。", aiReadable: false })
    .input(z.object({ messageId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const { getSwarmBus } = await import("../swarmBus.js");
      const bus = getSwarmBus(ctx.prisma, ctx.services);
      await bus.markConsumed(input.messageId);
      return { success: true };
    }),
  ocrStatus: publicProcedure
    .meta({ description: "OCR 环境诊断（模型、Python、是否可用）。", aiReadable: false })
    .query(async ({ ctx }) => {
      const status = getOcrStatus(ctx.config);
      const probe = await probeOcrPython(ctx.config);
      const modelsReady = status.models.det && status.models.rec;
      return success({
        data: {
          ...status,
          probe,
          modelsReady,
          ready: status.paddleCli && modelsReady && probe.paddleImportOk,
        },
        operation: "ocr",
        entity: "agent",
      });
    }),
  ocrImage: publicProcedure
    .meta({ description: "从图片提取文字（非多模态模型 OCR / 多模态识图）。", aiReadable: false })
    .input(
      z.object({
        base64: z.string().min(1),
        mimeType: z.string().default("image/png"),
        visionModelId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await extractTextFromImage(ctx.config, {
          base64: input.base64,
          mimeType: input.mimeType,
          visionModelId: input.visionModelId,
        });
        return success({ data: result, operation: "ocr", entity: "agent" });
      } catch (err: unknown) {
        return failure({
          code: "OCR_FAILED",
          message: err instanceof Error ? err.message : String(err),
          suggestion: "运行 pnpm ocr:check 诊断；或配置 OCR_SPACE_API_KEY 作为云端降级。",
          retryable: true,
          operation: "ocr",
          entity: "agent",
        });
      }
    }),
  runWorkflow: publicProcedure
    .meta({ description: "按步骤顺序执行 Agent 工作流；遇到 humanApproval 步骤时暂停并创建审批。", aiReadable: true })
    .input(runWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      const invoke = createTrpcInvokerForCtx(ctx);
      const stepResults: unknown[] = [];

      for (let i = 0; i < input.steps.length; i++) {
        const step = input.steps[i];
        if (step.action === "humanApproval") {
          const created = await ctx.services.approval.create({
            toolName: "workflow.step",
            args: { workflowName: input.name, stepIndex: i, step },
            status: "pending",
          });
          return success({
            data: {
              paused: true,
              approvalId: created.data ? (created.data as { id: string }).id : undefined,
              completedSteps: stepResults,
            },
            operation: "runWorkflow",
            entity: "agent",
          });
        }
        const result = await invoke(step.action, step.input ?? {});
        stepResults.push({ action: step.action, result });
      }

      return success({
        data: { paused: false, steps: stepResults },
        operation: "runWorkflow",
        entity: "agent",
      });
    }),
});
