import { TRPCError } from "@trpc/server";
import { createMemorySchema, updateMemorySchema, listMemoriesSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

function formatMemory(memory: any) {
  return {
    ...memory,
    keywords: memory.keywords ? memory.keywords.split(",").filter(Boolean) : [],
  };
}

export const memoryRouter = router({
  create: publicProcedure.input(createMemorySchema).mutation(async ({ ctx, input }) => {
    const memory = await ctx.prisma.memory.create({
      data: {
        content: input.content,
        type: input.type,
        strength: input.strength,
        keywords: input.keywords.join(","),
      },
    });

    return formatMemory(memory);
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
    const { id, keywords, ...data } = input;

    const existing = await ctx.prisma.memory.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "记忆记录不存在" });
    }

    const updateData: any = { ...data };
    if (keywords !== undefined) {
      updateData.keywords = keywords.join(",");
    }

    const memory = await ctx.prisma.memory.update({
      where: { id },
      data: updateData,
    });

    return formatMemory(memory);
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.memory.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "记忆记录不存在" });
    }

    await ctx.prisma.memory.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
