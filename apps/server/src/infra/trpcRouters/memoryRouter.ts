/**
 * memory tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { withApprovalGuard } from "./withApprovalGuard.js";
import { createMemorySchema, updateMemorySchema, listMemoriesSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const memoryRouter = router({
  create: publicProcedure.meta({ description: "创建长期记忆条目。", aiReadable: true }).input(createMemorySchema).mutation(({ ctx, input }) => ctx.services.memory.create(input)),
  getById: publicProcedure.meta({ description: "获取记忆详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.memory.getById(input.id)),
  list: publicProcedure.meta({ description: "列出记忆，支持按 type/keyword 过滤。", aiReadable: true }).input(listMemoriesSchema).query(({ ctx, input }) => ctx.services.memory.list(input)),
  update: publicProcedure.meta({ description: "更新记忆条目。", aiReadable: true }).input(updateMemorySchema).mutation(({ ctx, input }) => ctx.services.memory.update(input)),
  delete: publicProcedure.meta({ description: "删除记忆条目。", aiReadable: true }).input(z.object({ id: z.string().cuid(), approvalId: z.string().cuid().optional() })).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "memory.delete", { id: input.id }, input.approvalId, () => ctx.services.memory.delete(input.id)),
  ),
});
