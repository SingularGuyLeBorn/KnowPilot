import { TRPCError } from "@trpc/server";
import { createSessionSchema, updateSessionSchema, listSessionsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const sessionRouter = router({
  create: publicProcedure.input(createSessionSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const session = await ctx.prisma.chatSession.create({
        data: input,
      });

      return success({
        data: session,
        state: { totalSessions: await ctx.prisma.chatSession.count() },
        nextSteps: [
          {
            action: "进入会话发送消息",
            procedure: "message.create",
            input: { sessionId: session.id },
            reason: "新会话已创建，可立即开始对话。",
          },
        ],
        operation: "create",
        entity: "session",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "session", "SESSION_CREATE_FAILED");
    }
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
    const start = Date.now();
    const { id, ...data } = input;

    try {
      const existing = await ctx.prisma.chatSession.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "SESSION_NOT_FOUND",
          message: `更新 Session 失败：id 为 "${id}" 的 Session 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 session.list 查询可用 Session，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "session.list",
            input: { pageSize: 20 },
            reason: "列出最近 Session 以获取正确的 id。",
          },
          operation: "update",
          entity: "session",
          durationMs: Date.now() - start,
        });
      }

      const session = await ctx.prisma.chatSession.update({
        where: { id },
        data,
      });

      return success({
        data: session,
        state: { totalSessions: await ctx.prisma.chatSession.count() },
        operation: "update",
        entity: "session",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "session", "SESSION_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.chatSession.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "SESSION_NOT_FOUND",
          message: `删除 Session 失败：id 为 "${input.id}" 的 Session 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 session.list 确认要删除的 Session id。",
          retryable: false,
          suggestedAction: {
            procedure: "session.list",
            input: { pageSize: 20 },
            reason: "列出 Session 以获取正确的 id。",
          },
          operation: "delete",
          entity: "session",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.chatSession.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, title: existing.title },
        state: { totalSessions: await ctx.prisma.chatSession.count() },
        nextSteps: [
          {
            action: "创建新 Session",
            procedure: "session.create",
            reason: "已删除的 Session 及其消息无法恢复，可创建新 Session 替代。",
          },
        ],
        operation: "delete",
        entity: "session",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "session", "SESSION_DELETE_FAILED");
    }
  }),
});
