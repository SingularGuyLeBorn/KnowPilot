import { TRPCError } from "@trpc/server";
import { createTaskSchema, updateTaskSchema, listTasksSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const taskRouter = router({
  create: publicProcedure.input(createTaskSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.task.create({
      data: {
        name: input.name,
        type: input.type,
        status: input.status,
        input: input.input ?? undefined,
        cronExpression: input.cronExpression,
      },
    });
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
    const { id, status, output, name, cronExpression } = input;

    const existing = await ctx.prisma.task.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    if (cronExpression !== undefined) updateData.cronExpression = cronExpression;
    if (output !== undefined) updateData.output = output;

    return ctx.prisma.task.update({
      where: { id },
      data: updateData,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.task.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }

    await ctx.prisma.task.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
