/**
 * tool tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { createToolSchema, updateToolSchema, listToolsSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const toolRouter = router({
  create: publicProcedure.meta({ description: "注册工具。name 必须唯一。", aiReadable: true }).input(createToolSchema).mutation(({ ctx, input }) => ctx.services.tool.create(input)),
  getById: publicProcedure.meta({ description: "获取工具详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.tool.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有工具，支持按 type/enabled 过滤。", aiReadable: true }).input(listToolsSchema).query(({ ctx, input }) => ctx.services.tool.list(input)),
  update: publicProcedure.meta({ description: "更新工具配置。", aiReadable: true }).input(updateToolSchema).mutation(({ ctx, input }) => ctx.services.tool.update(input)),
  delete: publicProcedure.meta({ description: "删除工具注册。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.tool.delete(input.id)),
});
