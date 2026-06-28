import { TRPCError } from "@trpc/server";
import { createMemorySchema, updateMemorySchema, listMemoriesSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

function formatMemory(memory: any) {
  return {
    ...memory,
    keywords: memory.keywords ? memory.keywords.split(",").filter(Boolean) : [],
  };
}

export const memoryRouter = router({
  create: publicProcedure.input(createMemorySchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const memory = await ctx.prisma.memory.create({
        data: {
          content: input.content,
          type: input.type,
          strength: input.strength,
          keywords: input.keywords.join(","),
        },
      });

      return success({
        data: formatMemory(memory),
        state: { totalMemories: await ctx.prisma.memory.count() },
        nextSteps: [
          {
            action: "查看新创建的记忆",
            procedure: "memory.getById",
            input: { id: memory.id },
            reason: "可立即查看记忆详情。",
          },
        ],
        operation: "create",
        entity: "memory",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "memory", "MEMORY_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const memory = await ctx.prisma.memory.findUnique({ where: { id: input.id } });
    if (!memory) {
      throw new TRPCError({ code: "NOT_FOUND", message: "记忆记录不存在" });
    }
    return formatMemory(memory);
  }),

  list: publicProcedure.input(listMemoriesSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword, type } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (type) where.type = type;
    if (keyword) {
      where.OR = [
        { content: { contains: keyword } },
        { keywords: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.memory.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.memory.count({ where }),
    ]);

    return {
      items: items.map(formatMemory),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateMemorySchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, keywords, ...data } = input;

    try {
      const existing = await ctx.prisma.memory.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "MEMORY_NOT_FOUND",
          message: `更新 Memory 失败：id 为 "${id}" 的记忆记录不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 memory.list 查询可用记忆，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "memory.list",
            input: { pageSize: 20 },
            reason: "列出最近记忆以获取正确的 id。",
          },
          operation: "update",
          entity: "memory",
          durationMs: Date.now() - start,
        });
      }

      const updateData: any = { ...data };
      if (keywords !== undefined) {
        updateData.keywords = keywords.join(",");
      }

      const memory = await ctx.prisma.memory.update({
        where: { id },
        data: updateData,
      });

      return success({
        data: formatMemory(memory),
        state: { totalMemories: await ctx.prisma.memory.count() },
        operation: "update",
        entity: "memory",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "memory", "MEMORY_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.memory.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "MEMORY_NOT_FOUND",
          message: `删除 Memory 失败：id 为 "${input.id}" 的记忆记录不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 memory.list 确认要删除的记忆 id。",
          retryable: false,
          suggestedAction: {
            procedure: "memory.list",
            input: { pageSize: 20 },
            reason: "列出记忆以获取正确的 id。",
          },
          operation: "delete",
          entity: "memory",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.memory.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, content: existing.content },
        state: { totalMemories: await ctx.prisma.memory.count() },
        operation: "delete",
        entity: "memory",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "memory", "MEMORY_DELETE_FAILED");
    }
  }),
});
