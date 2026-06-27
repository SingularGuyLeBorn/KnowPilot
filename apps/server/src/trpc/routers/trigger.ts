import { TRPCError } from "@trpc/server";
import { createTriggerSchema, updateTriggerSchema, listTriggersSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const triggerRouter = router({
  create: publicProcedure.input(createTriggerSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.trigger.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "触发器名称已存在" });
    }

    return ctx.prisma.trigger.create({
      data: input,
    });
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const trigger = await ctx.prisma.trigger.findUnique({ where: { id: input.id } });
    if (!trigger) {
      throw new TRPCError({ code: "NOT_FOUND", message: "触发器不存在" });
    }
    return trigger;
  }),

  list: publicProcedure.input(listTriggersSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { source: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.trigger.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.trigger.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateTriggerSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const existing = await ctx.prisma.trigger.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "触发器不存在" });
    }

    if (data.name && data.name !== existing.name) {
      const existingName = await ctx.prisma.trigger.findUnique({ where: { name: data.name } });
      if (existingName) {
        throw new TRPCError({ code: "CONFLICT", message: "触发器名称已存在" });
      }
    }

    return ctx.prisma.trigger.update({
      where: { id },
      data,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.trigger.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "触发器不存在" });
    }

    await ctx.prisma.trigger.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
