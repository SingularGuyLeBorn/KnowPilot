import { TRPCError } from "@trpc/server";
import { createMessageSchema, updateMessageSchema, listMessagesSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const messageRouter = router({
  create: publicProcedure.input(createMessageSchema).mutation(async ({ ctx, input }) => {
    const session = await ctx.prisma.chatSession.findUnique({ where: { id: input.sessionId } });
    if (!session) {
      throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    }

    const message = await ctx.prisma.chatMessage.create({
      data: input,
    });

    // 更新会话的 updatedAt 属性
    await ctx.prisma.chatSession.update({
      where: { id: input.sessionId },
      data: { updatedAt: new Date() },
    });

    return message;
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const message = await ctx.prisma.chatMessage.findUnique({ where: { id: input.id } });
    if (!message) {
      throw new TRPCError({ code: "NOT_FOUND", message: "消息不存在" });
    }
    return message;
  }),

  list: publicProcedure.input(listMessagesSchema).query(async ({ ctx, input }) => {
    const { sessionId, page, pageSize } = input;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      ctx.prisma.chatMessage.findMany({
        where: { sessionId },
        skip,
        take: pageSize,
        orderBy: { createdAt: "asc" },
      }),
      ctx.prisma.chatMessage.count({ where: { sessionId } }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateMessageSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const existing = await ctx.prisma.chatMessage.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "消息不存在" });
    }

    return ctx.prisma.chatMessage.update({
      where: { id },
      data,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.chatMessage.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "消息不存在" });
    }

    await ctx.prisma.chatMessage.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
