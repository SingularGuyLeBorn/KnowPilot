import { TRPCError } from "@trpc/server";
import { createApprovalSchema, updateApprovalSchema, listApprovalsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

function formatApproval(approval: any) {
  return {
    ...approval,
    args: approval.args ? (typeof approval.args === 'string' ? JSON.parse(approval.args) : approval.args) : {},
  };
}

export const approvalRouter = router({
  create: publicProcedure.input(createApprovalSchema).mutation(async ({ ctx, input }) => {
    const approval = await ctx.prisma.approval.create({
      data: {
        toolName: input.toolName,
        args: JSON.stringify(input.args),
        status: input.status,
      },
    });

    return formatApproval(approval);
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
    const { id, status } = input;

    const existing = await ctx.prisma.approval.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "审批项不存在" });
    }

    const approval = await ctx.prisma.approval.update({
      where: { id },
      data: { status },
    });

    return formatApproval(approval);
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.approval.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "审批项不存在" });
    }

    await ctx.prisma.approval.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
