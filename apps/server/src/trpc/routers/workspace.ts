import { TRPCError } from "@trpc/server";
import { createWorkspaceSchema, updateWorkspaceSchema, listWorkspacesSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const workspaceRouter = router({
  create: publicProcedure.input(createWorkspaceSchema).mutation(async ({ ctx, input }) => {
    const existingName = await ctx.prisma.workspace.findUnique({ where: { name: input.name } });
    if (existingName) {
      throw new TRPCError({ code: "CONFLICT", message: "工作区名称已存在" });
    }

    const existingPath = await ctx.prisma.workspace.findUnique({ where: { path: input.path } });
    if (existingPath) {
      throw new TRPCError({ code: "CONFLICT", message: "该目录路径已被注册为工作区" });
    }

    return ctx.prisma.workspace.create({
      data: input,
    });
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const workspace = await ctx.prisma.workspace.findUnique({ where: { id: input.id } });
    if (!workspace) {
      throw new TRPCError({ code: "NOT_FOUND", message: "工作区不存在" });
    }
    return workspace;
  }),

  list: publicProcedure.input(listWorkspacesSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.workspace.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.workspace.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateWorkspaceSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const existing = await ctx.prisma.workspace.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "工作区不存在" });
    }

    // 检查名称唯一性
    if (data.name && data.name !== existing.name) {
      const existingName = await ctx.prisma.workspace.findUnique({ where: { name: data.name } });
      if (existingName) {
        throw new TRPCError({ code: "CONFLICT", message: "工作区名称已存在" });
      }
    }

    // 检查路径唯一性
    if (data.path && data.path !== existing.path) {
      const existingPath = await ctx.prisma.workspace.findUnique({ where: { path: data.path } });
      if (existingPath) {
        throw new TRPCError({ code: "CONFLICT", message: "该目录路径已被注册为工作区" });
      }
    }

    return ctx.prisma.workspace.update({
      where: { id },
      data,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.workspace.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "工作区不存在" });
    }

    await ctx.prisma.workspace.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
