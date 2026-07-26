/**
 * 集成域 — github_* + 浏览器登录态（从 integration.ts 拆出，P2-01 选 B）
 *
 * GitHub 仓库/Issue/PR/分支/工作流/Release 操作 + platform_login/browser_login_status 浏览器登录态工具。
 */
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
} from "../../../githubClient.js";
import { executeGitHubTool, listGitHubTools } from "../../../external/githubToolExecutor.js";
import { capturePlatformLoginState, listPlatformLoginStatus, PLATFORM_LOGIN_CONFIGS } from "../../../metablog/auth/platformLogin.js";
import { listSavedCookiePlatforms, loadCookies } from "../../../cookieJar.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";
import { z } from "zod";
import { zodParams } from "../zodParams.js";

// ─── 浏览器登录态 ───

async function platformLoginTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const platform = String(args.platform ?? "").trim() as keyof typeof PLATFORM_LOGIN_CONFIGS;
  if (!platform || !PLATFORM_LOGIN_CONFIGS[platform]) {
    return {
      success: false,
      message: `不支持的平台：${args.platform ?? ""}。支持：${Object.keys(PLATFORM_LOGIN_CONFIGS).join(", ")}`,
    };
  }
  return capturePlatformLoginState(platform, Number(args.timeoutSec || 120));
}

async function browserLoginStatusTool(_args: Record<string, unknown>, _ctx: NativeToolContext) {
  const platforms = listSavedCookiePlatforms();
  const details = listPlatformLoginStatus();
  return {
    platforms,
    details,
    cookieJars: platforms.map((p) => ({ platform: p, cookieCount: loadCookies(p).length })),
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

export const githubDefs: NativeToolDefinition[] = [
  {
    name: "platform_login",
    description:
      "平台登录的唯一入口：调用即弹出 Playwright 浏览器窗口，让用户手动登录指定平台（扫码/账密），登录态自动落盘（storageState + cookieJar），供 read_article 抓取需登录内容（收藏夹/付费/私密）。支持平台：zhihu（知乎）、wechat（微信公众号后台）、xhs（小红书）、douyin（抖音）、bilibili（哔哩哔哩）、weibo（微博）、juejin（掘金）、csdn（CSDN）、yuque（语雀）。**用户说登录/重新登录/获取某平台账户时，直接调用本工具——不要先 browser_screenshot/read_image 截图检查状态（模型无 vision 会卡死）；检查登录状态用 browser_login_status。** 各平台官方开放平台需企业认证+OAuth 对单用户本地项目过重，浏览器登录态捕获是最务实方案。",
    parameters: zodParams(
      z.object({
        platform: z
          .string()
          .describe("平台名：zhihu/wechat/xhs/douyin/bilibili/weibo/juejin/csdn/yuque"),
        timeoutSec: z.number().describe("等待登录超时秒数，默认 120").optional(),
      }),
    ),
  },
  {
    name: "browser_login_status",
    description:
      "列出所有支持平台的浏览器登录态状态（storageState 是否存在、大小、cookieJar 条数）。用于检查哪些平台已登录、哪些需重新登录。",
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
];

export const githubHandlers: Record<string, NativeToolHandler> = {
  platform_login: platformLoginTool,
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
};
