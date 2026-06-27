import { TRPCError } from "@trpc/server";
import { createGitRepoSchema, updateGitRepoSchema, listGitReposSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const gitRouter = router({
  create: publicProcedure.input(createGitRepoSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.gitRepo.findUnique({ where: { path: input.path } });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "该路径下的仓库已登记" });
    }

    return ctx.prisma.gitRepo.create({
      data: input,
    });
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const repo = await ctx.prisma.gitRepo.findUnique({ where: { id: input.id } });
    if (!repo) {
      throw new TRPCError({ code: "NOT_FOUND", message: "仓库记录不存在" });
    }
    return repo;
  }),

  list: publicProcedure.input(listGitReposSchema).query(async ({ ctx, input }) => {
    const { page, pageSize } = input;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      ctx.prisma.gitRepo.findMany({
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.gitRepo.count(),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateGitRepoSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const existing = await ctx.prisma.gitRepo.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "仓库记录不存在" });
    }

    return ctx.prisma.gitRepo.update({
      where: { id },
      data,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.gitRepo.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "仓库记录不存在" });
    }

    await ctx.prisma.gitRepo.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
