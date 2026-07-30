/**
 * run tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRunSchema, updateRunSchema, listRunsSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const runRouter = router({
  create: publicProcedure.meta({ description: "记录 Agent 执行。", aiReadable: true }).input(createRunSchema).mutation(({ ctx, input }) => ctx.services.run.create(input)),
  getById: publicProcedure.meta({ description: "获取执行记录详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.run.getById(input.id)),
  list: publicProcedure.meta({ description: "列出执行记录，支持按 agentId/status 过滤。", aiReadable: true }).input(listRunsSchema).query(({ ctx, input }) => ctx.services.run.list(input)),
  update: publicProcedure.meta({ description: "更新执行记录状态/结果。", aiReadable: true }).input(updateRunSchema).mutation(({ ctx, input }) => ctx.services.run.update(input)),
  delete: publicProcedure.meta({ description: "删除执行记录。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.run.delete(input.id)),
  exportTrace: publicProcedure
    .meta({
      description: "导出 Run 轨迹为 JSONL（Run 元数据 + 关联会话消息），供离线评测。",
      aiReadable: true,
    })
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { exportRunTraceJsonl } = await import("../runTraceExport.js");
      try {
        return await exportRunTraceJsonl(ctx.prisma, input.id);
      } catch (err) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
});

