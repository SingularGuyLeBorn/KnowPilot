import { TRPCError } from "@trpc/server";
import { createFileSchema, updateFileSchema, listFilesSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const fileRouter = router({
  create: publicProcedure.input(createFileSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.file.create({
      data: input,
    });
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const file = await ctx.prisma.file.findUnique({ where: { id: input.id } });
    if (!file) {
      throw new TRPCError({ code: "NOT_FOUND", message: "文件记录不存在" });
    }
    return file;
  }),

  list: publicProcedure.input(listFilesSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.name = { contains: keyword };
    }

    const [items, total] = await Promise.all([
      ctx.prisma.file.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      ctx.prisma.file.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateFileSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const existing = await ctx.prisma.file.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "文件记录不存在" });
    }

    return ctx.prisma.file.update({
      where: { id },
      data,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.file.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "文件记录不存在" });
    }

    // 注意：在此处仅删除数据库记录。物理文件删除可根据实际业务进一步补充。
    await ctx.prisma.file.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
