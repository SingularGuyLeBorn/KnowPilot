import { TRPCError } from "@trpc/server";
import { createTaskSchema, updateTaskSchema, listTasksSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const taskRouter = router({
  create: publicProcedure.input(createTaskSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const task = await ctx.prisma.task.create({
        data: {
          name: input.name,
          type: input.type,
          status: input.status,
          input: input.input ?? undefined,
          output: input.output ?? undefined,
          cronExpression: input.cronExpression,
        },
      });

      return success({
        data: task,
        state: { totalTasks: await ctx.prisma.task.count() },
        nextSteps: [
          {
            action: "查看新创建的任务",
            procedure: "task.getById",
            input: { id: task.id },
            reason: "可立即查看任务详情并跟踪执行状态。",
          },
        ],
        operation: "create",
        entity: "task",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "task", "TASK_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const task = await ctx.prisma.task.findUnique({ where: { id: input.id } });
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    return task;
  }),

  list: publicProcedure.input(listTasksSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, status, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (status) where.status = status;
    if (keyword) {
      where.name = { contains: keyword };
    }

    const [items, total] = await Promise.all([
      ctx.prisma.task.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.task.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateTaskSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, status, output, name, cronExpression } = input;

    try {
      const existing = await ctx.prisma.task.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "TASK_NOT_FOUND",
          message: `更新 Task 失败：id 为 "${id}" 的任务不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 task.list 查询可用任务，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "task.list",
            input: { pageSize: 20 },
            reason: "列出最近任务以获取正确的 id。",
          },
          operation: "update",
          entity: "task",
          durationMs: Date.now() - start,
        });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (status !== undefined) updateData.status = status;
      if (cronExpression !== undefined) updateData.cronExpression = cronExpression;
      if (output !== undefined) updateData.output = output;

      const task = await ctx.prisma.task.update({
        where: { id },
        data: updateData,
      });

      return success({
        data: task,
        state: { totalTasks: await ctx.prisma.task.count() },
        operation: "update",
        entity: "task",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "task", "TASK_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.task.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "TASK_NOT_FOUND",
          message: `删除 Task 失败：id 为 "${input.id}" 的任务不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 task.list 确认要删除的任务 id。",
          retryable: false,
          suggestedAction: {
            procedure: "task.list",
            input: { pageSize: 20 },
            reason: "列出任务以获取正确的 id。",
          },
          operation: "delete",
          entity: "task",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.task.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalTasks: await ctx.prisma.task.count() },
        operation: "delete",
        entity: "task",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "task", "TASK_DELETE_FAILED");
    }
  }),
});
