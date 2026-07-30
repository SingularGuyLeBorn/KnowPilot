/**
 * task tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createTaskSchema, updateTaskSchema, listTasksSchema, runTaskSchema, deleteByIdWithApprovalSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { withApprovalGuard } from "./withApprovalGuard.js";

export const taskRouter = router({
  create: publicProcedure.meta({ description: "创建后台任务。", aiReadable: true }).input(createTaskSchema).mutation(({ ctx, input }) => ctx.services.task.create(input)),
  getById: publicProcedure.meta({ description: "获取任务详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.task.getById(input.id)),
  list: publicProcedure.meta({ description: "列出任务，支持按 status 过滤。", aiReadable: true }).input(listTasksSchema).query(({ ctx, input }) => ctx.services.task.list(input)),
  update: publicProcedure.meta({ description: "更新任务状态或配置。", aiReadable: true }).input(updateTaskSchema).mutation(({ ctx, input }) => ctx.services.task.update(input)),
  delete: publicProcedure.meta({ description: "删除任务。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "task.delete", { id: input.id }, input.approvalId, () => ctx.services.task.delete(input.id)),
  ),
  run: publicProcedure.meta({ description: "立即执行后台任务（如同步 content/ 到 SQLite）。", aiReadable: true }).input(runTaskSchema).mutation(({ ctx, input }) => ctx.services.task.run(input.id)),
});

