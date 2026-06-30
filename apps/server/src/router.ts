/**
 * KnowPilot 根路由合集与编译出口 (Root Router)
 *
 * 【扁平化单文件设计】：
 * 1. 包含 18 个实体路由和 1 个 AI 工具反射路由的全部 API Procedures。
 * 2. 彻底删除 trpc/routers/ 子目录，减少开发时的文件切换开销。
 */

import { z } from "zod";
import { router, publicProcedure, internalProcedure } from "./trpc/trpc.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { success, failure } from "./trpc/result.js";
import {
  createPostSchema, updatePostSchema, listPostsSchema, searchPostsSchema,
  createAgentSchema, updateAgentSchema, listAgentsSchema, agentRunSchema, agentChatSchema,
  createSkillSchema, updateSkillSchema, listSkillsSchema,
  createMcpServerSchema, updateMcpServerSchema, listMcpServersSchema,
  createMemorySchema, updateMemorySchema, listMemoriesSchema,
  createSessionSchema, updateSessionSchema, listSessionsSchema,
  createMessageSchema, updateMessageSchema, listMessagesSchema, switchMessageVersionSchema,
  createFileSchema, updateFileSchema, listFilesSchema, uploadFileSchema,
  createLogSchema, updateLogSchema, listLogsSchema,
  createGitRepoSchema, updateGitRepoSchema, listGitReposSchema, gitRepoPathSchema, gitLogSchema, gitDiffSchema, gitCommitSchema,
  createTaskSchema, updateTaskSchema, listTasksSchema,
  createWorkspaceSchema, updateWorkspaceSchema, listWorkspacesSchema,
  createTriggerSchema, updateTriggerSchema, listTriggersSchema,
  createApprovalSchema, updateApprovalSchema, listApprovalsSchema,
  createToolSchema, updateToolSchema, listToolsSchema,
  createRunSchema, updateRunSchema, listRunsSchema,
  createPromptSchema, updatePromptSchema, listPromptsSchema,
  createInfoSourceSchema, updateInfoSourceSchema, listInfoSourcesSchema,
  createCredentialSchema, updateCredentialSchema, listCredentialsSchema,
  webSearchSchema, nativeExecuteSchema,
  deleteByIdWithApprovalSchema, gitPushWithApprovalSchema,
  runTaskSchema, executeApprovalSchema, approveAndExecuteApprovalSchema,
  runWorkflowSchema, globalSearchSchema, analyticsDashboardSchema,
  authLoginSchema,
} from "@knowpilot/shared";
import { listConfiguredLlmProviders } from "./infra/config.js";
import { listNativeTools, executeNativeTool } from "./infra/nativeTools.js";
import { getEnrichedServerCapabilities } from "./infra/capabilities.js";
import { runAgent, chatAgent } from "./infra/agentRuntime.js";
import { switchAssistantMessageVersion } from "./infra/agentStream.js";
import { summarizeAgentTools } from "./infra/agentTools.js";
import { getLlmBudgetStatus } from "./infra/llmBudget.js";
import { createTrpcInvoker } from "./infra/trpcInvoker.js";
import { assertApprovalOrProceed, executeApprovedOperation } from "./infra/approvalGate.js";
import { runGlobalSearch } from "./infra/globalSearch.js";
import { getAnalyticsDashboard } from "./infra/analytics.js";
import { loadAboutProfile } from "./infra/aboutProfile.js";
import { pullAsyncDeliveries, listRunningAsyncJobs, cancelAsyncJob, retryAsyncJob } from "./infra/asyncJobManager.js";
import { extractTextFromImage, getOcrStatus, probeOcrPython } from "./infra/ocrService.js";
import {
  getRemoteAccessInfo,
  isAuthEnabled,
  loginWithPassword,
  verifyAuthHeader,
} from "./infra/auth.js";
import type { ServiceContainer } from "./infra/serviceContainer.js";
import { TRPCError } from "@trpc/server";

/* ─── 19 个业务子路由定义 ─── */

const createTrpcInvokerForCtx = createTrpcInvoker;

async function withApprovalGuard(
  services: ServiceContainer,
  toolName: string,
  args: Record<string, unknown>,
  approvalId: string | undefined,
  execute: () => Promise<unknown>,
) {
  await assertApprovalOrProceed(services, toolName, args, approvalId);
  return execute();
}

const postRouter = router({
  list: publicProcedure.meta({ description: "分页列出文章，支持分类/标签/关键词过滤。", aiReadable: true }).input(listPostsSchema).query(({ ctx, input }) => ctx.services.post.list(input)),
  tree: publicProcedure.meta({ description: "获取所有已发布文章的 slug/title 列表。", aiReadable: true }).query(({ ctx }) => ctx.services.post.tree()),
  getBySlug: publicProcedure.meta({ description: "按 slug 获取文章详情，同时增加浏览量。", aiReadable: true }).input(z.object({ slug: z.string() })).query(({ ctx, input }) => ctx.services.post.getBySlug(input.slug)),
  getById: publicProcedure.meta({ description: "按 id 获取文章，用于编辑器加载。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.post.getById(input.id)),
  create: publicProcedure.meta({ description: "创建新文章，自动同步到本地 Markdown 文件。", aiReadable: true }).input(createPostSchema).mutation(({ ctx, input }) => ctx.services.post.create(input)),
  update: publicProcedure.meta({ description: "更新文章内容，自动同步到本地 Markdown 文件。", aiReadable: true }).input(updatePostSchema).mutation(({ ctx, input }) => ctx.services.post.update(input)),
  delete: publicProcedure.meta({ description: "删除文章，同时删除本地 Markdown 文件。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "post.delete", { id: input.id }, input.approvalId, () => ctx.services.post.delete(input.id)),
  ),
  search: publicProcedure.meta({ description: "搜索文章标题和内容。", aiReadable: true }).input(searchPostsSchema).query(({ ctx, input }) => ctx.services.post.search(input.query, input.limit)),
  categories: publicProcedure.meta({ description: "获取所有已发布文章的分类列表。", aiReadable: true }).query(({ ctx }) => ctx.services.post.categories()),
  tags: publicProcedure.meta({ description: "获取所有已发布文章的标签列表。", aiReadable: true }).query(({ ctx }) => ctx.services.post.tags()),
});

const agentRouter = router({
  create: publicProcedure.meta({ description: "创建一个新的 AI Agent。name 必须唯一。", aiReadable: true }).input(createAgentSchema).mutation(({ ctx, input }) => ctx.services.agent.create(input)),
  getById: publicProcedure.meta({ description: "获取 Agent 详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.agent.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有 Agent，支持分页和关键词搜索。", aiReadable: true }).input(listAgentsSchema).query(({ ctx, input }) => ctx.services.agent.list(input)),
  update: publicProcedure.meta({ description: "更新 Agent 配置。", aiReadable: true }).input(updateAgentSchema).mutation(({ ctx, input }) => ctx.services.agent.update(input)),
  delete: publicProcedure.meta({ description: "删除 Agent 及其本地配置文件。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "agent.delete", { id: input.id }, input.approvalId, () => ctx.services.agent.delete(input.id)),
  ),
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
  toolSummary: publicProcedure
    .meta({ description: "解析 Agent tools 授权并统计 LLM 可见工具规模。", aiReadable: true })
    .input(z.object({ tools: z.array(z.string()) }))
    .query(({ ctx, input }) => summarizeAgentTools(ctx.services, input.tools)),
  llmBudgetStatus: publicProcedure
    .meta({ description: "获取今日 LLM 美元预算消耗状态。", aiReadable: true })
    .query(({ ctx }) => getLlmBudgetStatus(ctx.config)),
  pullAsyncQueue: publicProcedure
    .meta({ description: "拉取会话内已完成的后台异步任务结果（供 Chat 队列消费）。", aiReadable: false })
    .input(z.object({ sessionId: z.string().cuid() }))
    .query(async ({ input }) => ({
      deliveries: await pullAsyncDeliveries(input.sessionId),
      running: await listRunningAsyncJobs(input.sessionId),
    })),
  cancelAsyncJob: publicProcedure
    .meta({ description: "取消运行中或排队中的后台异步任务。", aiReadable: false })
    .input(z.object({ jobId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => cancelAsyncJob(input.jobId, ctx.config)),
  retryAsyncJob: publicProcedure
    .meta({ description: "重试一条失败的异步任务。", aiReadable: false })
    .input(z.object({ jobId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => retryAsyncJob(input.jobId, ctx.config, ctx.services)),
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
        chatSupportsVision: z.boolean().default(false),
        visionModelId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await extractTextFromImage(ctx.config, {
          base64: input.base64,
          mimeType: input.mimeType,
          chatSupportsVision: input.chatSupportsVision,
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

const skillRouter = router({
  create: publicProcedure.meta({ description: "创建技能。name 必须唯一。", aiReadable: true }).input(createSkillSchema).mutation(({ ctx, input }) => ctx.services.skill.create(input)),
  getById: publicProcedure.meta({ description: "获取技能详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.skill.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有技能，支持分页和过滤。", aiReadable: true }).input(listSkillsSchema).query(({ ctx, input }) => ctx.services.skill.list(input)),
  update: publicProcedure.meta({ description: "更新技能配置。", aiReadable: true }).input(updateSkillSchema).mutation(({ ctx, input }) => ctx.services.skill.update(input)),
  delete: publicProcedure.meta({ description: "删除技能及其本地配置文件。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "skill.delete", { id: input.id }, input.approvalId, () => ctx.services.skill.delete(input.id)),
  ),
});

const mcpRouter = router({
  create: publicProcedure.meta({ description: "注册 MCP 服务器配置。name 必须唯一。", aiReadable: true }).input(createMcpServerSchema).mutation(({ ctx, input }) => ctx.services.mcp.create(input)),
  getById: publicProcedure.meta({ description: "获取 MCP 服务器详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.mcp.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有 MCP 服务器配置。", aiReadable: true }).input(listMcpServersSchema).query(({ ctx, input }) => ctx.services.mcp.list(input)),
  update: publicProcedure.meta({ description: "更新 MCP 服务器配置。", aiReadable: true }).input(updateMcpServerSchema).mutation(({ ctx, input }) => ctx.services.mcp.update(input)),
  delete: publicProcedure.meta({ description: "删除 MCP 服务器配置及本地 JSON 文件。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "mcp.delete", { id: input.id }, input.approvalId, () => ctx.services.mcp.delete(input.id)),
  ),
});

const memoryRouter = router({
  create: publicProcedure.meta({ description: "创建长期记忆条目。", aiReadable: true }).input(createMemorySchema).mutation(({ ctx, input }) => ctx.services.memory.create(input)),
  getById: publicProcedure.meta({ description: "获取记忆详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.memory.getById(input.id)),
  list: publicProcedure.meta({ description: "列出记忆，支持按 type/keyword 过滤。", aiReadable: true }).input(listMemoriesSchema).query(({ ctx, input }) => ctx.services.memory.list(input)),
  update: publicProcedure.meta({ description: "更新记忆条目。", aiReadable: true }).input(updateMemorySchema).mutation(({ ctx, input }) => ctx.services.memory.update(input)),
  delete: publicProcedure.meta({ description: "删除记忆条目。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.memory.delete(input.id)),
});

const infoSourceRouter = router({
  create: publicProcedure.meta({ description: "创建信息源（可信信息来源配置）。", aiReadable: true }).input(createInfoSourceSchema).mutation(({ ctx, input }) => ctx.services.infoSource.create(input)),
  getById: publicProcedure.meta({ description: "获取信息源详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.infoSource.getById(input.id)),
  list: publicProcedure.meta({ description: "列出信息源，支持类型/标签/可信度筛选。", aiReadable: true }).input(listInfoSourcesSchema).query(({ ctx, input }) => ctx.services.infoSource.list(input)),
  update: publicProcedure.meta({ description: "更新信息源配置。", aiReadable: true }).input(updateInfoSourceSchema).mutation(({ ctx, input }) => ctx.services.infoSource.update(input)),
  delete: publicProcedure.meta({ description: "删除信息源。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.infoSource.delete(input.id)),
});

const sessionRouter = router({
  create: publicProcedure.meta({ description: "创建聊天会话。", aiReadable: true }).input(createSessionSchema).mutation(({ ctx, input }) => ctx.services.session.create(input)),
  getById: publicProcedure.meta({ description: "获取会话详情（含消息列表）。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.session.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有聊天会话。", aiReadable: true }).input(listSessionsSchema).query(({ ctx, input }) => ctx.services.session.list(input)),
  update: publicProcedure.meta({ description: "更新会话标题或系统提示。", aiReadable: true }).input(updateSessionSchema).mutation(({ ctx, input }) => ctx.services.session.update(input)),
  delete: publicProcedure.meta({ description: "删除会话及其所有消息（级联删除）。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.session.delete(input.id)),
});

const messageRouter = router({
  create: publicProcedure.meta({ description: "发送聊天消息（用户或助手）。", aiReadable: true }).input(createMessageSchema).mutation(({ ctx, input }) => ctx.services.message.create(input)),
  getById: publicProcedure.meta({ description: "获取单条消息详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.message.getById(input.id)),
  list: publicProcedure.meta({ description: "分页获取某会话的消息列表。", aiReadable: true }).input(listMessagesSchema).query(({ ctx, input }) => ctx.services.message.list(input)),
  update: publicProcedure.meta({ description: "更新消息内容。", aiReadable: true }).input(updateMessageSchema).mutation(({ ctx, input }) => ctx.services.message.update(input)),
  delete: publicProcedure.meta({ description: "删除单条消息。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.message.delete(input.id)),
  switchVersion: publicProcedure
    .meta({ description: "切换 assistant 消息的多版本回答。", aiReadable: true })
    .input(switchMessageVersionSchema)
    .mutation(({ ctx, input }) => switchAssistantMessageVersion(ctx.services, input.messageId, input.versionIndex)),
});

const fileRouter = router({
  upload: publicProcedure.meta({ description: "通过 base64 编码数据上传文件，返回上传后的文件记录和相对 URL。", aiReadable: true }).input(uploadFileSchema).mutation(({ ctx, input }) => ctx.services.file.upload(input)),
  create: publicProcedure.meta({ description: "创建文件元数据记录。", aiReadable: true }).input(createFileSchema).mutation(({ ctx, input }) => ctx.services.file.create(input)),
  getById: publicProcedure.meta({ description: "获取文件元数据。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.file.getById(input.id)),
  list: publicProcedure.meta({ description: "列出上传的文件。", aiReadable: true }).input(listFilesSchema).query(({ ctx, input }) => ctx.services.file.list(input)),
  update: publicProcedure.meta({ description: "更新文件名称。", aiReadable: true }).input(updateFileSchema).mutation(({ ctx, input }) => ctx.services.file.update(input)),
  delete: publicProcedure.meta({ description: "删除文件记录。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "file.delete", { id: input.id }, input.approvalId, () => ctx.services.file.delete(input.id)),
  ),
});

const logRouter = router({
  create: internalProcedure.meta({ description: "创建日志记录。", aiReadable: true }).input(createLogSchema).mutation(({ ctx, input }) => ctx.services.log.create(input)),
  getById: internalProcedure.meta({ description: "获取日志详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.log.getById(input.id)),
  list: internalProcedure.meta({ description: "分页列出日志，支持按 level/component/keyword 过滤。", aiReadable: true }).input(listLogsSchema).query(({ ctx, input }) => ctx.services.log.list(input)),
  update: internalProcedure.meta({ description: "更新日志（一般不建议）。", aiReadable: false }).input(updateLogSchema).mutation(({ ctx, input }) => ctx.services.log.update(input)),
  delete: internalProcedure.meta({ description: "删除单条日志。", aiReadable: false }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.log.delete(input.id)),
  clearAll: internalProcedure.meta({ description: "一键清空日志审计库。", aiReadable: true }).mutation(({ ctx }) => ctx.services.log.clearAll()),
});

const gitRouter = router({
  create: publicProcedure.meta({ description: "注册 Git 仓库。path 必须唯一。", aiReadable: true }).input(createGitRepoSchema).mutation(({ ctx, input }) => ctx.services.git.create(input)),
  getById: publicProcedure.meta({ description: "获取 Git 仓库详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.git.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有已注册的 Git 仓库。", aiReadable: true }).input(listGitReposSchema).query(({ ctx, input }) => ctx.services.git.list(input)),
  update: publicProcedure.meta({ description: "更新 Git 仓库配置。", aiReadable: true }).input(updateGitRepoSchema).mutation(({ ctx, input }) => ctx.services.git.update(input)),
  delete: publicProcedure.meta({ description: "删除 Git 仓库注册记录。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.git.delete(input.id)),
  status: publicProcedure.meta({ description: "查看 Git 工作区状态。", aiReadable: true }).input(gitRepoPathSchema).query(({ ctx, input }) => ctx.services.git.status(input)),
  log: publicProcedure.meta({ description: "查看 Git 提交历史。", aiReadable: true }).input(gitLogSchema).query(({ ctx, input }) => ctx.services.git.log(input)),
  diff: publicProcedure.meta({ description: "查看 Git diff。", aiReadable: true }).input(gitDiffSchema).query(({ ctx, input }) => ctx.services.git.diff(input)),
  commit: publicProcedure.meta({ description: "Git add -A 并提交。", aiReadable: true }).input(gitCommitSchema).mutation(({ ctx, input }) => ctx.services.git.commit(input)),
  pull: publicProcedure.meta({ description: "Git pull。", aiReadable: true }).input(gitRepoPathSchema).mutation(({ ctx, input }) => ctx.services.git.pull(input)),
  push: publicProcedure.meta({ description: "Git push。", aiReadable: true }).input(gitPushWithApprovalSchema).mutation(({ ctx, input }) => {
    const { approvalId, ...gitArgs } = input;
    return withApprovalGuard(ctx.services, "git.push", gitArgs as Record<string, unknown>, approvalId, () => ctx.services.git.push(gitArgs));
  }),
});

const searchRouter = router({
  web: publicProcedure
    .meta({ description: "联网搜索（Tavily / SerpAPI）。", aiReadable: true })
    .input(webSearchSchema)
    .query(({ ctx, input }) =>
      executeNativeTool("web_search", { query: input.query, maxResults: input.maxResults }, {
        config: ctx.config,
        services: ctx.services,
        invokeTrpc: createTrpcInvokerForCtx(ctx),
      }),
    ),
  global: publicProcedure
    .meta({ description: "跨实体全局搜索（Post/Agent/Skill/Memory/Task/MCP/Message）。", aiReadable: true })
    .input(globalSearchSchema)
    .query(({ ctx, input }) =>
      runGlobalSearch(ctx.prisma, ctx.services, input.query, input.entities, input.limit),
    ),
});

const analyticsRouter = router({
  dashboard: publicProcedure
    .meta({ description: "系统看板关键指标（文章/Agent/Run/Token/日志）。", aiReadable: true })
    .input(analyticsDashboardSchema)
    .query(({ ctx }) => getAnalyticsDashboard(ctx.prisma)),
});

const aboutRouter = router({
  getProfile: publicProcedure
    .meta({ description: "About Me 页面 profile（content/about/profile.md）。", aiReadable: true })
    .query(() => loadAboutProfile()),
});

const authRouter = router({
  status: publicProcedure
    .meta({ description: "鉴权与远程访问配置状态。", aiReadable: false })
    .query(({ ctx }) => ({
      enabled: isAuthEnabled(ctx.config),
      authenticated: verifyAuthHeader(ctx.config, ctx.req?.headers?.authorization),
      remote: getRemoteAccessInfo(ctx.config),
    })),
  login: publicProcedure
    .meta({ description: "密码登录，返回 Bearer Token。", aiReadable: false })
    .input(authLoginSchema)
    .mutation(({ ctx, input }) => {
      const result = loginWithPassword(ctx.config, input.password);
      if (!result) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "密码错误，请重试。" });
      }
      return success({ data: result, operation: "login", entity: "auth" });
    }),
});

const nativeRouter = router({
  list: publicProcedure
    .meta({ description: "列出所有内置原生工具及参数 Schema。", aiReadable: true })
    .query(() => listNativeTools()),
  capabilities: publicProcedure
    .meta({ description: "服务器原生能力状态（搜索/OCR/浏览器/read_article 平台）。", aiReadable: true })
    .query(async ({ ctx }) =>
      getEnrichedServerCapabilities(ctx.config, () =>
        ctx.services.infoSource.list({ page: 1, pageSize: 1, enabled: true }),
      ),
    ),
  execute: publicProcedure
    .meta({ description: "执行指定原生工具。", aiReadable: true })
    .input(nativeExecuteSchema)
    .mutation(({ ctx, input }) =>
      executeNativeTool(input.name, input.args, {
        config: ctx.config,
        services: ctx.services,
        invokeTrpc: createTrpcInvokerForCtx(ctx),
      }),
    ),
});

const taskRouter = router({
  create: publicProcedure.meta({ description: "创建后台任务。", aiReadable: true }).input(createTaskSchema).mutation(({ ctx, input }) => ctx.services.task.create(input)),
  getById: publicProcedure.meta({ description: "获取任务详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.task.getById(input.id)),
  list: publicProcedure.meta({ description: "列出任务，支持按 status 过滤。", aiReadable: true }).input(listTasksSchema).query(({ ctx, input }) => ctx.services.task.list(input)),
  update: publicProcedure.meta({ description: "更新任务状态或配置。", aiReadable: true }).input(updateTaskSchema).mutation(({ ctx, input }) => ctx.services.task.update(input)),
  delete: publicProcedure.meta({ description: "删除任务。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "task.delete", { id: input.id }, input.approvalId, () => ctx.services.task.delete(input.id)),
  ),
  run: publicProcedure.meta({ description: "立即执行后台任务（如同步 content/ 到 SQLite）。", aiReadable: true }).input(runTaskSchema).mutation(({ ctx, input }) => ctx.services.task.run(input.id)),
});

const workspaceRouter = router({
  create: publicProcedure.meta({ description: "创建工作区。name 和 path 都必须唯一。", aiReadable: true }).input(createWorkspaceSchema).mutation(({ ctx, input }) => ctx.services.workspace.create(input)),
  getById: publicProcedure.meta({ description: "获取工作区详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.workspace.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有工作区。", aiReadable: true }).input(listWorkspacesSchema).query(({ ctx, input }) => ctx.services.workspace.list(input)),
  update: publicProcedure.meta({ description: "更新工作区配置。", aiReadable: true }).input(updateWorkspaceSchema).mutation(({ ctx, input }) => ctx.services.workspace.update(input)),
  delete: publicProcedure.meta({ description: "删除工作区。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.workspace.delete(input.id)),
});

const triggerRouter = router({
  create: publicProcedure.meta({ description: "创建触发器。name 必须唯一。", aiReadable: true }).input(createTriggerSchema).mutation(({ ctx, input }) => ctx.services.trigger.create(input)),
  getById: publicProcedure.meta({ description: "获取触发器详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.trigger.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有触发器。", aiReadable: true }).input(listTriggersSchema).query(({ ctx, input }) => ctx.services.trigger.list(input)),
  update: publicProcedure.meta({ description: "更新触发器配置。", aiReadable: true }).input(updateTriggerSchema).mutation(({ ctx, input }) => ctx.services.trigger.update(input)),
  delete: publicProcedure.meta({ description: "删除触发器。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.trigger.delete(input.id)),
});

const approvalRouter = router({
  create: publicProcedure.meta({ description: "创建审批请求。", aiReadable: true }).input(createApprovalSchema).mutation(({ ctx, input }) => ctx.services.approval.create(input)),
  getById: publicProcedure.meta({ description: "获取审批详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.approval.getById(input.id)),
  list: publicProcedure.meta({ description: "列出审批队列，支持按 status 过滤。", aiReadable: true }).input(listApprovalsSchema).query(({ ctx, input }) => ctx.services.approval.list(input)),
  update: publicProcedure.meta({ description: "更新审批状态（approved/rejected）。", aiReadable: true }).input(updateApprovalSchema).mutation(({ ctx, input }) => ctx.services.approval.update(input)),
  delete: publicProcedure.meta({ description: "删除审批记录。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.approval.delete(input.id)),
  execute: publicProcedure.meta({ description: "执行已通过审批的危险操作。", aiReadable: true }).input(executeApprovalSchema).mutation(({ ctx, input }) => executeApprovedOperation(ctx, input.id)),
  approveAndExecute: publicProcedure.meta({ description: "批准并立即执行审批请求。", aiReadable: true }).input(approveAndExecuteApprovalSchema).mutation(async ({ ctx, input }) => {
    await ctx.services.approval.update({ id: input.id, status: "approved" });
    return executeApprovedOperation(ctx, input.id);
  }),
});

const toolRouter = router({
  create: publicProcedure.meta({ description: "注册工具。name 必须唯一。", aiReadable: true }).input(createToolSchema).mutation(({ ctx, input }) => ctx.services.tool.create(input)),
  getById: publicProcedure.meta({ description: "获取工具详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.tool.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有工具，支持按 type/enabled 过滤。", aiReadable: true }).input(listToolsSchema).query(({ ctx, input }) => ctx.services.tool.list(input)),
  update: publicProcedure.meta({ description: "更新工具配置。", aiReadable: true }).input(updateToolSchema).mutation(({ ctx, input }) => ctx.services.tool.update(input)),
  delete: publicProcedure.meta({ description: "删除工具注册。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.tool.delete(input.id)),
});

const runRouter = router({
  create: publicProcedure.meta({ description: "记录 Agent 执行。", aiReadable: true }).input(createRunSchema).mutation(({ ctx, input }) => ctx.services.run.create(input)),
  getById: publicProcedure.meta({ description: "获取执行记录详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.run.getById(input.id)),
  list: publicProcedure.meta({ description: "列出执行记录，支持按 agentId/status 过滤。", aiReadable: true }).input(listRunsSchema).query(({ ctx, input }) => ctx.services.run.list(input)),
  update: publicProcedure.meta({ description: "更新执行记录状态/结果。", aiReadable: true }).input(updateRunSchema).mutation(({ ctx, input }) => ctx.services.run.update(input)),
  delete: publicProcedure.meta({ description: "删除执行记录。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.run.delete(input.id)),
});

const promptRouter = router({
  create: publicProcedure.meta({ description: "创建提示词模板。name 必须唯一。", aiReadable: true }).input(createPromptSchema).mutation(({ ctx, input }) => ctx.services.prompt.create(input)),
  getById: publicProcedure.meta({ description: "获取提示词模板详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.prompt.getById(input.id)),
  list: publicProcedure.meta({ description: "列出提示词模板，支持按 tag 过滤。", aiReadable: true }).input(listPromptsSchema).query(({ ctx, input }) => ctx.services.prompt.list(input)),
  update: publicProcedure.meta({ description: "更新提示词模板。", aiReadable: true }).input(updatePromptSchema).mutation(({ ctx, input }) => ctx.services.prompt.update(input)),
  delete: publicProcedure.meta({ description: "删除提示词模板。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.prompt.delete(input.id)),
});

const credentialRouter = router({
  create: publicProcedure.meta({ description: "创建凭据。name 必须唯一。", aiReadable: true }).input(createCredentialSchema).mutation(({ ctx, input }) => ctx.services.credential.create(input)),
  getById: publicProcedure.meta({ description: "获取凭据详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.credential.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有凭据。", aiReadable: true }).input(listCredentialsSchema).query(({ ctx, input }) => ctx.services.credential.list(input)),
  update: publicProcedure.meta({ description: "更新凭据。", aiReadable: true }).input(updateCredentialSchema).mutation(({ ctx, input }) => ctx.services.credential.update(input)),
  delete: publicProcedure.meta({ description: "删除凭据。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.credential.delete(input.id)),
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

/* ─── 编译出口 ─── */

export const appRouter = router({
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
  git: gitRouter,
  search: searchRouter,
  analytics: analyticsRouter,
  about: aboutRouter,
  auth: authRouter,
  native: nativeRouter,
  task: taskRouter,
  workspace: workspaceRouter,
  trigger: triggerRouter,
  approval: approvalRouter,
  tool: toolRouter,
  run: runRouter,
  prompt: promptRouter,
  credential: credentialRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
