/**
 * 集成域 — git_*（从 integration.ts 拆出，P2-01 选 B）
 *
 * 本地 + 远端 Git 仓库操作：clone/pull/push 均与远端交互，本地只读命令一并收拢避免拆散。
 */
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveSafePath, assertPathWithinProjectRoot } from "../../../safePath.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";
import { z } from "zod";
import { zodParams } from "../zodParams.js";

const execFileAsync = promisify(execFile);

async function resolveRepoPath(ctx: NativeToolContext, repoId?: string, repoPath?: string): Promise<string> {
  if (repoPath) return resolveSafePath(ctx.config, repoPath);
  if (repoId) {
    const repo = await ctx.services.git.getById(repoId);
    // 安全：DB 里的 repo.path 也必须校验在 projectRoot 之内，防止注册阶段绕过沙箱
    assertPathWithinProjectRoot(ctx.config, repo.path);
    return repo.path;
  }
  return ctx.config.projectRoot;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return (stdout || stderr || "").trim();
}

async function gitStatusTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  return { path: cwd, status: await runGit(cwd, ["status", "--porcelain", "-b"]) };
}

async function gitLogTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  const limit = String(args.limit || 10);
  const output = await runGit(cwd, ["log", `--max-count=${limit}`, "--oneline", "--decorate"]);
  return { path: cwd, log: output.split("\n").filter(Boolean) };
}

async function gitDiffTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  const gitArgs = args.staged ? ["diff", "--cached"] : ["diff"];
  return { path: cwd, diff: (await runGit(cwd, gitArgs)).slice(0, 12000) };
}

async function gitCommitTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  const message = String(args.message || "").trim();
  if (!message) throw new Error("提交信息 message 不能为空");
  await runGit(cwd, ["add", "-A"]);
  const output = await runGit(cwd, ["commit", "-m", message]);
  return { path: cwd, output };
}

async function gitPullTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  return { path: cwd, output: await runGit(cwd, ["pull"]) };
}

async function gitPushTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  return { path: cwd, output: await runGit(cwd, ["push"]) };
}

async function gitBranchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  const output = await runGit(cwd, args.all === true ? ["branch", "-a"] : ["branch"]);
  const branches = output
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      name: line.replace(/^[*+]\s+/, "").trim(),
      current: line.startsWith("*"),
    }));
  return { path: cwd, branches };
}

async function gitCheckoutTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const cwd = await resolveRepoPath(ctx, args.repoId as string | undefined, args.repoPath as string | undefined);
  const branch = String(args.branch || "").trim();
  if (!branch) throw new Error("branch 不能为空");
  const output = await runGit(cwd, args.create === true ? ["checkout", "-b", branch] : ["checkout", branch]);
  return { path: cwd, branch, output };
}

async function gitCloneTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 不能为空");
  try {
    new URL(url);
  } catch {
    throw new Error(`无效的仓库 URL: ${url}`);
  }
  const destRel = String(args.dest || "").trim();
  if (!destRel) throw new Error("dest 不能为空");
  const destAbs = resolveSafePath(ctx.config, destRel);
  if (fs.existsSync(destAbs)) throw new Error(`目标目录已存在: ${destRel}`);
  const parent = path.dirname(destAbs);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  const { stdout, stderr } = await execFileAsync("git", ["clone", url, destAbs], {
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return { url, dest: destRel, output: (stdout || stderr || "").trim() };
}

export const gitDefs: NativeToolDefinition[] = [
  {
    name: "git_branch",
    reentrant: true, // 本地只读 git 命令
    description: "查看 Git 仓库分支列表。",
    parameters: zodParams(
      z.object({
        repoId: z.string().describe("已注册 GitRepo 的 id").optional(),
        repoPath: z.string().describe("或直接指定本地仓库路径").optional(),
        all: z.boolean().describe("是否包含远程分支，默认 false").optional(),
      }),
    ),
  },
  {
    name: "git_checkout",
    description: "切换或新建并切换 Git 分支。",
    parameters: zodParams(
      z.object({
        repoId: z.string().describe("已注册 GitRepo 的 id").optional(),
        repoPath: z.string().describe("或直接指定本地仓库路径").optional(),
        branch: z.string().describe("分支名"),
        create: z.boolean().describe("是否新建分支，默认 false").optional(),
      }),
    ),
  },
  {
    name: "git_clone",
    description: "克隆远程 Git 仓库到项目根目录内的指定子目录。",
    parameters: zodParams(
      z.object({
        url: z.string().describe("仓库 HTTPS/SSH URL"),
        dest: z.string().describe("项目内目标相对目录，如 repos/foo"),
      }),
    ),
  },
  {
    name: "git_status",
    reentrant: true, // 本地只读 git 命令
    description: "查看 Git 仓库工作区状态。",
    parameters: zodParams(
      z.object({
        repoId: z.string().describe("已注册 GitRepo 的 id").optional(),
        repoPath: z.string().describe("或直接指定本地仓库路径").optional(),
      }),
    ),
  },
  {
    name: "git_log",
    reentrant: true, // 本地只读 git 命令
    description: "查看 Git 提交历史。",
    parameters: zodParams(
      z.object({
        repoId: z.string().optional(),
        repoPath: z.string().optional(),
        limit: z.number().describe("条数，默认 10").optional(),
      }),
    ),
  },
  {
    name: "git_diff",
    reentrant: true, // 本地只读 git 命令
    description: "查看 Git 工作区 diff。",
    parameters: zodParams(
      z.object({
        repoId: z.string().optional(),
        repoPath: z.string().optional(),
        staged: z.boolean().describe("是否只看暂存区").optional(),
      }),
    ),
  },
  {
    name: "git_commit",
    concurrencyClass: "D",
    // 不可逆：run 失败只记 warn「需人工 revert」，如实声明不假装能回滚
    destructive: true,
    description: "Git add -A 并提交当前仓库变更。",
    parameters: zodParams(
      z.object({
        repoId: z.string().describe("已注册 GitRepo 的 id").optional(),
        repoPath: z.string().describe("或直接指定本地仓库路径").optional(),
        message: z.string().describe("提交信息"),
      }),
    ),
  },
  {
    name: "git_pull",
    description: "Git pull 拉取远程更新。",
    parameters: zodParams(
      z.object({
        repoId: z.string().optional(),
        repoPath: z.string().optional(),
      }),
    ),
  },
  {
    name: "git_push",
    description: "Git push 推送本地提交到远程。",
    parameters: zodParams(
      z.object({
        repoId: z.string().optional(),
        repoPath: z.string().optional(),
      }),
    ),
  },
];

export const gitHandlers: Record<string, NativeToolHandler> = {
  git_status: gitStatusTool,
  git_branch: gitBranchTool,
  git_checkout: gitCheckoutTool,
  git_clone: gitCloneTool,
  git_log: gitLogTool,
  git_diff: gitDiffTool,
  git_commit: gitCommitTool,
  git_pull: gitPullTool,
  git_push: gitPushTool,
};
