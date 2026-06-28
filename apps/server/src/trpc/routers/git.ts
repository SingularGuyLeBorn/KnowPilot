import { TRPCError } from "@trpc/server";
import { createGitRepoSchema, updateGitRepoSchema, listGitReposSchema } from "@knowpilot/shared";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { success, failure, failureFromError } from "../result.js";

export const gitRouter = router({
  create: publicProcedure.input(createGitRepoSchema).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.gitRepo.findUnique({ where: { path: input.path } });
      if (existing) {
        return failure({
          code: "GIT_REPO_PATH_CONFLICT",
          message: `创建 Git Repo 失败：path "${input.path}" 已被 id 为 "${existing.id}" 的仓库登记。`,
          details: { path: input.path, existingGitRepoId: existing.id },
          field: "path",
          suggestion: "请登记一个不同的仓库路径，或先删除/修改冲突的仓库记录。",
          retryable: false,
          suggestedAction: {
            procedure: "git.list",
            input: { pageSize: 20 },
            reason: "列出已有仓库以确认可用路径。",
          },
          operation: "create",
          entity: "gitRepo",
          durationMs: Date.now() - start,
        });
      }

      const repo = await ctx.prisma.gitRepo.create({
        data: input,
      });

      return success({
        data: repo,
        state: { totalGitRepos: await ctx.prisma.gitRepo.count() },
        nextSteps: [
          {
            action: "查看新登记的仓库",
            procedure: "git.getById",
            input: { id: repo.id },
            reason: "可立即查看仓库详情。",
          },
        ],
        operation: "create",
        entity: "gitRepo",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "create", "gitRepo", "GIT_REPO_CREATE_FAILED");
    }
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
    const start = Date.now();
    const { id, ...data } = input;

    try {
      const existing = await ctx.prisma.gitRepo.findUnique({ where: { id } });
      if (!existing) {
        return failure({
          code: "GIT_REPO_NOT_FOUND",
          message: `更新 Git Repo 失败：id 为 "${id}" 的仓库记录不存在。`,
          details: { id },
          field: "id",
          suggestion: "请调用 git.list 查询可用仓库，或使用正确的 id。",
          retryable: false,
          suggestedAction: {
            procedure: "git.list",
            input: { pageSize: 20 },
            reason: "列出最近仓库以获取正确的 id。",
          },
          operation: "update",
          entity: "gitRepo",
          durationMs: Date.now() - start,
        });
      }

      const repo = await ctx.prisma.gitRepo.update({
        where: { id },
        data,
      });

      return success({
        data: repo,
        state: { totalGitRepos: await ctx.prisma.gitRepo.count() },
        operation: "update",
        entity: "gitRepo",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "update", "gitRepo", "GIT_REPO_UPDATE_FAILED");
    }
  }),

  delete: publicProcedure.input(z.object({ id: z.string().cuid() })).mutation(async ({ ctx, input }) => {
    const start = Date.now();

    try {
      const existing = await ctx.prisma.gitRepo.findUnique({ where: { id: input.id } });
      if (!existing) {
        return failure({
          code: "GIT_REPO_NOT_FOUND",
          message: `删除 Git Repo 失败：id 为 "${input.id}" 的仓库记录不存在。`,
          details: { id: input.id },
          field: "id",
          suggestion: "请调用 git.list 确认要删除的仓库 id。",
          retryable: false,
          suggestedAction: {
            procedure: "git.list",
            input: { pageSize: 20 },
            reason: "列出仓库以获取正确的 id。",
          },
          operation: "delete",
          entity: "gitRepo",
          durationMs: Date.now() - start,
        });
      }

      await ctx.prisma.gitRepo.delete({ where: { id: input.id } });

      return success({
        data: { id: input.id, path: existing.path },
        state: { totalGitRepos: await ctx.prisma.gitRepo.count() },
        operation: "delete",
        entity: "gitRepo",
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return failureFromError(error, "delete", "gitRepo", "GIT_REPO_DELETE_FAILED");
    }
  }),
});
