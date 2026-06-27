import { TRPCError } from "@trpc/server";
import { createSessionSchema, updateSessionSchema, listSessionsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const sessionRouter = router({
  create: publicProcedure.input(createSessionSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.chatSession.create({
      data: input,
    });
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const session = await ctx.prisma.chatSession.findUnique({
      where: { id: input.id },
      include: { messages: true },
    });
    if (!session) {
      throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    }
    return session;
  }),

  list: publicProcedure.input(listSessionsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.title = { contains: keyword };
    }

    const [items, total] = await Promise.all([
      ctx.prisma.chatSession.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.chatSession.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateSessionSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const existing = await ctx.prisma.chatSession.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    }

    return ctx.prisma.chatSession.update({
      where: { id },
      data,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.chatSession.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    }

    await ctx.prisma.chatSession.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
