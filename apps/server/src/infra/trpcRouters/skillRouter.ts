/**
 * skill tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { withApprovalGuard } from "./withApprovalGuard.js";
import { createSkillSchema, updateSkillSchema, listSkillsSchema, deleteByIdWithApprovalSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const skillRouter = router({
  create: publicProcedure.meta({ description: "创建技能。name 必须唯一。", aiReadable: true }).input(createSkillSchema).mutation(({ ctx, input }) => ctx.services.skill.create(input)),
  getById: publicProcedure.meta({ description: "获取技能详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.skill.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有技能，支持分页和过滤。", aiReadable: true }).input(listSkillsSchema).query(({ ctx, input }) => ctx.services.skill.list(input)),
  update: publicProcedure.meta({ description: "更新技能配置。", aiReadable: true }).input(updateSkillSchema).mutation(({ ctx, input }) => ctx.services.skill.update(input)),
  delete: publicProcedure.meta({ description: "删除技能及其本地配置文件。", aiReadable: true }).input(deleteByIdWithApprovalSchema).mutation(({ ctx, input }) =>
    withApprovalGuard(ctx.services, "skill.delete", { id: input.id }, input.approvalId, () => ctx.services.skill.delete(input.id)),
  ),
});
