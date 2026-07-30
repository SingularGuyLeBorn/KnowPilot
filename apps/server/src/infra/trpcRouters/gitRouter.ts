import { z } from "zod";
/**
 * git tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import {
  createGitRepoSchema, updateGitRepoSchema, listGitReposSchema, gitRepoPathSchema, gitLogSchema, gitDiffSchema,
  gitCommitWithApprovalSchema, gitPullWithApprovalSchema, gitPushWithApprovalSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { withApprovalGuard } from "./withApprovalGuard.js";

export const gitRouter = router({
  create: publicProcedure.meta({ description: "注册 Git 仓库。path 必须唯一。", aiReadable: true }).input(createGitRepoSchema).mutation(({ ctx, input }) => ctx.services.git.create(input)),
  getById: publicProcedure.meta({ description: "获取 Git 仓库详情。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).query(({ ctx, input }) => ctx.services.git.getById(input.id)),
  list: publicProcedure.meta({ description: "列出所有已注册的 Git 仓库。", aiReadable: true }).input(listGitReposSchema).query(({ ctx, input }) => ctx.services.git.list(input)),
  update: publicProcedure.meta({ description: "更新 Git 仓库配置。", aiReadable: true }).input(updateGitRepoSchema).mutation(({ ctx, input }) => ctx.services.git.update(input)),
  delete: publicProcedure.meta({ description: "删除 Git 仓库注册记录。", aiReadable: true }).input(z.object({ id: z.string().cuid() })).mutation(({ ctx, input }) => ctx.services.git.delete(input.id)),
  status: publicProcedure.meta({ description: "查看 Git 工作区状态。", aiReadable: true }).input(gitRepoPathSchema).query(({ ctx, input }) => ctx.services.git.status(input)),
  log: publicProcedure.meta({ description: "查看 Git 提交历史。", aiReadable: true }).input(gitLogSchema).query(({ ctx, input }) => ctx.services.git.log(input)),
  diff: publicProcedure.meta({ description: "查看 Git diff。", aiReadable: true }).input(gitDiffSchema).query(({ ctx, input }) => ctx.services.git.diff(input)),
  commit: publicProcedure.meta({ description: "Git add -A 并提交（需审批）。", aiReadable: true }).input(gitCommitWithApprovalSchema).mutation(({ ctx, input }) => {
    const { approvalId, ...gitArgs } = input;
    return withApprovalGuard(ctx.services, "git.commit", gitArgs as Record<string, unknown>, approvalId, () => ctx.services.git.commit(gitArgs as any));
  }),
  pull: publicProcedure.meta({ description: "Git pull（需审批）。", aiReadable: true }).input(gitPullWithApprovalSchema).mutation(({ ctx, input }) => {
    const { approvalId, ...gitArgs } = input;
    return withApprovalGuard(ctx.services, "git.pull", gitArgs as Record<string, unknown>, approvalId, () => ctx.services.git.pull(gitArgs as any));
  }),
  push: publicProcedure.meta({ description: "Git push。", aiReadable: true }).input(gitPushWithApprovalSchema).mutation(({ ctx, input }) => {
    const { approvalId, ...gitArgs } = input;
    return withApprovalGuard(ctx.services, "git.push", gitArgs as Record<string, unknown>, approvalId, () => ctx.services.git.push(gitArgs));
  }),
});

