/**
 * infoSource tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import {
  createInfoSourceSchema,
  updateInfoSourceSchema,
  listInfoSourcesSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const infoSourceRouter = router({
  create: publicProcedure.meta({ description: "创建信息源（可信信息来源配置）。", aiReadable: true }).input(createInfoSourceSchema).mutation(({ ctx, input }) => ctx.services.infoSource.create(input)),
  getById: publicProcedure.meta({ description: "获取信息源详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.infoSource.getById(input.id)),
  list: publicProcedure.meta({ description: "列出信息源，支持类型/标签/可信度筛选。", aiReadable: true }).input(listInfoSourcesSchema).query(({ ctx, input }) => ctx.services.infoSource.list(input)),
  update: publicProcedure.meta({ description: "更新信息源配置。", aiReadable: true }).input(updateInfoSourceSchema).mutation(({ ctx, input }) => ctx.services.infoSource.update(input)),
  delete: publicProcedure.meta({ description: "删除信息源。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.infoSource.delete(input.id)),
  fetch: publicProcedure
    .meta({ description: "手动触发 RSS/Atom 信息源抓取。", aiReadable: true })
    .input(z.object({ id: z.string().cuid(), maxItems: z.number().int().min(1).max(50).optional(), autoDraft: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { fetchRssSource } = await import("../rssFetch.js");
      return fetchRssSource(ctx.prisma, input.id, {
        maxItems: input.maxItems ?? 20,
        timeoutMs: 20000,
      });
    }),
  fetchDue: publicProcedure
    .meta({ description: "抓取所有到期的 RSS 信息源。", aiReadable: true })
    .input(z.object({ maxItems: z.number().int().min(1).max(50).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { fetchDueRssSources } = await import("../rssFetch.js");
      return fetchDueRssSources(ctx.prisma, { maxItems: input.maxItems ?? 20, timeoutMs: 20000 });
    }),
});
