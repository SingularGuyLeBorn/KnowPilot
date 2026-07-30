/**
 * prompt tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { createPromptSchema, updatePromptSchema, listPromptsSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const promptRouter = router({
  create: publicProcedure.meta({ description: "创建提示词模板。name 必须唯一。", aiReadable: true }).input(createPromptSchema).mutation(({ ctx, input }) => ctx.services.prompt.create(input)),
  getById: publicProcedure.meta({ description: "获取提示词模板详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.prompt.getById(input.id)),
  list: publicProcedure.meta({ description: "列出提示词模板，支持按 tag 过滤。", aiReadable: true }).input(listPromptsSchema).query(({ ctx, input }) => ctx.services.prompt.list(input)),
  update: publicProcedure.meta({ description: "更新提示词模板。", aiReadable: true }).input(updatePromptSchema).mutation(({ ctx, input }) => ctx.services.prompt.update(input)),
  delete: publicProcedure.meta({ description: "删除提示词模板。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.prompt.delete(input.id)),
});
