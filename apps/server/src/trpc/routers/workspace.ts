import { TRPCError } from "@trpc/server";
import { createWorkspaceSchema, updateWorkspaceSchema, listWorkspacesSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const workspaceRouter = router({
  create: publicProcedure.input(createWorkspaceSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existingName = await ctx.prisma.workspace.findUnique({ where: { name: input.name } });
      if (existingName) {
        return failure({
          code: "WORKSPACE_NAME_CONFLICT",
          message: `创建 Workspace 失败：name "${input.name}" 已被 id 为 "${existingName.id}" 的工作区占用。`,
          details: { name: input.name, existingWorkspaceId: existingName.id },
          field: "name",
          suggestion: "请指定一个不同的工作区名称，或先修改冲突工作区的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "workspace.list",
            input: { pageSize: 20 },
            reason: "列出已有工作区以确认可用名称。",
          },
          operation: "create",
          entity: "workspace",
          durationMs: Date.now() - start,
        });
      }

      const existingPath = await ctx.prisma.workspace.findUnique({ where: { path: input.path } });
      if (existingPath) {
        return failure({
          code: "WORKSPACE_PATH_CONFLICT",
          message: `创建 Workspace 失败：path "${input.path}" 已被 id 为 "${existingPath.id}" 的工作区注册。`,
          details: { path: input.path, existingWorkspaceId: existingPath.id },
          field: "path",
          suggestion: "请选择一个未被注册的目录路径，或先修改冲突工作区的路径。",
          retryable: false,
          suggestedAction: {
            procedure: "workspace.list",
            input: { pageSize: 20 },
            reason: "列出已有工作区以确认可用路径。",
          },
          operation: "create",
          entity: "workspace",
          durationMs: Date.now() - start,
        });
      }

      const workspace = await ctx.prisma.workspace.create({
        data: input,
      });

      return success({
        data: workspace,
        state: { totalWorkspaces: await ctx.prisma.workspace.count() },
        nextSteps: [
          {
            action: "查看新创建的工作区",
            procedure: "workspace.getById",
            input: { id: workspace.id },
            reason: "可立即查看工作区详情。",
          },
        ],
        operation: "create",
        entity: "workspace",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "workspace", "WORKSPACE_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const workspace = await ctx.prisma.workspace.findUnique({ where: { id: input.id } });
    if (!workspace) {
      throw new TRPCError({ code: "NOT_FOUND", message: "工作区不存在" });
    }
    return workspace;
  }),

  list: publicProcedure.input(listWorkspacesSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.workspace.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.workspace.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateWorkspaceSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, ...data } = input;

    try {
      const existing = await ctx.prisma.workspace.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "WORKSPACE_NOT_FOUND",
          message: `更新 Workspace 失败：id 为 "${id}" 的工作区不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 workspace.list 查询可用工作区，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "workspace.list",
            input: { pageSize: 20 },
            reason: "列出最近工作区以获取正确的 id。",
          },
          operation: "update",
          entity: "workspace",
          durationMs: Date.now() - start,
        });
      }

      // 检查名称唯一性
      if (data.name && data.name !== existing.name) {
        const existingName = await ctx.prisma.workspace.findUnique({ where: { name: data.name } });
        if (existingName) {
          return failure({
            code: "WORKSPACE_NAME_CONFLICT",
            message: `更新 Workspace 失败：name "${data.name}" 已被 id 为 "${existingName.id}" 的工作区占用。`,
            details: { name: data.name, existingWorkspaceId: existingName.id },
            field: "name",
            suggestion: "请指定一个不同的工作区名称，或先修改冲突工作区的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "workspace.list",
              input: { pageSize: 20 },
              reason: "列出已有工作区以确认可用名称。",
            },
            operation: "update",
            entity: "workspace",
            durationMs: Date.now() - start,
          });
        }
      }

      // 检查路径唯一性
      if (data.path && data.path !== existing.path) {
        const existingPath = await ctx.prisma.workspace.findUnique({ where: { path: data.path } });
        if (existingPath) {
          return failure({
            code: "WORKSPACE_PATH_CONFLICT",
            message: `更新 Workspace 失败：path "${data.path}" 已被 id 为 "${existingPath.id}" 的工作区注册。`,
            details: { path: data.path, existingWorkspaceId: existingPath.id },
            field: "path",
            suggestion: "请选择一个未被注册的目录路径，或先修改冲突工作区的路径。",
            retryable: false,
            suggestedAction: {
              procedure: "workspace.list",
              input: { pageSize: 20 },
              reason: "列出已有工作区以确认可用路径。",
            },
            operation: "update",
            entity: "workspace",
            durationMs: Date.now() - start,
          });
        }
      }

      const workspace = await ctx.prisma.workspace.update({
        where: { id },
        data,
      });

      return success({
        data: workspace,
        state: { totalWorkspaces: await ctx.prisma.workspace.count() },
        operation: "update",
        entity: "workspace",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "workspace", "WORKSPACE_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.workspace.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "WORKSPACE_NOT_FOUND",
          message: `删除 Workspace 失败：id 为 "${input.id}" 的工作区不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 workspace.list 确认要删除的工作区 id。",
          retryable: false,
          suggestedAction: {
            procedure: "workspace.list",
            input: { pageSize: 20 },
            reason: "列出工作区以获取正确的 id。",
          },
          operation: "delete",
          entity: "workspace",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.workspace.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalWorkspaces: await ctx.prisma.workspace.count() },
        operation: "delete",
        entity: "workspace",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "workspace", "WORKSPACE_DELETE_FAILED");
    }
  }),
});
