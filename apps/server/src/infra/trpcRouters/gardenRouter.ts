/**
 * Garden tRPC 子路由（从 router.ts 拆出的叶子）。
 * 纪律：低耦合域可拆至 infra/trpcRouters/；禁止平行 trpc/routers/ 树与兼容 re-export。
 */

import {
  createGardenSchema,
  updateGardenSchema,
  listGardensSchema,
  getGardenByIdSchema,
  deleteGardenSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const gardenRouter = router({
  list: publicProcedure
    .meta({ description: "分页列出知识库花园。", aiReadable: true })
    .input(listGardensSchema)
    .query(({ ctx, input }) => ctx.services.garden.list(input)),
  getById: publicProcedure
    .meta({ description: "获取花园详情与首页正文。", aiReadable: true })
    .input(getGardenByIdSchema)
    .query(({ ctx, input }) => ctx.services.garden.getById(input.id)),
  create: publicProcedure
    .meta({ description: "新建知识库花园（content/{id}/_garden.md）。", aiReadable: true })
    .input(createGardenSchema)
    .mutation(({ ctx, input }) => ctx.services.garden.create(input)),
  update: publicProcedure
    .meta({ description: "更新花园标题/说明/首页。", aiReadable: true })
    .input(updateGardenSchema)
    .mutation(({ ctx, input }) => ctx.services.garden.update(input)),
  delete: publicProcedure
    .meta({ description: "软删除空花园（种子库不可删；进 content/.trash/gardens/）。", aiReadable: true })
    .input(deleteGardenSchema)
    .mutation(({ ctx, input }) => ctx.services.garden.delete(input.id)),
  restore: publicProcedure
    .meta({ description: "从 content/.trash/gardens/ 恢复已软删花园。", aiReadable: true })
    .input(deleteGardenSchema)
    .mutation(({ ctx, input }) => ctx.services.garden.restore(input.id)),
});
