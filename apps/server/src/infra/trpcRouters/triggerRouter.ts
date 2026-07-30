/**
 * trigger tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { createTriggerSchema, updateTriggerSchema, listTriggersSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const triggerRouter = router({
  create: publicProcedure.meta({ description: "创建触发器。name 必须唯一。", aiReadable: true }).input(createTriggerSchema).mutation(({ ctx, input }) => ctx.services.trigger.create(input)),
  getById: publicProcedure.meta({ description: "获取触发器详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.trigger.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有触发器。", aiReadable: true }).input(listTriggersSchema).query(({ ctx, input }) => ctx.services.trigger.list(input)),
  update: publicProcedure.meta({ description: "更新触发器配置。", aiReadable: true }).input(updateTriggerSchema).mutation(({ ctx, input }) => ctx.services.trigger.update(input)),
  delete: publicProcedure.meta({ description: "删除触发器。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.trigger.delete(input.id)),
});

/** Agent 自设 cron（与 Trigger.type=cron / 心跳正交）：每次点火新建 briefing 会话 */
