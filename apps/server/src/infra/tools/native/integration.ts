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
  githubGetFile,
  githubCreateFile,
  githubUpdateFile,
  githubDeleteFile,
  githubListIssues,
  githubGetIssue,
  githubCreateIssue,
  githubUpdateIssue,
  githubListPullRequests,
  githubGetPullRequest,
  githubCreatePullRequest,
  githubListBranches,
  githubGetBranch,
  githubCreateBranch,
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
  feishuSearchDocs,
  feishuGetWikiSpace,
  feishuGetWikiNodes,
  feishuCreateSpreadsheet,
  feishuAppendSpreadsheetValues,
  getUserAccessTokenStatus,
  refreshUserAccessToken,
} from "../../feishuClient.js";
import { getCredentialValue } from "../../credentialVault.js";
import { refreshTokenManually as refreshFileToken } from "../../external/larkTokenManager.js";
import {
  getYuqueCredentials,
  yuqueListBooks,
  yuqueGetBookToc,
  yuqueCreateDoc,
  yuqueUpdateDoc,
  yuqueDeleteDoc,
  yuqueListRepos,
  yuqueListDocs,
  yuqueGetDocV2,
  yuqueCreateDocV2,
  yuqueUpdateDocV2,
  yuqueDeleteDocV2,
} from "../../yuqueClient.js";
import { captureZhihuLoginState } from "../../metablog/auth/zhihuLogin.js";
import { listSavedCookiePlatforms } from "../../cookieJar.js";
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
  const token = ctx.config.integrations.yuque.ctoken || "";
  const data = (await yuqueGetDocV2(String(args.namespace), String(args.slug), token)) as {
    title?: string;
    slug?: string;
    body?: string;
  };
  return { title: data.title, slug: data.slug, body: (data.body || "").slice(0, 12000) };
}

async function yuqueListBooksTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueListBooks(credentials);
}

async function yuqueGetBookTocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueGetBookToc(String(args.bookId), credentials);
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

async function yuqueListReposTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = ctx.config.integrations.yuque.ctoken || "";
  return yuqueListRepos(token);
}

async function yuqueListDocsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = ctx.config.integrations.yuque.ctoken || "";
  return yuqueListDocs(String(args.namespace), token);
}

async function yuqueCreateDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = ctx.config.integrations.yuque.ctoken || "";
  return yuqueCreateDocV2(String(args.namespace), String(args.title), String(args.body), token);
}

async function yuqueUpdateDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = ctx.config.integrations.yuque.ctoken || "";
  return yuqueUpdateDocV2(String(args.namespace), String(args.slug), String(args.title), String(args.body), token);
}

async function yuqueDeleteDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = ctx.config.integrations.yuque.ctoken || "";
  return yuqueDeleteDocV2(String(args.namespace), String(args.slug), token);
}

// ─── 浏览器登录态 ───

async function captureZhihuLoginTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  return captureZhihuLoginState(Number(args.timeoutSec || 120));
}

async function browserLoginStatusTool(_args: Record<string, unknown>, _ctx: NativeToolContext) {
  return { platforms: listSavedCookiePlatforms() };
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
  return githubListIssues(
    owner,
    repoName,
    (args.state as "open" | "closed" | "all") || "open",
    Number(args.perPage || 30),
    Number(args.page || 1),
    getGitHubToken(ctx.config),
  );
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
  const tool = String(args.tool || "");
  const params = (args.params || {}) as Record<string, unknown>;
  return executeGitHubTool(tool, params, getGitHubToken(ctx.config));
}

// ─── 飞书 ───

async function feishuSendTextTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) {
    // 无 prisma 时保持向后兼容：直接用 config 中的 tenant token
    const token = ctx.config.integrations.feishu.tenantAccessToken;
    if (!token) throw new Error("未配置 FEISHU_TENANT_ACCESS_TOKEN");
    const receiveIdType = String(args.receiveIdType || "open_id");
    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        receive_id: String(args.receiveId),
        msg_type: "text",
        content: JSON.stringify({ text: String(args.text) }),
      }),
    });
    const data = (await res.json()) as { code?: number; msg?: string; data?: unknown };
    if (!res.ok || data.code !== 0) throw new Error(`飞书发送失败: ${data.msg || res.status}`);
    return data.data;
  }
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

async function feishuSearchDocsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  return feishuSearchDocs(String(args.query), ctx.prisma, ctx.config);
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

async function feishuRefreshTokenTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) throw new Error("飞书工具需要 prisma 上下文");
  const refreshToken = await getCredentialValue(ctx.prisma, "feishu", "feishu_refresh_token");
  if (refreshToken) {
    const token = await refreshUserAccessToken(ctx.prisma, refreshToken);
    return { success: true, source: "credential", token: token.slice(0, 8) + "..." };
  }
  const fileResult = await refreshFileToken();
  return { source: "file", ...fileResult };
}

// ─── 邮件通知工具 ───

async function sendEmailTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const subject = String(args.subject || "");
  const body = String(args.body || "");
  if (!subject || !body) return { error: "send_email 需要 subject 和 body" };

  const provider = ctx.config.emailProvider || process.env.EMAIL_PROVIDER || "none";
  if (provider === "none" || !provider) {
    return { error: "邮件未配置（EMAIL_PROVIDER=none），请设置 EMAIL_PROVIDER=smtp 或 agentemail。" };
  }
  const to = (args.to as string) || process.env.EMAIL_TO || "";
  if (!to) return { error: "未配置收件人（EMAIL_TO 环境变量或 to 参数）" };

  try {
    if (provider === "smtp") {
      // SMTP 发送（需 nodemailer，动态导入避免未安装时崩溃）
      // @ts-ignore — nodemailer 可选依赖，未安装时 catch 返回 null
      const nodemailer: any = await import("nodemailer").catch(() => null);
      if (!nodemailer?.default?.createTransport && !nodemailer?.createTransport) return { error: "nodemailer 未安装，无法通过 SMTP 发送邮件。" };
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_SMTP_HOST,
        port: Number(process.env.EMAIL_SMTP_PORT || "587"),
        secure: process.env.EMAIL_SMTP_SECURE === "true",
        auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS },
      });
      await transporter.sendMail({ from: process.env.EMAIL_SMTP_USER, to, subject, text: body });
    } else if (provider === "agentemail") {
      // AgentEmail API（简单 fetch）
      const apiKey = process.env.AGENTEMAIL_API_KEY;
      if (!apiKey) return { error: "AGENTEMAIL_API_KEY 未配置。" };
      const res = await fetch("https://api.agentemail.com/v1/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ to, subject, body }),
        signal: undefined,
      });
      if (!res.ok) return { error: `AgentEmail 发送失败: HTTP ${res.status}` };
    } else {
      return { error: `未知的邮件提供商: ${provider}` };
    }

    await ctx.services.log?.create?.({
      level: "info", component: "swarm", event: "email_sent",
      message: `邮件已发送: ${subject} → ${to}`,
      metadata: { subject, to, provider, agentId: ctx.agentSnapshot?.id },
    }).catch(() => {});
    return { success: true, message: `邮件已发送到 ${to}` };
  } catch (err) {
    return { error: `邮件发送失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const INTEGRATION_DEFS: NativeToolDefinition[] = [
  {
    name: "git_branch",
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
    description: "通过语雀 Open API v2 获取文档内容（需配置 YUQUE_SESSION 或 Credential scope=yuque）。",
    parameters: zodParams(
      z.object({
        namespace: z.string().describe("知识库 namespace，如 user/repo"),
        slug: z.string().describe("文档 slug"),
      }),
    ),
  },
  {
    name: "yuque_list_books",
    description: "列出语雀知识库（内部 Web API，需 Cookie）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_get_book_toc",
    description: "获取语雀知识库目录（内部 Web API，需 Cookie）。",
    parameters: zodParams(
      z.object({
        bookId: z.string(),
      }),
    ),
  },
  {
    name: "yuque_create_doc",
    description: "在语雀知识库创建文档（内部 Web API，需 Cookie）。",
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
    description: "更新语雀文档（内部 Web API，需 Cookie）。",
    parameters: zodParams(
      z.object({
        docId: z.string(),
        bookId: z.string().optional(),
        title: z.string(),
        body: z.string(),
      }),
    ),
  },
  {
    name: "yuque_delete_doc",
    destructive: true,
    description: "删除语雀文档（内部 Web API，需 Cookie）。",
    parameters: zodParams(
      z.object({
        docId: z.string(),
        bookId: z.string(),
      }),
    ),
  },
  {
    name: "yuque_list_repos",
    description: "列出语雀知识库（Open API v2，需 Token）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_list_docs",
    description: "列出语雀知识库文档（Open API v2，需 Token）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
      }),
    ),
  },
  {
    name: "yuque_create_doc_v2",
    description: "创建语雀文档（Open API v2，需 Token）。",
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
    description: "更新语雀文档（Open API v2，需 Token）。",
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
    description: "删除语雀文档（Open API v2，需 Token）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        slug: z.string(),
      }),
    ),
  },
  {
    name: "capture_zhihu_login",
    description: "弹出浏览器窗口让用户登录知乎，完成后保存登录态到 content/cookies/zhihu_storage_state.json。",
    parameters: zodParams(
      z.object({
        timeoutSec: z.number().describe("等待超时秒数，默认 120").optional(),
      }),
    ),
  },
  {
    name: "browser_login_status",
    description: "列出当前已保存的浏览器登录态平台。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "github_search_repos",
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
    name: "github_get_file",
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
    name: "github_list_branches",
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
    name: "github_list_workflows",
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
    concurrencyClass: "B",
    description: "查询飞书 user_access_token 状态（Credential 表或文件缓存）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "feishu_refresh_token",
    concurrencyClass: "D",
    description: "手动刷新飞书 user_access_token。",
    parameters: zodParams(z.object({})),
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
  github_get_file: githubGetFileTool,
  github_create_file: githubCreateFileTool,
  github_update_file: githubUpdateFileTool,
  github_delete_file: githubDeleteFileTool,
  github_list_issues: githubListIssuesTool,
  github_get_issue: githubGetIssueTool,
  github_create_issue: githubCreateIssueTool,
  github_update_issue: githubUpdateIssueTool,
  github_list_pull_requests: githubListPullRequestsTool,
  github_get_pull_request: githubGetPullRequestTool,
  github_create_pull_request: githubCreatePullRequestTool,
  github_list_branches: githubListBranchesTool,
  github_get_branch: githubGetBranchTool,
  github_create_branch: githubCreateBranchTool,
  github_list_workflows: githubListWorkflowsTool,
  github_trigger_workflow: githubTriggerWorkflowTool,
  github_create_release: githubCreateReleaseTool,
  github_tool: githubTool,
  feishu_send_text: feishuSendTextTool,
  feishu_send_message: feishuSendMessageTool,
  feishu_get_doc: feishuGetDocTool,
  feishu_create_doc: feishuCreateDocTool,
  feishu_search_docs: feishuSearchDocsTool,
  feishu_get_wiki_space: feishuGetWikiSpaceTool,
  feishu_get_wiki_nodes: feishuGetWikiNodesTool,
  feishu_create_spreadsheet: feishuCreateSpreadsheetTool,
  feishu_append_spreadsheet_values: feishuAppendSpreadsheetValuesTool,
  feishu_token_status: feishuTokenStatusTool,
  feishu_refresh_token: feishuRefreshTokenTool,
  send_email: sendEmailTool,
};

export function registerIntegrationTools(): void {
  registerNativeDomain(INTEGRATION_DEFS, INTEGRATION_HANDLERS);
}
