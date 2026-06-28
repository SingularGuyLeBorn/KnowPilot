import { TRPCError } from "@trpc/server";
import { createLogSchema, updateLogSchema, listLogsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const logRouter = router({
  create: publicProcedure.input(createLogSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const log = await ctx.prisma.log.create({
        data: {
          level: input.level,
          component: input.component,
          event: input.event,
          message: input.message,
          metadata: input.metadata ?? undefined,
        },
      });

      return success({
        data: log,
        state: { totalLogs: await ctx.prisma.log.count() },
        operation: "create",
        entity: "log",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "log", "LOG_CREATE_FAILED");
    }
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

  update: publicProcedure.input(updateLogSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, message, metadata } = input;

    try {
      const existing = await ctx.prisma.log.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "LOG_NOT_FOUND",
          message: `更新 Log 失败：id 为 "${id}" 的日志不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 log.list 查询可用日志，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "log.list",
            input: { pageSize: 20 },
            reason: "列出最近日志以获取正确的 id。",
          },
          operation: "update",
          entity: "log",
          durationMs: Date.now() - start,
        });
      }

      const updateData: any = {};
      if (message !== undefined) updateData.message = message;
      if (metadata !== undefined) updateData.metadata = metadata;

      const log = await ctx.prisma.log.update({
        where: { id },
        data: updateData,
      });

      return success({
        data: log,
        state: { totalLogs: await ctx.prisma.log.count() },
        operation: "update",
        entity: "log",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "log", "LOG_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.log.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "LOG_NOT_FOUND",
          message: `删除 Log 失败：id 为 "${input.id}" 的日志不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 log.list 确认要删除的日志 id。",
          retryable: false,
          suggestedAction: {
            procedure: "log.list",
            input: { pageSize: 20 },
            reason: "列出日志以获取正确的 id。",
          },
          operation: "delete",
          entity: "log",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.log.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, event: existing.event },
        state: { totalLogs: await ctx.prisma.log.count() },
        operation: "delete",
        entity: "log",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "log", "LOG_DELETE_FAILED");
    }
  }),

  clearAll: publicProcedure.mutation(async ({ ctx }) => {
    const start = Date.now();

    try {
      const beforeCount = await ctx.prisma.log.count();
      await ctx.prisma.log.deleteMany();

      return success({
        data: { cleared: beforeCount },
        state: { totalLogs: await ctx.prisma.log.count() },
        operation: "clearAll",
        entity: "log",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "clearAll", "log", "LOG_DELETE_FAILED");
    }
  }),
});
