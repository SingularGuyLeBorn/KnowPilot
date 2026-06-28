import { TRPCError } from "@trpc/server";
import { createSkillSchema, updateSkillSchema, listSkillsSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const skillRouter = router({
  create: publicProcedure.input(createSkillSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.skill.findUnique({ where: { name: input.name } });
      if (existing) {
        return failure({
          code: "SKILL_NAME_CONFLICT",
          message: `创建 Skill 失败：name "${input.name}" 已被 id 为 "${existing.id}" 的 Skill 占用。`,
          details: { name: input.name, existingSkillId: existing.id },
          field: "name",
          suggestion: "请指定一个不同的 Skill 名称，或先修改冲突 Skill 的名称。",
          retryable: false,
          suggestedAction: {
            procedure: "skill.list",
            input: { pageSize: 20 },
            reason: "列出已有 Skill 以确认可用名称。",
          },
          operation: "create",
          entity: "skill",
          durationMs: Date.now() - start,
        });
      }

      const skill = await ctx.prisma.skill.create({
        data: input,
      });

      return success({
        data: skill,
        state: { totalSkills: await ctx.prisma.skill.count() },
        nextSteps: [
          {
            action: "查看新创建的 Skill",
            procedure: "skill.getById",
            input: { id: skill.id },
            reason: "可立即查看 Skill 详情并进行配置。",
          },
        ],
        operation: "create",
        entity: "skill",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "skill", "SKILL_CREATE_FAILED");
    }
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
    const start = Date.now();
    const { id, name, ...data } = input;

    try {
      const existing = await ctx.prisma.skill.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "SKILL_NOT_FOUND",
          message: `更新 Skill 失败：id 为 "${id}" 的 Skill 不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 skill.list 查询可用 Skill，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "skill.list",
            input: { pageSize: 20 },
            reason: "列出最近 Skill 以获取正确的 id。",
          },
          operation: "update",
          entity: "skill",
          durationMs: Date.now() - start,
        });
      }

      if (name !== undefined && name !== existing.name) {
        const nameConflict = await ctx.prisma.skill.findUnique({ where: { name } });
        if (nameConflict) {
          return failure({
            code: "SKILL_NAME_CONFLICT",
            message: `更新 Skill 失败：name "${name}" 已被 id 为 "${nameConflict.id}" 的 Skill 占用。`,
            details: { name, existingSkillId: nameConflict.id },
            field: "name",
            suggestion: "请指定一个不同的 Skill 名称，或先修改冲突 Skill 的名称。",
            retryable: false,
            suggestedAction: {
              procedure: "skill.list",
              input: { pageSize: 20 },
              reason: "列出已有 Skill 以确认可用名称。",
            },
            operation: "update",
            entity: "skill",
            durationMs: Date.now() - start,
          });
        }
      }

      const skill = await ctx.prisma.skill.update({
        where: { id },
        data: { ...data, name },
      });

      return success({
        data: skill,
        state: { totalSkills: await ctx.prisma.skill.count() },
        operation: "update",
        entity: "skill",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "skill", "SKILL_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.skill.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "SKILL_NOT_FOUND",
          message: `删除 Skill 失败：id 为 "${input.id}" 的 Skill 不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 skill.list 确认要删除的 Skill id。",
          retryable: false,
          suggestedAction: {
            procedure: "skill.list",
            input: { pageSize: 20 },
            reason: "列出 Skill 以获取正确的 id。",
          },
          operation: "delete",
          entity: "skill",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.skill.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, name: existing.name },
        state: { totalSkills: await ctx.prisma.skill.count() },
        nextSteps: [
          {
            action: "创建新 Skill",
            procedure: "skill.create",
            reason: "已删除的 Skill 无法恢复，可创建新 Skill 替代。",
          },
        ],
        operation: "delete",
        entity: "skill",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "skill", "SKILL_DELETE_FAILED");
    }
  }),
});
