import { TRPCError } from "@trpc/server";
import { createSkillSchema, updateSkillSchema, listSkillsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const skillRouter = router({
  create: publicProcedure.input(createSkillSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.skill.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "技能名称已存在" });
    }

    return ctx.prisma.skill.create({
      data: input,
    });
  }),

  getById: publicProcedure.input(z.object({ id: z.string().cuid() })).query(async ({ ctx, input }) => {
    const skill = await ctx.prisma.skill.findUnique({ where: { id: input.id } });
    if (!skill) {
      throw new TRPCError({ code: "NOT_FOUND", message: "技能不存在" });
    }
    return skill;
  }),

  list: publicProcedure.input(listSkillsSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, keyword, enabled } = input;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (enabled !== undefined) where.enabled = enabled;
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }

    const [items, total] = await Promise.all([
      ctx.prisma.skill.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      ctx.prisma.skill.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }),

  update: publicProcedure.input(updateSkillSchema).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const existing = await ctx.prisma.skill.findUnique({ where: { id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "技能不存在" });
    }

    return ctx.prisma.skill.update({
      where: { id },
      data,
    });
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.skill.findUnique({ where: { id: input.id } });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "技能不存在" });
    }

    await ctx.prisma.skill.delete({ where: { id: input.id } });
    return { success: true };
  }),
});
