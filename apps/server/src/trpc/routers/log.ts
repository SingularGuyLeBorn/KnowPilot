import { TRPCError } from "@trpc/server";
import { createLogSchema, listLogsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const logRouter = router({
  create: publicProcedure.input(createLogSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.log.create({
      data: {
        level: input.level,
        component: input.component,
        event: input.event,
        message: input.message,
        metadata: input.metadata ?? undefined,
      },
    });
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const log = await ctx.prisma.log.findUnique({ where: { id: input.id } });
    if (!log) {
      throw new TRPCError({ code: "NOT_FOUND", message: "日志不存在" });
    }
    return log;
  }),

  list: publicProcedure.input(listLogsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, level, component, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (level) where.level = level;
    if (component) where.component = component;
    if (keyword) {
      where.OR = [
        { message: { contains: keyword } },
        { event: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.log.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      ctx.prisma.log.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(z.object({
    id: z.string().cuid(),
    message: z.string().optional(),
    metadata: z.any().optional(),
  })).mutation(async ({ ctx, input }) => {
    const { id, message, metadata } = input;

    const existing = await ctx.prisma.log.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "日志不存在" });
    }

    const updateData: any = {};
    if (message !== undefined) updateData.message = message;
    if (metadata !== undefined) updateData.metadata = metadata;

    return ctx.prisma.log.update({
      where: { id },
      data: updateData,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.log.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "日志不存在" });
    }

    await ctx.prisma.log.delete({ where: { id: input.id } });
    return { success: true };
  }),

  clearAll: publicProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.log.deleteMany();
    return { success: true };
  }),
});
