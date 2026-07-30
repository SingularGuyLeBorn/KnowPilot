/**
 * approval tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createApprovalSchema, updateApprovalSchema, listApprovalsSchema,
  executeApprovalSchema, approveAndExecuteApprovalSchema,
  approveAndExecuteBatchSchema, rejectApprovalsBatchSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { executeApprovedOperation } from "../approvalGate.js";

export const approvalRouter = router({
  create: publicProcedure.meta({ description: "创建审批请求。", aiReadable: true }).input(createApprovalSchema).mutation(({ ctx, input }) => ctx.services.approval.create(input)),
  getById: publicProcedure.meta({ description: "获取审批详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.approval.getById(input.id)),
  list: publicProcedure.meta({ description: "列出审批队列，支持按 status 过滤。", aiReadable: true }).input(listApprovalsSchema).query(({ ctx, input }) => ctx.services.approval.list(input)),
  /** 人类待办摘要：pending 数 + TTL 配置（人不在场绝不自动执行） */
  humanTodoSummary: publicProcedure
    .meta({ description: "待你点头队列摘要（pending 数 / TTL）。", aiReadable: false })
    .query(async ({ ctx }) => {
      const { getApprovalPendingTtlMs } = await import("../approvalGate.js");
      const pending = await ctx.services.prisma.approval.count({ where: { status: "pending" } });
      const ttlMs = getApprovalPendingTtlMs();
      return {
        pendingCount: pending,
        ttlMs,
        neverAutoExecute: true as const,
        hint:
          ttlMs <= 0
            ? "TTL 已关闭：pending 会一直挂着，绝不会自动执行"
            : `超过 ${Math.round(ttlMs / 3_600_000)} 小时未处理将自动拒绝（不会执行）`,
      };
    }),
  update: publicProcedure.meta({ description: "更新审批状态（approved/rejected）。", aiReadable: true }).input(updateApprovalSchema).mutation(({ ctx, input }) => ctx.services.approval.update(input)),
  delete: publicProcedure.meta({ description: "删除审批记录。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.approval.delete(input.id)),
  execute: publicProcedure.meta({ description: "执行已通过审批的危险操作。", aiReadable: true }).input(executeApprovalSchema).mutation(({ ctx, input }) => executeApprovedOperation(ctx, input.id)),
  approveAndExecute: publicProcedure.meta({ description: "批准并立即执行审批请求。", aiReadable: true }).input(approveAndExecuteApprovalSchema).mutation(async ({ ctx, input }) => {
    await ctx.services.approval.update({ id: input.id, status: "approved" });
    return executeApprovedOperation(ctx, input.id);
  }),
  approveAndExecuteBatch: publicProcedure
    .meta({ description: "批量批准并执行（待你点头一键批）。", aiReadable: false })
    .input(approveAndExecuteBatchSchema)
    .mutation(async ({ ctx, input }) => {
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of input.ids) {
        try {
          await ctx.services.approval.update({ id, status: "approved" });
          const exec = await executeApprovedOperation(ctx, id);
          results.push({
            id,
            ok: Boolean(exec.success),
            error: exec.success ? undefined : exec.error?.message,
          });
        } catch (err) {
          results.push({
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return {
        success: results.every((r) => r.ok),
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }),
  rejectBatch: publicProcedure
    .meta({ description: "批量拒绝审批（待你点头一键拒）。", aiReadable: false })
    .input(rejectApprovalsBatchSchema)
    .mutation(async ({ ctx, input }) => {
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of input.ids) {
        try {
          await ctx.services.approval.update({ id, status: "rejected" });
          results.push({ id, ok: true });
        } catch (err) {
          results.push({
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return {
        success: results.every((r) => r.ok),
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }),
});

