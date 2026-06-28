import { TRPCError } from "@trpc/server";
import { createRunSchema, updateRunSchema, listRunsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const runRouter = router({
  create: publicProcedure.input(createRunSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      if (input.agentId) {
        const agent = await ctx.prisma.agent.findUnique({ where: { id: input.agentId } });
        if (!agent) {
          return failure({
            code: "RUN_AGENT_NOT_FOUND",
            message: `创建 Run 失败：agentId "${input.agentId}" 对应的 Agent 不存在。`,
            details: { agentId: input.agentId },
            field: "agentId",
            suggestion: "请调用 agent.list 查询可用 Agent，或留空 agentId。",
            retryable: false,
            suggestedAction: {
              procedure: "agent.list",
              input: { pageSize: 20 },
              reason: "列出已有 Agent 以获取正确的 id。",
            },
            operation: "create",
            entity: "run",
            durationMs: Date.now() - start,
          });
        }
      }

      if (input.sessionId) {
        const session = await ctx.prisma.chatSession.findUnique({ where: { id: input.sessionId } });
        if (!session) {
          return failure({
            code: "RUN_SESSION_NOT_FOUND",
            message: `创建 Run 失败：sessionId "${input.sessionId}" 对应的会话不存在。`,
            details: { sessionId: input.sessionId },
            field: "sessionId",
            suggestion: "请调用 session.list 查询可用会话，或留空 sessionId。",
            retryable: false,
            suggestedAction: {
              procedure: "session.list",
              input: { pageSize: 20 },
              reason: "列出已有会话以获取正确的 id。",
            },
            operation: "create",
            entity: "run",
            durationMs: Date.now() - start,
          });
        }
      }

      const run = await ctx.prisma.run.create({
        data: input,
      });

      return success({
        data: run,
        state: { totalRuns: await ctx.prisma.run.count() },
        nextSteps: [
          {
            action: "查看新创建的 Run",
            procedure: "run.getById",
            input: { id: run.id },
            reason: "可立即查看 Run 详情并跟踪执行状态。",
          },
        ],
        operation: "create",
        entity: "run",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "run", "RUN_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const run = await ctx.prisma.run.findUnique({ where: { id: input.id } });
    if (!run) {
      throw new TRPCError({ code: "NOT_FOUND", message: "执行记录不存在" });
    }
    return run;
  }),

  list: publicProcedure.input(listRunsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, agentId, sessionId, status, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (agentId) where.agentId = agentId;
    if (sessionId) where.sessionId = sessionId;
    if (status) where.status = status;
    if (keyword) {
      where.OR = [
        { id: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.run.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      ctx.prisma.run.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateRunSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, ...data } = input;

    try {
      const existing = await ctx.prisma.run.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "RUN_NOT_FOUND",
          message: `更新 Run 失败：id 为 "${id}" 的 Run 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 run.list 查询可用 Run，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "run.list",
            input: { pageSize: 20 },
            reason: "列出最近 Run 以获取正确的 id。",
          },
          operation: "update",
          entity: "run",
          durationMs: Date.now() - start,
        });
      }

      const run = await ctx.prisma.run.update({
        where: { id },
        data,
      });

      return success({
        data: run,
        state: { totalRuns: await ctx.prisma.run.count() },
        operation: "update",
        entity: "run",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "run", "RUN_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.run.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "RUN_NOT_FOUND",
          message: `删除 Run 失败：id 为 "${input.id}" 的 Run 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 run.list 确认要删除的 Run id。",
          retryable: false,
          suggestedAction: {
            procedure: "run.list",
            input: { pageSize: 20 },
            reason: "列出 Run 以获取正确的 id。",
          },
          operation: "delete",
          entity: "run",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.run.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id },
        state: { totalRuns: await ctx.prisma.run.count() },
        nextSteps: [
          {
            action: "创建新 Run",
            procedure: "run.create",
            reason: "已删除的 Run 无法恢复，可创建新 Run 替代。",
          },
        ],
        operation: "delete",
        entity: "run",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "run", "RUN_DELETE_FAILED");
    }
  }),
});
