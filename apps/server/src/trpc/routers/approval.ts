import { TRPCError } from "@trpc/server";
import { createApprovalSchema, updateApprovalSchema, listApprovalsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

function formatApproval(approval: any) {
  return {
    ...approval,
    args: approval.args ? (typeof approval.args === 'string' ? JSON.parse(approval.args) : approval.args) : {},
  };
}

export const approvalRouter = router({
  create: publicProcedure.input(createApprovalSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const approval = await ctx.prisma.approval.create({
        data: {
          toolName: input.toolName,
          args: JSON.stringify(input.args),
          status: input.status,
        },
      });

      return success({
        data: formatApproval(approval),
        state: { totalApprovals: await ctx.prisma.approval.count() },
        nextSteps: [
          {
            action: "查看新创建的审批项",
            procedure: "approval.getById",
            input: { id: approval.id },
            reason: "可立即查看审批详情并进行审批。",
          },
        ],
        operation: "create",
        entity: "approval",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "approval", "APPROVAL_CREATE_FAILED");
    }
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const approval = await ctx.prisma.approval.findUnique({ where: { id: input.id } });
    if (!approval) {
      throw new TRPCError({ code: "NOT_FOUND", message: "审批项不存在" });
    }
    return formatApproval(approval);
  }),

  list: publicProcedure.input(listApprovalsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, status } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      ctx.prisma.approval.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      ctx.prisma.approval.count({ where }),
    ]);

    return {
      items: items.map(formatApproval),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateApprovalSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();
    const { id, status } = input;

    try {
      const existing = await ctx.prisma.approval.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "APPROVAL_NOT_FOUND",
          message: `更新 Approval 失败：id 为 "${id}" 的审批项不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 approval.list 查询可用审批项，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "approval.list",
            input: { pageSize: 20 },
            reason: "列出最近审批项以获取正确的 id。",
          },
          operation: "update",
          entity: "approval",
          durationMs: Date.now() - start,
        });
      }

      const approval = await ctx.prisma.approval.update({
        where: { id },
        data: { status },
      });

      return success({
        data: formatApproval(approval),
        state: { totalApprovals: await ctx.prisma.approval.count() },
        operation: "update",
        entity: "approval",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "approval", "APPROVAL_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.approval.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "APPROVAL_NOT_FOUND",
          message: `删除 Approval 失败：id 为 "${input.id}" 的审批项不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 approval.list 确认要删除的审批项 id。",
          retryable: false,
          suggestedAction: {
            procedure: "approval.list",
            input: { pageSize: 20 },
            reason: "列出审批项以获取正确的 id。",
          },
          operation: "delete",
          entity: "approval",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.approval.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, toolName: existing.toolName },
        state: { totalApprovals: await ctx.prisma.approval.count() },
        operation: "delete",
        entity: "approval",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "approval", "APPROVAL_DELETE_FAILED");
    }
  }),
});
