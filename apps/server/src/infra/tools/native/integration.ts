/**
 * Native 集成域 — git_*（本地+远端仓库操作）/ yuque_* / github_* / feishu_* / send_email / 浏览器登录态
 *
 * PR-4c：从 nativeTools.ts 迁出，handler 与 schema 保持原语义不变。
 * git_* 归此域：clone/pull/push 均与远端交互，本地只读命令一并收拢避免拆散。
 */
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveSafePath, assertPathWithinProjectRoot } from "../../safePath.js";
import {
  getGitHubToken,
  parseRepo,
  githubGetRepo,
  githubCreateRepo,
  githubUpdateRepo,
  githubDeleteRepo,
  githubGetFile,
  githubCreateFile,
  githubUpdateFile,
  githubDeleteFile,
  githubListIssues,
  githubGetIssue,
  githubCreateIssue,
  githubUpdateIssue,
  githubCreateIssueComment,
  githubListPullRequests,
  githubGetPullRequest,
  githubCreatePullRequest,
  githubUpdatePullRequest,
  githubMergePullRequest,
  githubListBranches,
  githubGetBranch,
  githubCreateBranch,
  githubDeleteBranch,
  githubListWorkflows,
  githubTriggerWorkflow,
  githubCreateRelease,
  githubSearchRepos,
} from "../../githubClient.js";
import { executeGitHubTool, listGitHubTools } from "../../external/githubToolExecutor.js";
import {
  feishuSendText,
  feishuSendMessage,
  feishuGetDoc,
  feishuCreateDoc,
  feishuUpdateDocBlocks,
  feishuUpdateDocTitle,
  feishuCreateDocChildren,
  feishuAppendDocText,
  feishuDeleteDoc,
  feishuSearchDocs,
  feishuGetWikiSpace,
  feishuGetWikiNodes,
  feishuCreateWikiNode,
  feishuCreateSpreadsheet,
  feishuAppendSpreadsheetValues,
  feishuListDocWhiteboards,
  feishuListWhiteboardNodes,
  feishuCreateWhiteboardNodes,
  feishuWhiteboardFromDiagram,
  feishuDeleteWhiteboardNodes,
  feishuGetWhiteboardTheme,
  feishuUpdateWhiteboardTheme,
  feishuListPermissionMembers,
  feishuAddPermissionMember,
  feishuUpdatePermissionMember,
  feishuRemovePermissionMember,
  feishuGetPermissionPublic,
  feishuUpdatePermissionPublic,
  feishuBatchGetUserIds,
  feishuAddCollaboratorByContact,
  getUserAccessTokenStatus,
  refreshUserAccessToken,
} from "../../feishuClient.js";
import type { FeishuPermissionPublicPatch } from "../../feishuClient.js";
import { getCredentialValue } from "../../credentialVault.js";
import { sendEmailNotification } from "../../emailNotifier.js";
import {
  authorizeUserViaBrowser,
  refreshTokenManually as refreshFileToken,
  getTokenStatus as getFeishuFileTokenStatus,
} from "../../external/larkTokenManager.js";
import {
  getYuqueCredentials,
  getYuquePersonalToken,
  yuqueListBooks,
  yuqueGetBookToc,
  yuqueCreateBook,
  yuqueUpdateBook,
  yuqueDeleteBook,
  yuqueGetDocWeb,
  yuqueCreateDoc,
  yuqueUpdateDoc,
  yuqueDeleteDoc,
  yuqueListRepos,
  yuqueCreateRepo,
  yuqueUpdateRepo,
  yuqueDeleteRepo,
  yuqueListDocs,
  yuqueGetDocV2,
  yuqueCreateDocV2,
  yuqueUpdateDocV2,
  yuqueDeleteDocV2,
  yuqueProbeSession,
} from "../../yuqueClient.js";
import { captureZhihuLoginState } from "../../metablog/auth/zhihuLogin.js";
import { listSavedCookiePlatforms, loadCookies } from "../../cookieJar.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { z } from "zod";
import { zodParams } from "./zodParams.js";
import { registerNativeDomain } from "./registerDomain.js";

const execFileAsync = promisify(execFile);

// ─── Git 仓库操作（本地 + 远端）───

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

// ─── 语雀 ───

async function yuqueGetDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // Web：bookId + slug；Open API：namespace + slug
  if (args.bookId) {
    const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
    const data = await yuqueGetDocWeb(String(args.slug), String(args.bookId), credentials);
    const doc = (data as { data?: { title?: string; slug?: string; body?: string; content?: string } })?.data ?? data;
    const body = (doc as { body?: string; content?: string }).body || (doc as { content?: string }).content || "";
    return {
      title: (doc as { title?: string }).title,
      slug: (doc as { slug?: string }).slug,
      body: String(body).slice(0, 12000),
      via: "web",
    };
  }
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  const data = (await yuqueGetDocV2(String(args.namespace), String(args.slug), token)) as {
    title?: string;
    slug?: string;
    body?: string;
  };
  return { title: data.title, slug: data.slug, body: (data.body || "").slice(0, 12000), via: "open_api_v2" };
}

async function yuqueListBooksTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueListBooks(credentials);
}

async function yuqueGetBookTocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueGetBookToc(String(args.bookId), credentials);
}

async function yuqueCreateBookTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueCreateBook(
    String(args.name),
    {
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
      slug: args.slug ? String(args.slug) : undefined,
    },
    credentials,
  );
}

async function yuqueUpdateBookTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueUpdateBook(
    String(args.bookId),
    {
      name: args.name ? String(args.name) : undefined,
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
    },
    credentials,
  );
}

async function yuqueDeleteBookTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueDeleteBook(String(args.bookId), credentials);
}

async function yuqueCreateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueCreateDoc(String(args.bookId), String(args.title), String(args.body), credentials);
}

async function yuqueUpdateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueUpdateDoc(String(args.docId), String(args.bookId), String(args.title), String(args.body), credentials);
}

async function yuqueDeleteDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueDeleteDoc(String(args.docId), String(args.bookId), credentials);
}

async function yuqueSessionStatusTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueProbeSession(credentials);
}

async function yuqueListReposTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueListRepos(token);
}

async function yuqueCreateRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueCreateRepo(
    String(args.name),
    {
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
      slug: args.slug ? String(args.slug) : undefined,
    },
    token,
  );
}

async function yuqueUpdateRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueUpdateRepo(
    String(args.namespace),
    {
      name: args.name ? String(args.name) : undefined,
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
    },
    token,
  );
}

async function yuqueDeleteRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueDeleteRepo(String(args.namespace), token);
}

async function yuqueListDocsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueListDocs(String(args.namespace), token);
}

async function yuqueCreateDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueCreateDocV2(String(args.namespace), String(args.title), String(args.body), token);
}

async function yuqueUpdateDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueUpdateDocV2(String(args.namespace), String(args.slug), String(args.title), String(args.body), token);
}

async function yuqueDeleteDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueDeleteDocV2(String(args.namespace), String(args.slug), token);
}

// ─── 浏览器登录态 ───

async function captureZhihuLoginTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  return captureZhihuLoginState(Number(args.timeoutSec || 120));
}

async function browserLoginStatusTool(_args: Record<string, unknown>, _ctx: NativeToolContext) {
  const platforms = listSavedCookiePlatforms();
  return {
    platforms,
    details: platforms.map((p) => ({ platform: p, cookieCount: loadCookies(p).length })),
  };
}

// ─── GitHub ───

async function githubSearchReposTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = getGitHubToken(ctx.config);
  const data = (await githubSearchRepos(String(args.query), Number(args.limit || 5), token)) as {
    items?: Array<{ full_name: string; html_url: string; description: string; stargazers_count: number }>;
  };
  return (data.items || []).map((r) => ({ name: r.full_name, url: r.html_url, description: r.description, stars: r.stargazers_count }));
}

async function githubGetRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubGetRepo(owner, repoName, getGitHubToken(ctx.config));
}

async function githubCreateRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return githubCreateRepo(
    String(args.name),
    {
      description: args.description ? String(args.description) : undefined,
      private: args.private === true,
      autoInit: args.autoInit === true,
    },
    getGitHubToken(ctx.config),
  );
}

async function githubUpdateRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubUpdateRepo(
    owner,
    repoName,
    {
      description: args.description ? String(args.description) : undefined,
      private: args.private === true ? true : args.private === false ? false : undefined,
      default_branch: args.defaultBranch ? String(args.defaultBranch) : undefined,
    },
    getGitHubToken(ctx.config),
  );
}

async function githubDeleteRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  await githubDeleteRepo(owner, repoName, getGitHubToken(ctx.config));
  return { repo: `${owner}/${repoName}`, deleted: true };
}

async function githubGetFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  const file = await githubGetFile(owner, repoName, String(args.path), args.ref ? String(args.ref) : undefined, getGitHubToken(ctx.config));
  return {
    name: file.name,
    path: file.path,
    sha: file.sha,
    htmlUrl: file.html_url,
    content: file.decodedContent,
  };
}

async function githubCreateFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubCreateFile(
    owner,
    repoName,
    String(args.path),
    String(args.content),
    String(args.message),
    args.branch ? String(args.branch) : undefined,
    getGitHubToken(ctx.config),
  );
}

async function githubUpdateFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubUpdateFile(
    owner,
    repoName,
    String(args.path),
    String(args.content),
    String(args.message),
    String(args.sha),
    args.branch ? String(args.branch) : undefined,
    getGitHubToken(ctx.config),
  );
}

async function githubDeleteFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubDeleteFile(
    owner,
    repoName,
    String(args.path),
    String(args.message),
    String(args.sha),
    args.branch ? String(args.branch) : undefined,
    getGitHubToken(ctx.config),
  );
}

async function githubListIssuesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  const items = (await githubListIssues(
    owner,
    repoName,
    (args.state as "open" | "closed" | "all") || "open",
    Number(args.perPage || 30),
    Number(args.page || 1),
    getGitHubToken(ctx.config),
  )) as Array<{ pull_request?: unknown }>;
  // GitHub Issues API 会混入 PR；默认过滤，只留真正的 issue
  return items.filter((i) => !i.pull_request);
}

async function githubGetIssueTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubGetIssue(owner, repoName, Number(args.number), getGitHubToken(ctx.config));
}

async function githubCreateIssueTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubCreateIssue(
    owner,
    repoName,
    String(args.title),
    args.body ? String(args.body) : undefined,
    Array.isArray(args.labels) ? args.labels.map(String) : undefined,
    getGitHubToken(ctx.config),
  );
}

async function githubUpdateIssueTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubUpdateIssue(
    owner,
    repoName,
    Number(args.number),
    {
      title: args.title ? String(args.title) : undefined,
      body: args.body ? String(args.body) : undefined,
      state: args.state as "open" | "closed" | undefined,
      labels: Array.isArray(args.labels) ? args.labels.map(String) : undefined,
    },
    getGitHubToken(ctx.config),
  );
}

async function githubListPullRequestsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubListPullRequests(
    owner,
    repoName,
    (args.state as "open" | "closed" | "all") || "open",
    Number(args.perPage || 30),
    Number(args.page || 1),
    getGitHubToken(ctx.config),
  );
}

async function githubGetPullRequestTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubGetPullRequest(owner, repoName, Number(args.number), getGitHubToken(ctx.config));
}

async function githubCreatePullRequestTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubCreatePullRequest(
    owner,
    repoName,
    String(args.title),
    String(args.head),
    String(args.base),
    args.body ? String(args.body) : undefined,
    getGitHubToken(ctx.config),
  );
}

async function githubUpdatePullRequestTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubUpdatePullRequest(
    owner,
    repoName,
    Number(args.number),
    {
      title: args.title ? String(args.title) : undefined,
      body: args.body ? String(args.body) : undefined,
      state: args.state as "open" | "closed" | undefined,
      base: args.base ? String(args.base) : undefined,
    },
    getGitHubToken(ctx.config),
  );
}

async function githubMergePullRequestTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubMergePullRequest(
    owner,
    repoName,
    Number(args.number),
    {
      commit_title: args.commitTitle ? String(args.commitTitle) : undefined,
      commit_message: args.commitMessage ? String(args.commitMessage) : undefined,
      merge_method: (args.mergeMethod as "merge" | "squash" | "rebase") || "merge",
    },
    getGitHubToken(ctx.config),
  );
}

async function githubCreateIssueCommentTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubCreateIssueComment(
    owner,
    repoName,
    Number(args.number),
    String(args.body),
    getGitHubToken(ctx.config),
  );
}

async function githubListBranchesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubListBranches(owner, repoName, Number(args.perPage || 30), Number(args.page || 1), getGitHubToken(ctx.config));
}

async function githubGetBranchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubGetBranch(owner, repoName, String(args.branch), getGitHubToken(ctx.config));
}

async function githubCreateBranchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubCreateBranch(owner, repoName, String(args.newBranch), String(args.fromBranch || "main"), getGitHubToken(ctx.config));
}

async function githubDeleteBranchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  await githubDeleteBranch(owner, repoName, String(args.branch), getGitHubToken(ctx.config));
  return { repo: `${owner}/${repoName}`, branch: String(args.branch), deleted: true };
}

async function githubListWorkflowsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubListWorkflows(owner, repoName, getGitHubToken(ctx.config));
}

async function githubTriggerWorkflowTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubTriggerWorkflow(
    owner,
    repoName,
    String(args.workflowId),
    String(args.ref || "main"),
    args.inputs && typeof args.inputs === "object" ? (args.inputs as Record<string, string>) : undefined,
    getGitHubToken(ctx.config),
  );
}

async function githubCreateReleaseTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { owner, repoName } = parseRepo(String(args.repo));
  return githubCreateRelease(
    owner,
    repoName,
    String(args.tagName),
    String(args.name),
    args.body ? String(args.body) : undefined,
    args.targetCommitish ? String(args.targetCommitish) : undefined,
    getGitHubToken(ctx.config),
  );
}

async function githubTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 兼容 snake_case（native）与 camelCase（executor）：github_create_issue → githubCreateIssue
  const raw = String(args.tool || "").trim();
  const tool = raw.includes("_")
    ? raw.split("_").map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join("")
    : raw;
  const params = (args.params || {}) as Record<string, unknown>;
  return executeGitHubTool(tool, params, getGitHubToken(ctx.config));
}

// ─── 飞书 ───

async function feishuSendTextTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuSendText(
    String(args.receiveId),
    String(args.receiveIdType || "open_id"),
    String(args.text),
    ctx.config,
  );
}

async function feishuSendMessageTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuSendMessage(
    String(args.receiveId),
    String(args.receiveIdType || "open_id"),
    String(args.msgType || "text"),
    (args.content || {}) as Record<string, unknown>,
    ctx.config,
  );
}

async function feishuGetDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetDoc(String(args.documentId), ctx.prisma, ctx.config);
}

async function feishuCreateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuCreateDoc(String(args.title), args.folderToken ? String(args.folderToken) : undefined, ctx.prisma, ctx.config);
}

async function feishuUpdateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const documentId = String(args.documentId);
  const title = args.title != null ? String(args.title) : undefined;
  const blocks = Array.isArray(args.blocks) ? (args.blocks as unknown[]) : undefined;
  if (!title && !blocks?.length) {
    throw new Error(
      "请提供 title 和/或 blocks（仅改已有 block 的 batch_update）。新建正文请用 feishu_append_doc_text / feishu_append_doc_blocks。",
    );
  }
  const results: Record<string, unknown> = {};
  if (title) results.title = await feishuUpdateDocTitle(documentId, title, ctx.prisma, ctx.config);
  if (blocks?.length) results.blocks = await feishuUpdateDocBlocks(documentId, blocks, ctx.prisma, ctx.config);
  return results;
}

async function feishuAppendDocTextTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAppendDocText(String(args.documentId), String(args.text ?? ""), ctx.prisma, ctx.config);
}

async function feishuAppendDocBlocksTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const children = Array.isArray(args.children) ? (args.children as unknown[]) : [];
  if (children.length === 0) throw new Error("children 不能为空");
  return feishuCreateDocChildren(
    String(args.documentId),
    children,
    {
      parentBlockId: args.parentBlockId != null ? String(args.parentBlockId) : undefined,
      index: args.index != null ? Number(args.index) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuDeleteDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuDeleteDoc(String(args.documentId), ctx.prisma, ctx.config);
}

async function feishuSearchDocsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuSearchDocs(String(args.query), ctx.prisma, ctx.config);
}

async function feishuCreateWikiNodeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuCreateWikiNode(
    String(args.spaceId),
    String(args.title),
    {
      parentNodeToken: args.parentNodeToken ? String(args.parentNodeToken) : undefined,
      objType: args.objType ? String(args.objType) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuGetWikiSpaceTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetWikiSpace(String(args.spaceId), ctx.prisma, ctx.config);
}

async function feishuGetWikiNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetWikiNodes(String(args.spaceId), args.parentNodeToken ? String(args.parentNodeToken) : undefined, ctx.prisma, ctx.config);
}

async function feishuCreateSpreadsheetTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuCreateSpreadsheet(String(args.title), args.folderToken ? String(args.folderToken) : undefined, ctx.prisma, ctx.config);
}

async function feishuAppendSpreadsheetValuesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAppendSpreadsheetValues(
    String(args.spreadsheetToken),
    String(args.range),
    (args.values || []) as unknown[],
    ctx.prisma,
    ctx.config,
  );
}

async function feishuTokenStatusTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return getUserAccessTokenStatus(ctx.prisma, ctx.config);
}

async function feishuListDocWhiteboardsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const boards = await feishuListDocWhiteboards(String(args.documentId), ctx.prisma, ctx.config);
  return { count: boards.length, boards };
}

async function feishuListWhiteboardNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuListWhiteboardNodes(String(args.whiteboardId), ctx.prisma, ctx.config);
}

async function feishuCreateWhiteboardNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const nodes = args.nodes;
  if (!Array.isArray(nodes)) throw new Error("nodes 必须是数组（board-v1 节点结构）");
  return feishuCreateWhiteboardNodes(
    String(args.whiteboardId),
    nodes,
    {
      overwrite: args.overwrite === true,
      clientToken: args.clientToken ? String(args.clientToken) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuWhiteboardFromDiagramTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const format = String(args.format || "mermaid") as "plantuml" | "mermaid" | "svg";
  if (!["plantuml", "mermaid", "svg"].includes(format)) {
    throw new Error("format 必须是 plantuml | mermaid | svg");
  }
  const code = String(args.code || "").trim();
  if (!code) throw new Error("code 不能为空");
  return feishuWhiteboardFromDiagram(
    String(args.whiteboardId),
    code,
    format,
    {
      overwrite: args.overwrite !== false, // 默认覆盖，避免叠一层旧图
      clientToken: args.clientToken ? String(args.clientToken) : undefined,
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuDeleteWhiteboardNodesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const ids = args.ids;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("ids 必须为非空字符串数组");
  return feishuDeleteWhiteboardNodes(
    String(args.whiteboardId),
    ids.map(String),
    { clientToken: args.clientToken ? String(args.clientToken) : undefined },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuGetWhiteboardThemeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetWhiteboardTheme(String(args.whiteboardId), ctx.prisma, ctx.config);
}

async function feishuUpdateWhiteboardThemeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuUpdateWhiteboardTheme(String(args.whiteboardId), String(args.theme), ctx.prisma, ctx.config);
}

async function feishuListPermissionMembersTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuListPermissionMembers(
    String(args.token),
    String(args.type || "docx"),
    ctx.prisma,
    ctx.config,
  );
}

async function feishuAddPermissionMemberTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAddPermissionMember(
    String(args.token),
    String(args.type || "docx"),
    {
      memberType: String(args.memberType || "openid"),
      memberId: String(args.memberId),
      perm: String(args.perm || "view"),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuUpdatePermissionMemberTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuUpdatePermissionMember(
    String(args.token),
    String(args.type || "docx"),
    {
      memberType: String(args.memberType || "openid"),
      memberId: String(args.memberId),
      perm: String(args.perm || "edit"),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuRemovePermissionMemberTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuRemovePermissionMember(
    String(args.token),
    String(args.type || "docx"),
    {
      memberType: String(args.memberType || "openid"),
      memberId: String(args.memberId),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuGetPermissionPublicTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuGetPermissionPublic(String(args.token), String(args.type || "docx"), ctx.prisma, ctx.config);
}

async function feishuUpdatePermissionPublicTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const patch: FeishuPermissionPublicPatch = {};
  const keys = [
    "external_access_entity",
    "security_entity",
    "comment_entity",
    "share_entity",
    "manage_collaborator_entity",
    "link_share_entity",
    "copy_entity",
  ] as const;
  for (const k of keys) {
    if (args[k] != null && String(args[k]).trim()) {
      (patch as Record<string, string>)[k] = String(args[k]).trim();
    }
  }
  if (!Object.keys(patch).length) {
    throw new Error(
      "请至少提供一项权限设置字段：external_access_entity / link_share_entity / share_entity / manage_collaborator_entity / copy_entity / security_entity / comment_entity",
    );
  }
  return feishuUpdatePermissionPublic(
    String(args.token),
    String(args.type || "docx"),
    patch,
    ctx.prisma,
    ctx.config,
  );
}

async function feishuLookupUserTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const mobiles = Array.isArray(args.mobiles)
    ? args.mobiles.map(String)
    : args.mobile
      ? [String(args.mobile)]
      : [];
  const emails = Array.isArray(args.emails)
    ? args.emails.map(String)
    : args.email
      ? [String(args.email)]
      : [];
  return feishuBatchGetUserIds(
    { mobiles, emails, includeResigned: args.includeResigned === true },
    ctx.config,
    ctx.prisma,
  );
}

async function feishuAddCollaboratorByContactTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuAddCollaboratorByContact(
    String(args.token),
    String(args.type || "docx"),
    {
      mobile: args.mobile != null ? String(args.mobile) : undefined,
      email: args.email != null ? String(args.email) : undefined,
      perm: String(args.perm || "view"),
    },
    ctx.prisma,
    ctx.config,
  );
}

async function feishuRefreshTokenTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const refreshToken = await getCredentialValue(ctx.prisma, "feishu", "feishu_refresh_token");
  if (refreshToken) {
    const token = await refreshUserAccessToken(ctx.prisma, refreshToken, ctx.config);
    return { success: true, source: "credential", token: token.slice(0, 8) + "..." };
  }
  const fileResult = await refreshFileToken();
  if (fileResult.success) return { source: "file", ...fileResult };
  return {
    source: "file",
    ...fileResult,
    success: false,
    hint: "refresh 失败时请调用 feishu_authorize（会打开浏览器，用户点一次同意即可落盘新 token）",
  };
}

/** 浏览器 OAuth：token 过期且无法 refresh 时由 Agent 自行拉起，无需人工改 .env */
async function feishuAuthorizeTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const timeoutSec = Number(args.timeoutSec || 180);
  const result = await authorizeUserViaBrowser({
    timeoutSec: Number.isFinite(timeoutSec) ? timeoutSec : 180,
    openBrowser: args.openBrowser !== false,
    scope: args.scope ? String(args.scope) : undefined,
  });
  if (!result.success) {
    throw new Error(
      result.error ||
        "飞书授权失败。请确认开放平台已添加重定向 http://localhost:8088，并开通 offline_access / 文档 / 画板权限。",
    );
  }
  const status = getFeishuFileTokenStatus();
  return {
    ...result,
    fileStatus: status,
    message:
      "授权成功，token 已写入 content/cookies/feishu_oauth.json。后续过期会自动 refresh；refresh 也失效时再调本工具。",
  };
}

// ─── 邮件通知工具 ───

async function sendEmailTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 发送通道单点实现见 infra/emailNotifier.ts（HeartbeatEngine 失败告警复用同一通道）
  return sendEmailNotification(ctx.config, ctx.services.log, {
    subject: String(args.subject || ""),
    body: String(args.body || ""),
    to: (args.to as string) || undefined,
    agentId: ctx.agentSnapshot?.id,
  });
}

const INTEGRATION_DEFS: NativeToolDefinition[] = [
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
  {
    name: "yuque_get_doc",
    reentrant: true,
    description:
      "读取语雀文档。优先 Web：传 bookId+slug（需 YUQUE_SESSION）；或 Open API：传 namespace+slug（需 YUQUE_TOKEN 个人令牌）。",
    parameters: zodParams(
      z.object({
        slug: z.string().describe("文档 slug"),
        bookId: z.string().describe("Web API：知识库 id").optional(),
        namespace: z.string().describe("Open API：如 user/repo").optional(),
      }),
    ),
  },
  {
    name: "yuque_list_books",
    reentrant: true,
    description: "列出语雀知识库（Web Cookie：YUQUE_SESSION + YUQUE_CTOKEN）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_get_book_toc",
    reentrant: true,
    description: "获取语雀知识库目录（Web Cookie）。",
    parameters: zodParams(z.object({ bookId: z.string() })),
  },
  {
    name: "yuque_create_book",
    concurrencyClass: "D",
    description: "创建语雀知识库（Web Cookie）。",
    parameters: zodParams(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        slug: z.string().optional(),
        public: z.number().describe("0 私密 / 1 公开，默认 0").optional(),
      }),
    ),
  },
  {
    name: "yuque_update_book",
    concurrencyClass: "D",
    description: "更新语雀知识库元信息（Web Cookie）。",
    parameters: zodParams(
      z.object({
        bookId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        public: z.number().optional(),
      }),
    ),
  },
  {
    name: "yuque_delete_book",
    concurrencyClass: "D",
    destructive: true,
    description: "删除语雀知识库（Web Cookie，不可恢复）。",
    parameters: zodParams(z.object({ bookId: z.string() })),
  },
  {
    name: "yuque_create_doc",
    description: "在语雀知识库创建文档（Web Cookie）。",
    parameters: zodParams(
      z.object({
        bookId: z.string(),
        title: z.string(),
        body: z.string().describe("Markdown 内容"),
      }),
    ),
  },
  {
    name: "yuque_update_doc",
    description: "更新语雀文档（Web Cookie）。",
    parameters: zodParams(
      z.object({
        docId: z.string(),
        bookId: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    ),
  },
  {
    name: "yuque_delete_doc",
    destructive: true,
    description: "删除语雀文档（Web Cookie）。",
    parameters: zodParams(
      z.object({
        docId: z.string(),
        bookId: z.string(),
      }),
    ),
  },
  {
    name: "yuque_session_status",
    reentrant: true,
    description: "探测语雀 Cookie 会话是否仍有效（list_books 轻量探测）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_list_repos",
    reentrant: true,
    description: "列出语雀知识库（Open API v2，需 YUQUE_TOKEN 个人令牌，不是网页 _ctoken）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_create_repo",
    concurrencyClass: "D",
    description: "创建语雀知识库（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        slug: z.string().optional(),
        public: z.number().optional(),
      }),
    ),
  },
  {
    name: "yuque_update_repo",
    concurrencyClass: "D",
    description: "更新语雀知识库（Open API v2）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        public: z.number().optional(),
      }),
    ),
  },
  {
    name: "yuque_delete_repo",
    concurrencyClass: "D",
    destructive: true,
    description: "删除语雀知识库（Open API v2）。",
    parameters: zodParams(z.object({ namespace: z.string() })),
  },
  {
    name: "yuque_list_docs",
    reentrant: true,
    description: "列出语雀知识库文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(z.object({ namespace: z.string() })),
  },
  {
    name: "yuque_create_doc_v2",
    description: "创建语雀文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    ),
  },
  {
    name: "yuque_update_doc_v2",
    description: "更新语雀文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        slug: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    ),
  },
  {
    name: "yuque_delete_doc_v2",
    destructive: true,
    description: "删除语雀文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        slug: z.string(),
      }),
    ),
  },
  {
    name: "capture_zhihu_login",
    description:
      "弹出浏览器登录知乎：写 storageState + 同步 cookieJar（content/cookies/zhihu.json），供 read_article HTTP/Playwright 复用。",
    parameters: zodParams(
      z.object({
        timeoutSec: z.number().describe("等待超时秒数，默认 120").optional(),
      }),
    ),
  },
  {
    name: "browser_login_status",
    reentrant: true, // 只读 cookieJar 状态
    description: "列出已保存的浏览器登录态平台及 cookie 条数（含知乎 cookieJar）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "github_search_repos",
    reentrant: true, // 远端 GET 只读
    description: "在 GitHub 搜索公开仓库。",
    parameters: zodParams(
      z.object({
        query: z.string(),
        limit: z.number().describe("默认 5").optional(),
      }),
    ),
  },
  {
    name: "github_get_repo",
    reentrant: true, // 远端 GET 只读
    description: "获取 GitHub 仓库详情。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
      }),
    ),
  },
  {
    name: "github_create_repo",
    description: "创建 GitHub 仓库（需要 token 有 repo 或 public_repo 权限）。",
    parameters: zodParams(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        private: z.boolean().describe("默认 false").optional(),
        autoInit: z.boolean().describe("是否自动初始化 README，默认 false").optional(),
      }),
    ),
  },
  {
    name: "github_update_repo",
    description: "更新 GitHub 仓库元信息。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        description: z.string().optional(),
        private: z.boolean().optional(),
        defaultBranch: z.string().optional(),
      }),
    ),
  },
  {
    name: "github_delete_repo",
    concurrencyClass: "D",
    destructive: true,
    description: "删除 GitHub 仓库（不可恢复，需 delete_repo 权限）。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
      }),
    ),
  },
  {
    name: "github_get_file",
    reentrant: true, // 远端 GET 只读
    description: "读取 GitHub 仓库文件内容（Base64 自动解码）。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        path: z.string(),
        ref: z.string().describe("分支/tag/sha，默认默认分支").optional(),
      }),
    ),
  },
  {
    name: "github_create_file",
    description: "在 GitHub 仓库创建文件。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        path: z.string(),
        content: z.string(),
        message: z.string(),
        branch: z.string().optional(),
      }),
    ),
  },
  {
    name: "github_update_file",
    description: "更新 GitHub 仓库文件（需要先获取 sha）。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        path: z.string(),
        content: z.string(),
        message: z.string(),
        sha: z.string(),
        branch: z.string().optional(),
      }),
    ),
  },
  {
    name: "github_delete_file",
    destructive: true,
    description: "删除 GitHub 仓库文件。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        path: z.string(),
        message: z.string(),
        sha: z.string(),
        branch: z.string().optional(),
      }),
    ),
  },
  {
    name: "github_list_issues",
    reentrant: true, // 远端 GET 只读
    concurrencyClass: "B",
    description: "列出 GitHub 仓库 Issues。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        state: z.enum(["open", "closed", "all"]).describe("默认 open").optional(),
        perPage: z.number().describe("默认 30").optional(),
        page: z.number().describe("默认 1").optional(),
      }),
    ),
  },
  {
    name: "github_get_issue",
    reentrant: true, // 远端 GET 只读
    concurrencyClass: "B",
    description: "获取单个 GitHub Issue 详情。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        number: z.number(),
      }),
    ),
  },
  {
    name: "github_create_issue",
    description: "创建 GitHub Issue。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        title: z.string(),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
      }),
    ),
  },
  {
    name: "github_update_issue",
    description: "更新 GitHub Issue（状态/标题/正文/标签）。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        number: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        labels: z.array(z.string()).optional(),
      }),
    ),
  },
  {
    name: "github_list_pull_requests",
    reentrant: true, // 远端 GET 只读
    concurrencyClass: "B",
    description: "列出 GitHub 仓库 Pull Requests。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        state: z.enum(["open", "closed", "all"]).describe("默认 open").optional(),
        perPage: z.number().describe("默认 30").optional(),
        page: z.number().describe("默认 1").optional(),
      }),
    ),
  },
  {
    name: "github_get_pull_request",
    reentrant: true, // 远端 GET 只读
    concurrencyClass: "B",
    description: "获取单个 GitHub Pull Request 详情。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        number: z.number(),
      }),
    ),
  },
  {
    name: "github_create_pull_request",
    concurrencyClass: "D",
    description: "创建 GitHub Pull Request。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        title: z.string(),
        head: z.string().describe("源分支"),
        base: z.string().describe("目标分支"),
        body: z.string().optional(),
      }),
    ),
  },
  {
    name: "github_update_pull_request",
    concurrencyClass: "D",
    description: "更新 PR（标题/正文/目标分支）；state=closed 关闭，state=open 重开。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        number: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        base: z.string().optional(),
      }),
    ),
  },
  {
    name: "github_merge_pull_request",
    concurrencyClass: "D",
    destructive: true,
    description: "合并 Pull Request（merge / squash / rebase）。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        number: z.number(),
        mergeMethod: z.enum(["merge", "squash", "rebase"]).describe("默认 merge").optional(),
        commitTitle: z.string().optional(),
        commitMessage: z.string().optional(),
      }),
    ),
  },
  {
    name: "github_create_issue_comment",
    concurrencyClass: "D",
    description: "在 Issue 或 PR 下发表评论。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        number: z.number().describe("Issue/PR 编号"),
        body: z.string(),
      }),
    ),
  },
  {
    name: "github_list_branches",
    reentrant: true, // 远端 GET 只读
    concurrencyClass: "B",
    description: "列出 GitHub 仓库分支。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        perPage: z.number().describe("默认 30").optional(),
        page: z.number().describe("默认 1").optional(),
      }),
    ),
  },
  {
    name: "github_get_branch",
    reentrant: true, // 远端 GET 只读
    concurrencyClass: "B",
    description: "获取 GitHub 分支详情。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        branch: z.string(),
      }),
    ),
  },
  {
    name: "github_create_branch",
    concurrencyClass: "D",
    description: "基于已有分支创建新分支。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        newBranch: z.string(),
        fromBranch: z.string().describe("默认 main").optional(),
      }),
    ),
  },
  {
    name: "github_delete_branch",
    concurrencyClass: "D",
    destructive: true,
    description: "删除 GitHub 分支（删除 refs/heads/{branch}）。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        branch: z.string(),
      }),
    ),
  },
  {
    name: "github_list_workflows",
    reentrant: true, // 远端 GET 只读
    concurrencyClass: "B",
    description: "列出 GitHub Actions 工作流。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
      }),
    ),
  },
  {
    name: "github_trigger_workflow",
    concurrencyClass: "D",
    description: "触发 GitHub Actions 工作流 dispatch 事件。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        workflowId: z.string().describe("工作流 ID 或文件名"),
        ref: z.string().describe("触发分支，默认 main").optional(),
        inputs: z.record(z.unknown()).describe("工作流输入参数").optional(),
      }),
    ),
  },
  {
    name: "github_create_release",
    concurrencyClass: "D",
    description: "创建 GitHub Release。",
    parameters: zodParams(
      z.object({
        repo: z.string().describe("仓库，格式 owner/repo"),
        tagName: z.string(),
        name: z.string(),
        body: z.string().optional(),
        targetCommitish: z.string().describe("目标分支或 commit").optional(),
      }),
    ),
  },
  {
    name: "github_tool",
    concurrencyClass: "D",
    description: `调用完整版 GitHub 工具集（MetaBlog 全量）。可用 tool 名称：${listGitHubTools().join(", ")}。`,
    parameters: zodParams(
      z.object({
        tool: z.string().describe("GitHub 工具名，如 github_create_issue"),
        params: z.record(z.unknown()).describe("该工具所需参数"),
      }),
    ),
  },
  {
    name: "feishu_send_text",
    concurrencyClass: "D",
    description: "向飞书用户/群发送文本（优先 tenant token；也支持 user token）。",
    parameters: zodParams(
      z.object({
        receiveId: z.string().describe("接收者 open_id / chat_id"),
        receiveIdType: z.enum(["open_id", "chat_id", "user_id"]).describe("默认 open_id").optional(),
        text: z.string(),
      }),
    ),
  },
  {
    name: "feishu_send_message",
    concurrencyClass: "D",
    description: "向飞书发送任意类型消息（text/post/image/interactive 等）。",
    parameters: zodParams(
      z.object({
        receiveId: z.string(),
        receiveIdType: z.enum(["open_id", "chat_id", "user_id"]).describe("默认 open_id").optional(),
        msgType: z.string().describe("消息类型：text/post/image/interactive"),
        content: z.record(z.unknown()).describe("消息内容对象"),
      }),
    ),
  },
  {
    name: "feishu_get_doc",
    concurrencyClass: "B",
    description: "获取飞书文档详情（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_create_doc",
    concurrencyClass: "D",
    description: "创建飞书文档（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        title: z.string(),
        folderToken: z.string().describe("可选父文件夹 token").optional(),
      }),
    ),
  },
  {
    name: "feishu_update_doc",
    concurrencyClass: "D",
    description:
      "仅改标题或已有块：title 和/或 blocks（docx batch_update requests，必须带已有 block_id）。" +
      "新建段落/表格/画板禁止用本工具——请用 feishu_append_doc_text 或 feishu_append_doc_blocks。需 user_access_token。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
        title: z.string().optional(),
        blocks: z
          .array(z.unknown())
          .describe("可选：batch_update requests（改已有块）；新建内容勿传")
          .optional(),
      }),
    ),
  },
  {
    name: "feishu_append_doc_text",
    reentrant: true,
    concurrencyClass: "D",
    description:
      "【写正文首选】把 Markdown 追加到飞书文档末尾：服务端解析为原生块（标题/加粗/列表/分割线/代码/公式/表格）。" +
      "普通块走 docx children；GFM 表格对标 MetaBlog：建空表 → PATCH 各 cell 自带 text child（原生表格，不是管道符）。" +
      "规范：段落顶格；标题 `# `（# 后空格）；无序列表只用 `- `；加粗 `**重点**`；分割线 `---`；" +
      "表格须含表头+`|---|` 分隔行+数据行（≤9×9）；行内公式 `$...$`、块级 `$$...$$`。" +
      "禁止把 `#`/`**`/`|...|` 当纯文本指望飞书渲染。create_doc 后立刻用本工具灌内容。需 user_access_token。",
    parameters: zodParams(
      z.object({
        documentId: z.string().describe("文档 document_id；Wiki 节点用返回的 obj_token"),
        text: z
          .string()
          .describe("Markdown 全文（含 GFM 表格/公式会转成飞书原生块；非 raw 字符串堆叠）"),
      }),
    ),
  },
  {
    name: "feishu_append_doc_blocks",
    concurrencyClass: "D",
    description:
      "在文档根（或指定父块）下创建子块。用于画板壳 block_type:43 board:{}、标题块、表格壳等。" +
      "普通长文优先 feishu_append_doc_text。示例 children: [{block_type:2,text:{elements:[{text_run:{content:\"hi\"}}]}},{block_type:43,board:{}}]。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
        children: z.array(z.unknown()).describe("docx children 块数组（单次最多 50）"),
        parentBlockId: z.string().describe("父块 id，默认=documentId（根）").optional(),
        index: z.number().describe("插入位置，默认末尾").optional(),
      }),
    ),
  },
  {
    name: "feishu_delete_doc",
    concurrencyClass: "D",
    destructive: true,
    description: "删除飞书云文档（drive files DELETE，type=docx）。需 user_access_token；可能走审批。",
    parameters: zodParams(
      z.object({
        documentId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_search_docs",
    concurrencyClass: "B",
    description: "搜索飞书文档（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        query: z.string(),
      }),
    ),
  },
  {
    name: "feishu_list_permission_members",
    reentrant: true,
    concurrencyClass: "B",
    description: "列出飞书云文档协作者（drive permissions members）。token 为 document_id / 文件 token；type 默认 docx。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("云文档 token（docx 即 document_id）"),
        type: z
          .enum(["doc", "docx", "sheet", "file", "wiki", "bitable", "folder", "mindnote", "minutes", "slides"])
          .describe("默认 docx")
          .optional(),
      }),
    ),
  },
  {
    name: "feishu_add_permission_member",
    concurrencyClass: "D",
    description:
      "为飞书云文档添加协作者。memberType：openid/email/openchat/unionid 等；perm：view/edit/full_access。需 docs:permission.member:create。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("云文档 token"),
        type: z.string().describe("默认 docx").optional(),
        memberType: z.string().describe("默认 openid").optional(),
        memberId: z.string().describe("与 memberType 对应的协作者 ID / 邮箱"),
        perm: z.enum(["view", "edit", "full_access"]).describe("默认 view").optional(),
      }),
    ),
  },
  {
    name: "feishu_update_permission_member",
    concurrencyClass: "D",
    description: "更新飞书云文档协作者权限（view→edit 等）。需 docs:permission.member:update。",
    parameters: zodParams(
      z.object({
        token: z.string(),
        type: z.string().describe("默认 docx").optional(),
        memberType: z.string().describe("默认 openid").optional(),
        memberId: z.string(),
        perm: z.enum(["view", "edit", "full_access"]).describe("默认 edit").optional(),
      }),
    ),
  },
  {
    name: "feishu_remove_permission_member",
    concurrencyClass: "D",
    destructive: true,
    description: "移除飞书云文档协作者。需 docs:permission.member:delete；可能走审批。",
    parameters: zodParams(
      z.object({
        token: z.string(),
        type: z.string().describe("默认 docx").optional(),
        memberType: z.string().describe("默认 openid").optional(),
        memberId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_get_permission_public",
    reentrant: true,
    concurrencyClass: "B",
    description:
      "读取飞书云文档「权限设置」（可见性）：外部分享、链接分享、谁可管理协作者/复制/打印下载/评论等。对应 UI 权限设置面板。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("document_id / 文件 token"),
        type: z.string().describe("默认 docx").optional(),
      }),
    ),
  },
  {
    name: "feishu_update_permission_public",
    concurrencyClass: "D",
    description:
      "更新飞书云文档「权限设置」（增量）。字段映射 UI：external_access_entity=允许分享到组织外；link_share_entity=链接分享；" +
      "share_entity+manage_collaborator_entity=谁可查看/添加/移除协作者；copy_entity=谁可复制；security_entity=谁可创建副本/打印/下载；comment_entity=谁可评论。" +
      "示例：组织内链接可读 → link_share_entity=tenant_readable；互联网可读 → external_access_entity=open + link_share_entity=anyone_readable。",
    parameters: zodParams(
      z.object({
        token: z.string(),
        type: z.string().describe("默认 docx").optional(),
        external_access_entity: z.enum(["open", "closed", "allow_share_partner_tenant"]).optional(),
        link_share_entity: z
          .enum([
            "tenant_readable",
            "tenant_editable",
            "partner_tenant_readable",
            "partner_tenant_editable",
            "anyone_readable",
            "anyone_editable",
            "closed",
          ])
          .optional(),
        share_entity: z.enum(["anyone", "same_tenant"]).optional(),
        manage_collaborator_entity: z
          .enum(["collaborator_can_view", "collaborator_can_edit", "collaborator_full_access"])
          .optional(),
        copy_entity: z.enum(["anyone_can_view", "anyone_can_edit", "only_full_access"]).optional(),
        security_entity: z.enum(["anyone_can_view", "anyone_can_edit", "only_full_access"]).optional(),
        comment_entity: z.enum(["anyone_can_view", "anyone_can_edit"]).optional(),
      }),
    ),
  },
  {
    name: "feishu_lookup_user",
    reentrant: true,
    concurrencyClass: "B",
    description:
      "用手机号/邮箱查飞书用户 open_id（contact batch_get_id，应用身份）。加协作者前可先查。" +
      "需开通 contact:user.id:readonly（或 contact:contact:readonly_as_app）并发布。仅邮箱时可直接 add_permission_member(memberType=email)。",
    parameters: zodParams(
      z.object({
        mobile: z.string().describe("单个手机号").optional(),
        email: z.string().describe("单个邮箱").optional(),
        mobiles: z.array(z.string()).optional(),
        emails: z.array(z.string()).optional(),
        includeResigned: z.boolean().optional(),
      }),
    ),
  },
  {
    name: "feishu_add_collaborator_by_contact",
    concurrencyClass: "D",
    description:
      "用手机号或邮箱把用户加为文档协作者并设权限（view/edit/full_access）。邮箱直加；手机号先查 open_id 再加。" +
      "手机号路径需通讯录查 ID 权限。",
    parameters: zodParams(
      z.object({
        token: z.string().describe("document_id"),
        type: z.string().describe("默认 docx").optional(),
        mobile: z.string().optional(),
        email: z.string().optional(),
        perm: z.enum(["view", "edit", "full_access"]).describe("默认 view").optional(),
      }),
    ),
  },
  {
    name: "feishu_get_wiki_space",
    concurrencyClass: "B",
    description: "获取飞书 Wiki 空间信息（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        spaceId: z.string(),
      }),
    ),
  },
  {
    name: "feishu_get_wiki_nodes",
    concurrencyClass: "B",
    description: "获取飞书 Wiki 节点列表（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        spaceId: z.string(),
        parentNodeToken: z.string().describe("可选父节点 token").optional(),
      }),
    ),
  },
  {
    name: "feishu_create_wiki_node",
    concurrencyClass: "D",
    description: "在飞书 Wiki 空间创建节点（默认 obj_type=docx）。需 user_access_token。",
    parameters: zodParams(
      z.object({
        spaceId: z.string(),
        title: z.string(),
        parentNodeToken: z.string().describe("可选父节点 token").optional(),
        objType: z.string().describe("默认 docx").optional(),
      }),
    ),
  },
  {
    name: "feishu_create_spreadsheet",
    concurrencyClass: "D",
    description: "创建飞书表格（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        title: z.string(),
        folderToken: z.string().optional(),
      }),
    ),
  },
  {
    name: "feishu_append_spreadsheet_values",
    concurrencyClass: "D",
    description: "向飞书表格追加数据（需 user_access_token）。",
    parameters: zodParams(
      z.object({
        spreadsheetToken: z.string(),
        range: z.string().describe("如 sheet1!A1"),
        values: z.array(z.unknown()).describe("二维数组"),
      }),
    ),
  },
  {
    name: "feishu_token_status",
    reentrant: true, // 只读 credential 状态（getUserAccessTokenStatus 不触发刷新写库）
    concurrencyClass: "B",
    description: "查询飞书 user_access_token 状态（Credential 表或文件缓存）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "feishu_refresh_token",
    concurrencyClass: "D",
    description:
      "用 refresh_token 静默续期飞书 user_access_token（Credential 或 feishu_oauth.json）。失败时请改调 feishu_authorize。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "feishu_authorize",
    concurrencyClass: "D",
    description:
      "打开浏览器完成飞书 OAuth（含 offline_access + 文档/知识库/画板 scope），写入 content/cookies/feishu_oauth.json。" +
      "仅在 feishu_token_status 无效且 feishu_refresh_token 失败、或新增权限后需要重新授权时调用；已有有效 token 勿重复调用。" +
      "用户需在弹出页点一次同意。本地回调默认 http://localhost:8088（占用时自动尝试相邻端口）。",
    parameters: zodParams(
      z.object({
        timeoutSec: z.number().describe("等待用户授权秒数，默认 180").optional(),
        openBrowser: z.boolean().describe("是否自动打开浏览器，默认 true").optional(),
        scope: z.string().describe("可选自定义 scope（空格分隔）").optional(),
      }),
    ),
  },
  {
    name: "feishu_list_doc_whiteboards",
    reentrant: true,
    concurrencyClass: "B",
    description:
      "列出飞书文档内的画板（board-v1）。文档块 block_type=43，返回 whiteboardId（= block.board.token）。编辑画板前先调此工具拿 id。需 board:whiteboard:node:read + 文档读权限。",
    parameters: zodParams(
      z.object({
        documentId: z.string().describe("文档 document_id / token"),
      }),
    ),
  },
  {
    name: "feishu_list_whiteboard_nodes",
    reentrant: true,
    concurrencyClass: "B",
    description: "获取画板全部节点树（GET board/v1/.../nodes）。需 board:whiteboard:node:read。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string().describe("画板 id（feishu_list_doc_whiteboards 返回）"),
      }),
    ),
  },
  {
    name: "feishu_create_whiteboard_nodes",
    concurrencyClass: "D",
    destructive: true,
    description:
      "在画板上批量创建节点（原生 board-v1 节点 JSON：sticky_note / composite_shape / connector / mind_map 等）。overwrite=true 时先清空再写入。一般流程图优先用 feishu_whiteboard_from_diagram（mermaid/plantuml）。需 board:whiteboard:node:create。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        nodes: z.array(z.record(z.unknown())).describe("whiteboard.node[]，见飞书 board-v1 数据结构"),
        overwrite: z.boolean().describe("是否覆盖整板，默认 false").optional(),
        clientToken: z.string().describe("幂等 token（≥10 字符）").optional(),
      }),
    ),
  },
  {
    name: "feishu_whiteboard_from_diagram",
    concurrencyClass: "D",
    destructive: true,
    description:
      "用 Mermaid / PlantUML / SVG 源码写入飞书画板（POST .../nodes/plantuml）。推荐路径：先 feishu_list_doc_whiteboards 取 whiteboardId，再传 mermaid/plantuml 代码；默认 overwrite=true 覆盖旧图。需 board:whiteboard:node:create。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        code: z.string().describe("Mermaid / PlantUML / SVG 源码"),
        format: z.enum(["mermaid", "plantuml", "svg"]).describe("默认 mermaid").optional(),
        overwrite: z.boolean().describe("默认 true：覆盖整板").optional(),
        clientToken: z.string().describe("幂等 token（≥10 字符）").optional(),
      }),
    ),
  },
  {
    name: "feishu_delete_whiteboard_nodes",
    concurrencyClass: "D",
    destructive: true,
    description: "批量删除画板节点（含子节点递归）。单次最多 100 个 id。需 board:whiteboard:node:delete。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        ids: z.array(z.string()).describe("节点 id 列表"),
        clientToken: z.string().optional(),
      }),
    ),
  },
  {
    name: "feishu_get_whiteboard_theme",
    reentrant: true,
    concurrencyClass: "B",
    description: "获取画板主题。",
    parameters: zodParams(z.object({ whiteboardId: z.string() })),
  },
  {
    name: "feishu_update_whiteboard_theme",
    concurrencyClass: "D",
    description: "更新画板主题：classic / minimalist_gray / retro / vibrant_color / default。",
    parameters: zodParams(
      z.object({
        whiteboardId: z.string(),
        theme: z.enum(["classic", "minimalist_gray", "retro", "vibrant_color", "default"]),
      }),
    ),
  },
  {
    name: "send_email",
    description: "发送邮件通知用户（任务完成、预算耗尽、心跳失败等）。需配置 EMAIL_PROVIDER 环境变量。",
    parameters: zodParams(
      z.object({
        subject: z.string().describe("邮件主题"),
        body: z.string().describe("邮件正文（纯文本）"),
        to: z.string().describe("收件人邮箱（不填则用 EMAIL_TO 环境变量）").optional(),
      }),
    ),
  },
];

const INTEGRATION_HANDLERS: Record<string, NativeToolHandler> = {
  git_status: gitStatusTool,
  git_branch: gitBranchTool,
  git_checkout: gitCheckoutTool,
  git_clone: gitCloneTool,
  git_log: gitLogTool,
  git_diff: gitDiffTool,
  git_commit: gitCommitTool,
  git_pull: gitPullTool,
  git_push: gitPushTool,
  yuque_get_doc: yuqueGetDocTool,
  yuque_list_books: yuqueListBooksTool,
  yuque_create_book: yuqueCreateBookTool,
  yuque_update_book: yuqueUpdateBookTool,
  yuque_delete_book: yuqueDeleteBookTool,
  yuque_session_status: yuqueSessionStatusTool,
  yuque_create_repo: yuqueCreateRepoTool,
  yuque_update_repo: yuqueUpdateRepoTool,
  yuque_delete_repo: yuqueDeleteRepoTool,
  yuque_get_book_toc: yuqueGetBookTocTool,
  yuque_create_doc: yuqueCreateDocTool,
  yuque_update_doc: yuqueUpdateDocTool,
  yuque_delete_doc: yuqueDeleteDocTool,
  yuque_list_repos: yuqueListReposTool,
  yuque_list_docs: yuqueListDocsTool,
  yuque_create_doc_v2: yuqueCreateDocV2Tool,
  yuque_update_doc_v2: yuqueUpdateDocV2Tool,
  yuque_delete_doc_v2: yuqueDeleteDocV2Tool,
  capture_zhihu_login: captureZhihuLoginTool,
  browser_login_status: browserLoginStatusTool,
  github_search_repos: githubSearchReposTool,
  github_get_repo: githubGetRepoTool,
  github_create_repo: githubCreateRepoTool,
  github_update_repo: githubUpdateRepoTool,
  github_delete_repo: githubDeleteRepoTool,
  github_get_file: githubGetFileTool,
  github_create_file: githubCreateFileTool,
  github_update_file: githubUpdateFileTool,
  github_delete_file: githubDeleteFileTool,
  github_list_issues: githubListIssuesTool,
  github_get_issue: githubGetIssueTool,
  github_create_issue: githubCreateIssueTool,
  github_update_issue: githubUpdateIssueTool,
  github_create_issue_comment: githubCreateIssueCommentTool,
  github_list_pull_requests: githubListPullRequestsTool,
  github_get_pull_request: githubGetPullRequestTool,
  github_create_pull_request: githubCreatePullRequestTool,
  github_update_pull_request: githubUpdatePullRequestTool,
  github_merge_pull_request: githubMergePullRequestTool,
  github_list_branches: githubListBranchesTool,
  github_get_branch: githubGetBranchTool,
  github_create_branch: githubCreateBranchTool,
  github_delete_branch: githubDeleteBranchTool,
  github_list_workflows: githubListWorkflowsTool,
  github_trigger_workflow: githubTriggerWorkflowTool,
  github_create_release: githubCreateReleaseTool,
  github_tool: githubTool,
  feishu_send_text: feishuSendTextTool,
  feishu_send_message: feishuSendMessageTool,
  feishu_get_doc: feishuGetDocTool,
  feishu_create_doc: feishuCreateDocTool,
  feishu_update_doc: feishuUpdateDocTool,
  feishu_append_doc_text: feishuAppendDocTextTool,
  feishu_append_doc_blocks: feishuAppendDocBlocksTool,
  feishu_delete_doc: feishuDeleteDocTool,
  feishu_search_docs: feishuSearchDocsTool,
  feishu_list_permission_members: feishuListPermissionMembersTool,
  feishu_add_permission_member: feishuAddPermissionMemberTool,
  feishu_update_permission_member: feishuUpdatePermissionMemberTool,
  feishu_remove_permission_member: feishuRemovePermissionMemberTool,
  feishu_get_permission_public: feishuGetPermissionPublicTool,
  feishu_update_permission_public: feishuUpdatePermissionPublicTool,
  feishu_lookup_user: feishuLookupUserTool,
  feishu_add_collaborator_by_contact: feishuAddCollaboratorByContactTool,
  feishu_get_wiki_space: feishuGetWikiSpaceTool,
  feishu_get_wiki_nodes: feishuGetWikiNodesTool,
  feishu_create_wiki_node: feishuCreateWikiNodeTool,
  feishu_create_spreadsheet: feishuCreateSpreadsheetTool,
  feishu_append_spreadsheet_values: feishuAppendSpreadsheetValuesTool,
  feishu_token_status: feishuTokenStatusTool,
  feishu_refresh_token: feishuRefreshTokenTool,
  feishu_authorize: feishuAuthorizeTool,
  feishu_list_doc_whiteboards: feishuListDocWhiteboardsTool,
  feishu_list_whiteboard_nodes: feishuListWhiteboardNodesTool,
  feishu_create_whiteboard_nodes: feishuCreateWhiteboardNodesTool,
  feishu_whiteboard_from_diagram: feishuWhiteboardFromDiagramTool,
  feishu_delete_whiteboard_nodes: feishuDeleteWhiteboardNodesTool,
  feishu_get_whiteboard_theme: feishuGetWhiteboardThemeTool,
  feishu_update_whiteboard_theme: feishuUpdateWhiteboardThemeTool,
  send_email: sendEmailTool,
};

export function registerIntegrationTools(): void {
  registerNativeDomain(INTEGRATION_DEFS, INTEGRATION_HANDLERS);
}
