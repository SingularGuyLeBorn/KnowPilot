/**
 * deadLetter tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const deadLetterRouter = router({
  list: publicProcedure
    .meta({ description: "列出邮件回复死信（未匹配 pending 的邮件回复，审计用）。", aiReadable: true })
    .input(z.object({ status: z.enum(["pending", "reviewed", "all"]).default("all"), limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const where = input?.status === "all" ? {} : { status: input?.status ?? "all" };
      const items = await ctx.prisma.deadLetterMail.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
      });
      return { items, total: items.length };
    }),
  review: publicProcedure
    .meta({ description: "标记死信为已审阅。", aiReadable: false })
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.deadLetterMail.updateMany({
        where: { id: input.id, status: "pending" },
        data: { status: "reviewed", reviewedAt: new Date() },
      });
      return { success: true };
    }),
  clear: publicProcedure
    .meta({ description: "清空已审阅的死信（pending 保留）。", aiReadable: false })
    .mutation(async ({ ctx }) => {
      const result = await ctx.prisma.deadLetterMail.deleteMany({ where: { status: "reviewed" } });
      return { success: true, deleted: result.count };
    }),
});
