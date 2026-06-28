import { TRPCError } from "@trpc/server";
import { createTriggerSchema, updateTriggerSchema, listTriggersSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const triggerRouter = router({
  create: publicProcedure.input(createTriggerSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.trigger.findUnique({ where: { name: input.name } });
      if (existing) {
        return failure({
          code: "TRIGGER_NAME_CONFLICT",
          message: `创建 Trigger 失败：name "${input.name}" 已被 id 为 "${existing.id}" 的触发器占用。`,
          details: { name: input.name, existingTriggerId: existing.id },
          field: "name",
          suggestion: "请指定一个不同的触发器名称，或先修改冲突触发器的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "trigger.list",
            input: { pageSize: 20 },
            reason: "列出已有触发器以确认可用名称。",
          },
          operation: "create",
          entity: "trigger",
          durationMs: Date.now() - start,
        });
      }

      const trigger = await ctx.prisma.trigger.create({
        data: input,
      });

      return success({
        data: trigger,
        state: { totalTriggers: await ctx.prisma.trigger.count() },
        nextSteps: [
          {
            action: "查看新创建的触发器",
            procedure: "trigger.getById",
            input: { id: trigger.id },
            reason: "可立即查看触发器详情并进行配置。",
          },
        ],
        operation: "create",
        entity: "trigger",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "trigger", "TRIGGER_CREATE_FAILED");
    }
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
    const start = Date.now();
    const { id, ...data } = input;

    try {
      const existing = await ctx.prisma.trigger.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "TRIGGER_NOT_FOUND",
          message: `更新 Trigger 失败：id 为 "${id}" 的触发器不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 trigger.list 查询可用触发器，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "trigger.list",
            input: { pageSize: 20 },
            reason: "列出最近触发器以获取正确的 id。",
          },
          operation: "update",
          entity: "trigger",
          durationMs: Date.now() - start,
        });
      }

      if (data.name && data.name !== existing.name) {
        const existingName = await ctx.prisma.trigger.findUnique({ where: { name: data.name } });
        if (existingName) {
          return failure({
            code: "TRIGGER_NAME_CONFLICT",
            message: `更新 Trigger 失败：name "${data.name}" 已被 id 为 "${existingName.id}" 的触发器占用。`,
            details: { name: data.name, existingTriggerId: existingName.id },
            field: "name",
            suggestion: "请指定一个不同的触发器名称，或先修改冲突触发器的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "trigger.list",
              input: { pageSize: 20 },
              reason: "列出已有触发器以确认可用名称。",
            },
            operation: "update",
            entity: "trigger",
            durationMs: Date.now() - start,
          });
        }
      }

      const trigger = await ctx.prisma.trigger.update({
        where: { id },
        data,
      });

      return success({
        data: trigger,
        state: { totalTriggers: await ctx.prisma.trigger.count() },
        operation: "update",
        entity: "trigger",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "trigger", "TRIGGER_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.trigger.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "TRIGGER_NOT_FOUND",
          message: `删除 Trigger 失败：id 为 "${input.id}" 的触发器不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 trigger.list 确认要删除的触发器 id。",
          retryable: false,
          suggestedAction: {
            procedure: "trigger.list",
            input: { pageSize: 20 },
            reason: "列出触发器以获取正确的 id。",
          },
          operation: "delete",
          entity: "trigger",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.trigger.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalTriggers: await ctx.prisma.trigger.count() },
        operation: "delete",
        entity: "trigger",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "trigger", "TRIGGER_DELETE_FAILED");
    }
  }),
});
