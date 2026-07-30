/**
 * KnowPilot 根路由合集与编译出口 (Root Router)
 *
 * 【扁平化 + 按需叶子拆分】：
 * 1. 本文件聚合业务子路由与 AI 工具反射；低耦合域可拆至 infra/trpcRouters/。
 * 2. 禁止平行 trpc/routers/ 树与兼容 re-export；AppRouter 仍从此文件出口。
 */

import { z } from "zod";
import { router, publicProcedure } from "./trpc/trpc.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { success, failure } from "./trpc/result.js";
import {
  createPostSchema, updatePostSchema, listPostsSchema, searchPostsSchema, relatedPostsSchema, createPostFromChatSchema, getPostBySlugSchema, postGardenSchema, postRecordViewSchema, explainSelectionSchema,
  createAgentSchema, updateAgentSchema, listAgentsSchema, agentRunSchema, agentChatSchema, submitAgentInjectSchema, editorAgentCompleteSchema, editorFormulaCopilotSchema,
  createSessionSchema, updateSessionSchema, listSessionsSchema, stopSessionSchema, rerunSessionSchema, resumeSessionSchema, ensureMainSessionSchema, openNewSessionSchema, compactSessionSchema,
  setSessionGoalSchema, sessionGoalControlSchema, listSideRunsSchema, rotateLineageSchema, listRecentRotatesSchema, rotateGraphSchema,
  createSessionQueueItemSchema, reorderSessionQueueItemsSchema,
  switchBranchSchema, sessionTreeSchema,
  deleteByIdSchema, deleteByIdWithApprovalSchema,
  runTaskSchema, executeApprovalSchema, approveAndExecuteApprovalSchema,
  runWorkflowSchema,
} from "@knowpilot/shared";
import { listConfiguredLlmProviders } from "./infra/config.js";
import { getStreamHub } from "./infra/sessionStreamHub.js";
import { listNativeTools, executeNativeTool } from "./infra/nativeTools.js";
import { runAgent, chatAgent } from "./infra/agentRuntime.js";
import { summarizeAgentTools } from "./infra/agentTools.js";
import { getLlmBudgetStatus } from "./infra/llmBudget.js";
import { createTrpcInvoker } from "./infra/trpcInvoker.js";
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
} from "./infra/asyncJobManager.js";
import { resolveAgent, getAssistantDriftStatus } from "./infra/agentResolver.js";
import {
  getFreellmGatewayRuntime,
  getOpenRouterFreeModelCatalog,
  getOpenRouterFreeSyncedAt,
  filterOpenRouterFreeModels,
  loadOpenRouterFreeCatalogFromDisk,
} from "./infra/freeLlmRuntime.js";
import { listFreellmChannels, syncFreeKeys } from "./infra/freeKeysSync.js";
import { listLocalLlmBackends } from "./infra/localLlmCatalog.js";

import { extractTextFromImage, getOcrStatus, probeOcrPython } from "./infra/ocrService.js";
import { gardenRouter } from "./infra/trpcRouters/gardenRouter.js";
import { logRouter } from "./infra/trpcRouters/logRouter.js";
import { toolRouter } from "./infra/trpcRouters/toolRouter.js";
import { promptRouter } from "./infra/trpcRouters/promptRouter.js";
import { skillRouter } from "./infra/trpcRouters/skillRouter.js";
import { mcpRouter } from "./infra/trpcRouters/mcpRouter.js";
import { memoryRouter } from "./infra/trpcRouters/memoryRouter.js";
import { fileRouter } from "./infra/trpcRouters/fileRouter.js";
import { infoSourceRouter } from "./infra/trpcRouters/infoSourceRouter.js";
import { inboxRouter } from "./infra/trpcRouters/inboxRouter.js";
import { channelRouter } from "./infra/trpcRouters/channelRouter.js";
import { messageRouter } from "./infra/trpcRouters/messageRouter.js";
import { gitRouter } from "./infra/trpcRouters/gitRouter.js";
import { searchRouter } from "./infra/trpcRouters/searchRouter.js";
import { analyticsRouter } from "./infra/trpcRouters/analyticsRouter.js";
import { aboutRouter } from "./infra/trpcRouters/aboutRouter.js";
import { authRouter } from "./infra/trpcRouters/authRouter.js";
import { nativeRouter } from "./infra/trpcRouters/nativeRouter.js";
import { taskRouter } from "./infra/trpcRouters/taskRouter.js";
import { workspaceRouter } from "./infra/trpcRouters/workspaceRouter.js";
import { triggerRouter } from "./infra/trpcRouters/triggerRouter.js";
import { agentCronRouter } from "./infra/trpcRouters/agentCronRouter.js";
import { approvalRouter } from "./infra/trpcRouters/approvalRouter.js";
import { askUserRouter } from "./infra/trpcRouters/askUserRouter.js";
import { runRouter } from "./infra/trpcRouters/runRouter.js";
import { credentialRouter } from "./infra/trpcRouters/credentialRouter.js";
import { TRPCError } from "@trpc/server";

/* ─── 19 个业务子路由定义 ─── */

const createTrpcInvokerForCtx = createTrpcInvoker;

import { withApprovalGuard } from "./infra/trpcRouters/withApprovalGuard.js";

const postRouter = router({
  list: publicProcedure.meta({ description: "分页列出文章；可按花园 garden id /分类/标签/关键词过滤。", aiReadable: true }).input(listPostsSchema).query(({ ctx, input }) => ctx.services.post.list(input)),
  tree: publicProcedure.meta({ description: "获取已发布文章的 garden/slug/title 列表（可选花园过滤）。", aiReadable: true }).input(z.object({ garden: postGardenSchema.optional() }).default({})).query(({ ctx, input }) => ctx.services.post.tree(input.garden)),
  getBySlug: publicProcedure.meta({ description: "按花园 + slug 获取文章详情（不增加浏览量；阅读计数用 recordView）。", aiReadable: true }).input(getPostBySlugSchema).query(({ ctx, input }) => ctx.services.post.getBySlug(input.slug, input.garden)),
  recordView: publicProcedure.meta({ description: "记录一次文章阅读（viewCount+1）。", aiReadable: false }).input(postRecordViewSchema).mutation(({ ctx, input }) => ctx.services.post.recordView(input.id)),
  preview: publicProcedure.meta({ description: "文章内链 hover 预览（标题/摘要/正文前段），不增加浏览量。", aiReadable: true }).input(getPostBySlugSchema).query(({ ctx, input }) => ctx.services.post.preview(input.slug, input.garden)),
  getById: publicProcedure.meta({ description: "按 id 获取文章，用于编辑器加载。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.post.getById(input.id)),
  create: publicProcedure.meta({ description: "创建新文章到已存在的花园（garden），同步到 content/{garden}/{slug}.md。", aiReadable: true }).input(createPostSchema).mutation(({ ctx, input }) => ctx.services.post.create(input)),
  update: publicProcedure.meta({ description: "更新文章内容，自动同步到本地 Markdown 文件。", aiReadable: true }).input(updatePostSchema).mutation(({ ctx, input }) => ctx.services.post.update(input)),
  delete: publicProcedure.meta({ description: "删除文章到回收站。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "post.delete", { id: input.id }, input.approvalId, () => ctx.services.post.delete(input.id)),
  ),
  restore: publicProcedure.meta({ description: "从回收站恢复文章。", aiReadable: true }).input(deleteByIdSchema).mutation(({ ctx, input }) => ctx.services.post.restore(input.id)),
  // 软删铁律：永久删除仅人类 UI；aiReadable=false 禁止 Agent 经 invoke 反射触达
  permanentDelete: publicProcedure.meta({ description: "从回收站永久删除文章（仅人类 UI）。", aiReadable: false }).input(deleteByIdSchema).mutation(({ ctx, input }) => ctx.services.post.permanentDelete(input.id)),
  listDeleted: publicProcedure.meta({ description: "列出回收站中的文章。", aiReadable: true }).query(({ ctx }) => ctx.services.post.listDeleted()),
  search: publicProcedure.meta({ description: "搜索文章标题和内容（可选花园过滤）。", aiReadable: true }).input(searchPostsSchema).query(({ ctx, input }) => ctx.services.post.search(input.query, input.limit, input.garden)),
  related: publicProcedure
    .meta({
      description: "相关笔记：FTS + 标签交集 + 同花园/同分类加权，排除自身。",
      aiReadable: true,
    })
    .input(relatedPostsSchema)
    .query(({ ctx, input }) => ctx.services.post.related(input)),
  createFromChat: publicProcedure
    .meta({
      description: "把 Chat 消息落库为文章（create/update/append）；正文以服务端 message 为准。",
      aiReadable: false,
    })
    .input(createPostFromChatSchema)
    .mutation(({ ctx, input }) => ctx.services.post.createFromChat(input)),
  categories: publicProcedure.meta({ description: "获取所有已发布文章的分类列表。", aiReadable: true }).query(({ ctx }) => ctx.services.post.categories()),
  tags: publicProcedure.meta({ description: "获取所有已发布文章的标签列表。", aiReadable: true }).query(({ ctx }) => ctx.services.post.tags()),
  explainSelection: publicProcedure
    .meta({
      description: "阅读页划线解释：对用户划选原文做一次 LLM 解释（不建会话、不写回文章）。",
      aiReadable: false,
    })
    .input(explainSelectionSchema)
    .mutation(async ({ input }) => {
      const { explainPostSelection } = await import("./infra/postExplain.js");
      return explainPostSelection(input);
    }),
});

const agentRouter = router({
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
      const { completeEditorWithAgent } = await import("./infra/editorAgentComplete.js");
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
      const { completeFormulaCopilot } = await import("./infra/editorAgentComplete.js");
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
      const { getSwarmHealthSnapshot } = await import("./infra/swarmHealth.js");
      return getSwarmHealthSnapshot(ctx.prisma, input.agentId);
    }),
  swarmAlerts: publicProcedure
    .meta({
      description:
        "全仓 Swarm 轻量告警（ask_user 积压 / 心跳熔断 / inbox 偏高）；供 /agents 列表顶栏。",
      aiReadable: true,
    })
    .query(async ({ ctx }) => {
      const { getSwarmAlertsOverview } = await import("./infra/swarmHealth.js");
      return getSwarmAlertsOverview(ctx.prisma);
    }),
  getLoopContract: publicProcedure
    .meta({ description: "读取超级 Agent 心跳 Loop Contract（控制平面只读）。", aiReadable: true })
    .input(z.object({ agentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { getHeartbeatEngine } = await import("./infra/heartbeatEngine.js");
      const engine = getHeartbeatEngine(ctx.prisma, ctx.services, ctx.config);
      const contract = await engine.getLoopContract(input.agentId);
      return contract;
    }),
  resumeLoopContract: publicProcedure
    .meta({ description: "人工恢复超级 Agent Loop Contract（开 gate + handoff）。", aiReadable: false })
    .input(z.object({ agentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const { getHeartbeatEngine } = await import("./infra/heartbeatEngine.js");
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
      const { getHeartbeatEngine } = await import("./infra/heartbeatEngine.js");
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
      const { getHeartbeatEngine } = await import("./infra/heartbeatEngine.js");
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
    .meta({ description: "取消运行中或排队中的后台异步任务。", aiReadable: false })
    .input(z.object({ jobId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => cancelAsyncJob(input.jobId, ctx.config, ctx.services)),
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
      const { getSwarmBus } = await import("./infra/swarmBus.js");
      const bus = getSwarmBus(ctx.prisma, ctx.services);
      return bus.poll(input.agentId);
    }),
  markAgentMessageConsumed: publicProcedure
    .meta({ description: "标记 Agent 间消息已消费。", aiReadable: false })
    .input(z.object({ messageId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const { getSwarmBus } = await import("./infra/swarmBus.js");
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

const sessionRouter = router({
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
      const { ensureMainSession } = await import("./infra/ensureMainSession.js");
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
      const { openNewSession } = await import("./infra/openNewSession.js");
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
      const { exportSessionTraceJsonl } = await import("./infra/runTraceExport.js");
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
      const { getRotateLineage } = await import("./infra/sessionRotateLineage.js");
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
      const { listRecentRotates } = await import("./infra/sessionRotateLineage.js");
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
      const { getRotateGraph } = await import("./infra/sessionRotateLineage.js");
      return getRotateGraph(ctx.prisma, input.limit);
    }),
  listSideRuns: publicProcedure
    .meta({
      description: "列出父会话下的旁路复盘会话（kind=skill_review），供 Chat 运行栏展示。",
      aiReadable: true,
    })
    .input(listSideRunsSchema)
    .query(async ({ ctx, input }) => {
      const { listSkillReviewSideRuns } = await import("./infra/skillBackgroundReview.js");
      return listSkillReviewSideRuns(ctx.services, input.parentSessionId, input.pageSize);
    }),
  setGoal: publicProcedure
    .meta({ description: "设定会话 Goal 或 Deep Research，可选立刻起第一轮。", aiReadable: true })
    .input(setSessionGoalSchema)
    .mutation(async ({ ctx, input }) => {
      const { setSessionGoal, buildGoalKickoffMessage } = await import("./infra/goalLoop.js");
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
              import("./infra/agentStream.js").then(({ chatAgentStream }) =>
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
      const { pauseSessionGoal } = await import("./infra/goalLoop.js");
      const goal = await pauseSessionGoal(ctx.services, input.sessionId);
      return { goal };
    }),
  resumeGoal: publicProcedure
    .meta({ description: "恢复会话 Goal（重置 turnsUsed）。", aiReadable: true })
    .input(sessionGoalControlSchema)
    .mutation(async ({ ctx, input }) => {
      const { resumeSessionGoal, buildGoalContinueMessage } = await import("./infra/goalLoop.js");
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
            import("./infra/agentStream.js").then(({ chatAgentStream }) =>
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
      const { clearSessionGoal } = await import("./infra/goalLoop.js");
      await clearSessionGoal(ctx.services, input.sessionId);
      return { ok: true as const };
    }),
  getGoal: publicProcedure
    .meta({ description: "读取会话当前 Goal 状态。", aiReadable: true })
    .input(sessionGoalControlSchema)
    .query(async ({ input }) => {
      const { readGoalStateRaw } = await import("./infra/goalLoop.js");
      const { getSessionTokenAttribution } = await import("./infra/llmBudget.js");
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
      const { runSessionCompact } = await import("./infra/autoCompact.js");
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
        const { stopSubagentSession } = await import("./infra/asyncJobManager.js");
        const result = stopSubagentSession(session.id, ctx.config);
        // 排队中任务被移出队列后 orchestrator 不会触发 catch，需手动回写 Task 为 cancelled，
        // 否则 DB 中 Task.status 永远停留在 running
        if (result.stopped && !result.wasRunning && result.jobId) {
          try {
            await ctx.services.task.update({
              id: result.jobId,
              status: "failed",
              output: { error: "异步任务已取消（用户停止）" },
            } as any);
          } catch (err) {
            console.warn(`[session.stop] 回写排队任务 ${result.jobId} 为 cancelled 失败:`, err);
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
        const { getStreamHub } = await import("./infra/sessionStreamHub.js");
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
      const { switchBranch } = await import("./infra/chatTree.js");
      return switchBranch(ctx.prisma, ctx.config, input);
    }),
  tree: publicProcedure
    .meta({ description: "返回会话消息树邻接表（nodes + children），供 UI 渲染分支指示。", aiReadable: false })
    .input(sessionTreeSchema)
    .query(async ({ ctx, input }) => {
      const { getSessionTree } = await import("./infra/chatTree.js");
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

const aiRouter = router({
  tools: publicProcedure
    .meta({ description: "动态获取系统中所有注册的 API 工具及其 JSON Schema 参数说明。", aiReadable: true })
    .query(async () => {
      const { appRouter } = await import("./router.js");
      const toolsList: any[] = [];
      const procedures = appRouter._def.procedures;
      for (const [path, proc] of Object.entries(procedures)) {
        if (path.startsWith("ai.")) continue;
        const def = (proc as any)._def;
        if (!def) continue;
        const meta = def.meta || {};
        if (meta.aiReadable === false) continue;
        const inputs = def.inputs || [];
        const inputValidator = inputs[0];
        let parameters: any = { type: "object", properties: {} };
        if (inputValidator && typeof inputValidator.parse === "function") {
          try { parameters = zodToJsonSchema(inputValidator); } catch (e: any) {
            parameters = { type: "object", description: `参数定义转换异常: ${e.message}` };
          }
        }
        toolsList.push({ name: path, description: meta.description || `执行系统操作 ${path}`, parameters });
      }
      for (const tool of listNativeTools()) {
        toolsList.push({
          name: `native.${tool.name}`,
          description: `[原生工具] ${tool.description}`,
          parameters: tool.parameters,
        });
      }
      return toolsList;
    }),

  invoke: publicProcedure
    .meta({ description: "动态反射调用指定的后端工具，支持 AI 自主执行操作。", aiReadable: true })
    .input(z.object({ tool: z.string().min(1, "必须指定工具名称"), args: z.any().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { tool, args } = input;
      const start = Date.now();
      try {
        const { appRouter } = await import("./router.js");
        const procedures = appRouter._def.procedures as any;
        if (!procedures[tool]) {
          return failure({
            code: "AI_TOOL_NOT_FOUND",
            message: `调用失败：找不到名称为 "${tool}" 的工具。`,
            suggestion: "请调用 ai.tools 获取可用工具并核对拼写。",
            retryable: false,
            operation: "invoke",
            entity: "ai",
            durationMs: Date.now() - start,
          });
        }
        // 软删铁律等：aiReadable:false 的 procedure 对 Agent 反射不可达（不仅从 ai.tools 隐藏）
        const procMeta = (procedures[tool] as { _def?: { meta?: { aiReadable?: boolean } } })?._def?.meta;
        if (procMeta?.aiReadable === false) {
          return failure({
            code: "AI_TOOL_FORBIDDEN",
            message: `调用失败：工具 "${tool}" 不对 Agent 开放（aiReadable=false）。`,
            suggestion: "删除请用 post.delete / file_delete / directory_delete / garden.delete（软删）；永久删除仅人类 UI。",
            retryable: false,
            operation: "invoke",
            entity: "ai",
            durationMs: Date.now() - start,
          });
        }
        const caller = appRouter.createCaller(ctx);
        const parts = tool.split(".");
        if (parts[0] === "native" && parts.length === 2) {
          const result = await executeNativeTool(parts[1], (args as Record<string, unknown>) || {}, {
            config: ctx.config,
            services: ctx.services,
            invokeTrpc: createTrpcInvokerForCtx(ctx),
          });
          return success({ data: result, operation: "invoke", entity: "ai", durationMs: Date.now() - start });
        }
        let method = caller as any;
        for (const part of parts) {
          if (!method || method[part] === undefined) throw new Error(`无法解析调用链路: ${tool}`);
          method = method[part];
        }
        if (typeof method !== "function") throw new Error(`解析出的对象不是可执行的函数`);
        const result = await method(args);
        return success({ data: result, operation: "invoke", entity: "ai", durationMs: Date.now() - start });
      } catch (error: any) {
        return failure({
          code: "AI_CALL_EXECUTION_ERROR",
          message: `工具 "${tool}" 执行时抛出异常：${error.message}`,
          details: { originalError: String(error) },
          suggestion: "请检查调用参数是否完整，或者联系管理员排查后台服务。",
          retryable: false,
          operation: "invoke",
          entity: "ai",
          durationMs: Date.now() - start,
        });
      }
    }),
});

const llmRouter = router({
  freeModelsStatus: publicProcedure
    .meta({ description: "免费模型同步状态（OpenRouter :free + freellm 网关）。", aiReadable: false })
    .query(async ({ ctx }) => {
      if (!getOpenRouterFreeModelCatalog()) {
        loadOpenRouterFreeCatalogFromDisk(ctx.config.projectRoot);
      }
      const catalog = getOpenRouterFreeModelCatalog();
      const channels = await listFreellmChannels(ctx.prisma);
      const runtime = getFreellmGatewayRuntime();
      return {
        openRouter: {
          hasApiKey: !!ctx.config.llm.providers.openrouter?.apiKey?.trim(),
          syncedAt: getOpenRouterFreeSyncedAt(),
          count: catalog?.models.length ?? 0,
        },
        freellm: {
          runtimeModel: runtime?.model ?? null,
          runtimeBaseUrl: runtime?.baseUrl ?? null,
          credentialCount: channels.length,
        },
      };
    }),

  listFreeModels: publicProcedure
    .meta({ description: "列出 OpenRouter :free 模型目录（含上下文/定价/模态）。", aiReadable: false })
    .input(
      z
        .object({
          q: z.string().optional(),
          modality: z.enum(["text", "multimodal", "all"]).default("all"),
          sort: z.enum(["context_desc", "context_asc", "name"]).default("context_desc"),
        })
        .default({}),
    )
    .query(({ ctx, input }) => {
      if (!getOpenRouterFreeModelCatalog()) {
        loadOpenRouterFreeCatalogFromDisk(ctx.config.projectRoot);
      }
      const items = filterOpenRouterFreeModels({
        q: input.q,
        modality: input.modality,
        sort: input.sort,
      });
      return {
        syncedAt: getOpenRouterFreeSyncedAt(),
        hasApiKey: !!ctx.config.llm.providers.openrouter?.apiKey?.trim(),
        total: items.length,
        items,
      };
    }),

  listFreellmChannels: publicProcedure
    .meta({ description: "列出已探活的 freellm 网关通道（不含明文 key）。", aiReadable: false })
    .query(async ({ ctx }) => {
      const items = await listFreellmChannels(ctx.prisma);
      const runtime = getFreellmGatewayRuntime();
      return {
        runtimeModel: runtime?.model ?? null,
        runtimeBaseUrl: runtime?.baseUrl ?? null,
        total: items.length,
        items,
      };
    }),

  refreshFreeModels: publicProcedure
    .meta({ description: "立即同步 freellm key + OpenRouter :free 目录。", aiReadable: false })
    .mutation(async ({ ctx }) => {
      const result = await syncFreeKeys(ctx.prisma, ctx.config);
      return { success: true as const, ...result };
    }),

  listLocalModels: publicProcedure
    .meta({
      description:
        "探测本机 OpenAI 兼容后端（Ollama / llama.cpp / LM Studio / vLLM）并列出已加载模型。会话模型 id 形如 ollama/llama3.2。",
      aiReadable: false,
    })
    .input(
      z
        .object({
          providers: z
            .array(z.enum(["ollama", "llamacpp", "lmstudio", "vllm"]))
            .optional(),
          timeoutMs: z.number().int().min(500).max(15_000).default(2500),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const result = await listLocalLlmBackends(ctx.config, {
        timeoutMs: input.timeoutMs,
        providers: input.providers,
      });
      return {
        ...result,
        modelIdHint: "选中后会话 model 为 {provider}/{upstreamName}，如 ollama/qwen2.5:7b",
      };
    }),
});

/* ─── DeadLetter（邮件回复死信审计）─── */

const deadLetterRouter = router({
  list: publicProcedure
    .meta({ description: "列出邮件回复死信（未匹配 pending 的邮件回复，审计用）。", aiReadable: true })
    .input(z.object({ status: z.enum(["pending", "reviewed", "all"]).default("all"), limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const where = input?.status === "all" ? {} : { status: input?.status ?? "all" };
      const items = await ctx.prisma.deadLetterMail.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
      });
      return { items, total: items.length };
    }),
  review: publicProcedure
    .meta({ description: "标记死信为已审阅。", aiReadable: false })
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.deadLetterMail.updateMany({
        where: { id: input.id, status: "pending" },
        data: { status: "reviewed", reviewedAt: new Date() },
      });
      return { success: true };
    }),
  clear: publicProcedure
    .meta({ description: "清空已审阅的死信（pending 保留）。", aiReadable: false })
    .mutation(async ({ ctx }) => {
      const result = await ctx.prisma.deadLetterMail.deleteMany({ where: { status: "reviewed" } });
      return { success: true, deleted: result.count };
    }),
});

/* ─── 编译出口 ─── */

export const appRouter = router({
  garden: gardenRouter,
  post: postRouter,
  agent: agentRouter,
  skill: skillRouter,
  session: sessionRouter,
  message: messageRouter,
  file: fileRouter,
  log: logRouter,
  mcp: mcpRouter,
  memory: memoryRouter,
  infoSource: infoSourceRouter,
  inbox: inboxRouter,
  channel: channelRouter,
  git: gitRouter,
  search: searchRouter,
  analytics: analyticsRouter,
  about: aboutRouter,
  auth: authRouter,
  native: nativeRouter,
  task: taskRouter,
  workspace: workspaceRouter,
  trigger: triggerRouter,
  agentCron: agentCronRouter,
  approval: approvalRouter,
  askUser: askUserRouter,
  tool: toolRouter,
  run: runRouter,
  prompt: promptRouter,
  credential: credentialRouter,
  llm: llmRouter,
  ai: aiRouter,
  deadLetter: deadLetterRouter,
});

export type AppRouter = typeof appRouter;
