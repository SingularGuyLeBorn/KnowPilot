import { TRPCError } from "@trpc/server";
import { createToolSchema, updateToolSchema, listToolsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

function formatTool(tool: any) {
  return {
    ...tool,
    parametersSchema: tool.parametersSchema ?? null,
  };
}

export const toolRouter = router({
  create: publicProcedure.input(createToolSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.tool.findUnique({ where: { name: input.name } });
      if (existing) {
        return failure({
          code: "TOOL_NAME_CONFLICT",
          message: `创建 Tool 失败：name "${input.name}" 已被 id 为 "${existing.id}" 的 Tool 占用。`,
          details: { name: input.name, existingToolId: existing.id },
          field: "name",
          suggestion: "请指定一个不同的 Tool 名称，或先修改冲突 Tool 的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "tool.list",
            input: { pageSize: 20 },
            reason: "列出已有 Tool 以确认可用名称。",
          },
          operation: "create",
          entity: "tool",
          durationMs: Date.now() - start,
        });
      }

      const tool = await ctx.prisma.tool.create({
        data: input,
      });

      return success({
        data: formatTool(tool),
        state: { totalTools: await ctx.prisma.tool.count() },
        nextSteps: [
          {
            action: "查看新创建的 Tool",
            procedure: "tool.getById",
            input: { id: tool.id },
            reason: "可立即查看 Tool 详情并进行配置。",
          },
        ],
        operation: "create",
        entity: "tool",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "tool", "TOOL_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const tool = await ctx.prisma.tool.findUnique({ where: { id: input.id } });
    if (!tool) {
      throw new TRPCError({ code: "NOT_FOUND", message: "工具不存在" });
    }
    return formatTool(tool);
  }),

  list: publicProcedure.input(listToolsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, type, keyword, enabled } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (type) where.type = type;
    if (enabled !== undefined) where.enabled = enabled;
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.tool.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.tool.count({ where }),
    ]);

    return {
      items: items.map(formatTool),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateToolSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, name, ...data } = input;

    try {
      const existing = await ctx.prisma.tool.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "TOOL_NOT_FOUND",
          message: `更新 Tool 失败：id 为 "${id}" 的 Tool 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 tool.list 查询可用 Tool，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "tool.list",
            input: { pageSize: 20 },
            reason: "列出最近 Tool 以获取正确的 id。",
          },
          operation: "update",
          entity: "tool",
          durationMs: Date.now() - start,
        });
      }

      if (name !== undefined && name !== existing.name) {
        const nameConflict = await ctx.prisma.tool.findUnique({ where: { name } });
        if (nameConflict) {
          return failure({
            code: "TOOL_NAME_CONFLICT",
            message: `更新 Tool 失败：name "${name}" 已被 id 为 "${nameConflict.id}" 的 Tool 占用。`,
            details: { name, existingToolId: nameConflict.id },
            field: "name",
            suggestion: "请指定一个不同的 Tool 名称，或先修改冲突 Tool 的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "tool.list",
              input: { pageSize: 20 },
              reason: "列出已有 Tool 以确认可用名称。",
            },
            operation: "update",
            entity: "tool",
            durationMs: Date.now() - start,
          });
        }
      }

      const tool = await ctx.prisma.tool.update({
        where: { id },
        data: { ...data, name },
      });

      return success({
        data: formatTool(tool),
        state: { totalTools: await ctx.prisma.tool.count() },
        operation: "update",
        entity: "tool",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "tool", "TOOL_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.tool.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "TOOL_NOT_FOUND",
          message: `删除 Tool 失败：id 为 "${input.id}" 的 Tool 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 tool.list 确认要删除的 Tool id。",
          retryable: false,
          suggestedAction: {
            procedure: "tool.list",
            input: { pageSize: 20 },
            reason: "列出 Tool 以获取正确的 id。",
          },
          operation: "delete",
          entity: "tool",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.tool.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalTools: await ctx.prisma.tool.count() },
        nextSteps: [
          {
            action: "创建新 Tool",
            procedure: "tool.create",
            reason: "已删除的 Tool 无法恢复，可创建新 Tool 替代。",
          },
        ],
        operation: "delete",
        entity: "tool",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "tool", "TOOL_DELETE_FAILED");
    }
  }),
});
