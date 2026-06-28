import { TRPCError } from "@trpc/server";
import { createMessageSchema, updateMessageSchema, listMessagesSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const messageRouter = router({
  create: publicProcedure.input(createMessageSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const session = await ctx.prisma.chatSession.findUnique({ where: { id: input.sessionId } });
      if (!session) {
        return failure({
          code: "SESSION_NOT_FOUND",
          message: `创建 Message 失败：所属 Session id 为 "${input.sessionId}" 的会话不存在。`,
          details: { sessionId: input.sessionId },
          field: "sessionId",
          suggestion: "请先调用 session.create 创建会话，或传入正确的 sessionId。",
          retryable: false,
          suggestedAction: {
            procedure: "session.list",
            input: { pageSize: 20 },
            reason: "列出可用 Session 以选择正确的 sessionId。",
          },
          operation: "create",
          entity: "message",
          durationMs: Date.now() - start,
        });
      }

      const message = await ctx.prisma.chatMessage.create({
        data: input,
      });

      // 更新会话的 updatedAt 属性
      await ctx.prisma.chatSession.update({
        where: { id: input.sessionId },
        data: { updatedAt: new Date() },
      });

      return success({
        data: message,
        state: {
          totalMessages: await ctx.prisma.chatMessage.count(),
          totalSessions: await ctx.prisma.chatSession.count(),
        },
        operation: "create",
        entity: "message",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "message", "MESSAGE_CREATE_FAILED");
    }
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
    const start = Date.now();
    const { id, ...data } = input;

    try {
      const existing = await ctx.prisma.chatMessage.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "MESSAGE_NOT_FOUND",
          message: `更新 Message 失败：id 为 "${id}" 的 Message 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 message.list 查询可用 Message，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "message.list",
            input: { pageSize: 20 },
            reason: "列出最近 Message 以获取正确的 id。",
          },
          operation: "update",
          entity: "message",
          durationMs: Date.now() - start,
        });
      }

      const message = await ctx.prisma.chatMessage.update({
        where: { id },
        data,
      });

      return success({
        data: message,
        state: { totalMessages: await ctx.prisma.chatMessage.count() },
        operation: "update",
        entity: "message",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "message", "MESSAGE_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.chatMessage.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "MESSAGE_NOT_FOUND",
          message: `删除 Message 失败：id 为 "${input.id}" 的 Message 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 message.list 确认要删除的 Message id。",
          retryable: false,
          suggestedAction: {
            procedure: "message.list",
            input: { pageSize: 20 },
            reason: "列出 Message 以获取正确的 id。",
          },
          operation: "delete",
          entity: "message",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.chatMessage.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, role: existing.role },
        state: { totalMessages: await ctx.prisma.chatMessage.count() },
        operation: "delete",
        entity: "message",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "message", "MESSAGE_DELETE_FAILED");
    }
  }),
});
