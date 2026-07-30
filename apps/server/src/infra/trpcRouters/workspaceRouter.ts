/**
 * workspace tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createWorkspaceSchema, updateWorkspaceSchema, listWorkspacesSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const workspaceRouter = router({
  create: publicProcedure
    .meta({ description: "创建工作区（path 唯一）。autoCreateManager=true 时自动创建管理 Agent + 主 session + .knowpilot/ 目录。", aiReadable: false })
    .input(createWorkspaceSchema)
    .mutation(async ({ ctx, input }) => {
      const withManager = input.withManager !== false && input.autoCreateManager !== false;
      if (!withManager) {
        return ctx.services.workspace.create(input);
      }
      // 走完整 provision：Workspace + 管理 Agent + 主 session + 可选初始任务 + .knowpilot/
      const { provisionWorkspace } = await import("../workspaceProvision.js");
      const result = await provisionWorkspace(ctx.config, ctx.services, {
        name: input.name,
        path: input.path,
        description: input.description,
        withManager: true,
        managerName: input.managerName,
        initialTask: input.initialTask,
        asyncSlotQuota: input.asyncSlotQuota,
        operatorAgentId: "user",
      });
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "创建 Workspace 失败" });
      }
      const ws = await ctx.services.workspace.getById(result.workspaceId!);
      return {
        success: true as const,
        data: ws,
        managerAgentId: result.managerAgentId,
        managerSessionId: result.managerSessionId,
        initialTaskStatus: result.initialTaskStatus,
      };
    }),
  getById: publicProcedure.meta({ description: "获取工作区详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.workspace.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有工作区。", aiReadable: true }).input(listWorkspacesSchema).query(({ ctx, input }) => ctx.services.workspace.list(input)),
  update: publicProcedure.meta({ description: "更新工作区配置。", aiReadable: true }).input(updateWorkspaceSchema).mutation(({ ctx, input }) => ctx.services.workspace.update(input)),
  delete: publicProcedure.meta({ description: "删除工作区。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.workspace.delete(input.id)),
  resetAssistantHome: publicProcedure
    .meta({
      description:
        "重置 Assistant Home：归档默认助手会话并清空队列，恢复内置工具清单与系统提示；不动长期记忆与 pinned。",
      aiReadable: false,
    })
    .mutation(async ({ ctx }) => {
      const { resetAssistantHome } = await import("../swarmInitializer.js");
      try {
        const result = await resetAssistantHome(ctx.prisma, ctx.config, ctx.services);
        return { success: true as const, data: result };
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
});

