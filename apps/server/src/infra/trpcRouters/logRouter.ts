/**
 * log tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { createLogSchema, updateLogSchema, listLogsSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const logRouter = router({
  create: publicProcedure.meta({ description: "创建日志记录。", aiReadable: true }).input(createLogSchema).mutation(({ ctx, input }) => ctx.services.log.create(input)),
  getById: publicProcedure.meta({ description: "获取日志详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.log.getById(input.id)),
  list: publicProcedure.meta({ description: "分页列出日志，支持按 level/component/keyword 过滤。", aiReadable: true }).input(listLogsSchema).query(({ ctx, input }) => ctx.services.log.list(input)),
  update: publicProcedure.meta({ description: "更新日志（一般不建议）。", aiReadable: false }).input(updateLogSchema).mutation(({ ctx, input }) => ctx.services.log.update(input)),
  delete: publicProcedure.meta({ description: "删除单条日志。", aiReadable: false }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.log.delete(input.id)),
  clearAll: publicProcedure.meta({ description: "一键清空日志审计库。", aiReadable: false }).mutation(({ ctx }) => ctx.services.log.clearAll()),
});
