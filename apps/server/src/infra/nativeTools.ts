/**
 * 原生工具注册表 — Agent 可直接调用的内置能力
 *
 * PR-4a：fs / web / shell 已迁至 infra/tools/native/*，此处保留其余域 + 兼容出口。
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AppConfig } from "./config.js";
import { resolveSafePath, assertPathWithinProjectRoot } from "./safePath.js";
import type { ServiceContainer } from "./serviceContainer.js";
import type { PostEntity, MemoryEntity } from "../services.js";
import type { PrismaClient } from "@prisma/client";
import { buildMemoryContext, buildSystemPromptWithHints, resolveAgent, resolveToolsForAgentTier, DEFAULT_SUBAGENT_TOOLS } from "./agentRuntime.js";
import { getAllowedToolsForTier } from "./swarmPermissionGuard.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import type { LlmMessage } from "./llmClient.js";
import {
  getGitHubToken,
  parseRepo,
  githubApiRequest,
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
} from "./githubClient.js";

import { executeGitHubTool, listGitHubTools } from "./external/githubToolExecutor.js";
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
} from "./feishuClient.js";
import { getCredentialValue } from "./credentialVault.js";
import { refreshTokenManually as refreshFileToken } from "./external/larkTokenManager.js";
import {
  getYuqueCredentials,
  yuqueApi,
  yuqueListBooks,
  yuqueGetBookToc,
  yuqueGetDocWeb,
  yuqueCreateDoc,
  yuqueUpdateDoc,
  yuqueDeleteDoc,
  yuqueListRepos,
  yuqueListDocs,
  yuqueGetDocV2,
  yuqueCreateDocV2,
  yuqueUpdateDocV2,
  yuqueDeleteDocV2,
} from "./yuqueClient.js";
import { captureZhihuLoginState } from "./metablog/auth/zhihuLogin.js";
import { listSavedCookiePlatforms } from "./cookieJar.js";

import { DEFAULT_AGENT_NATIVE, isMemoryUserCreatable, type MemoryUserCreatableType } from "@knowpilot/shared";
import { registerTool, getTool, listTools } from "./tools/registry.js";
import type { ToolCommand } from "./tools/types.js";
import {
  coerceToolBoolean,
  type NativeToolContext,
  type NativeToolDefinition,
} from "./tools/native/types.js";

// PR-4a 域副作用注册（fs/web/shell）
import { registerNativeDomains } from "./tools/native/index.js";

export type { NativeToolContext, NativeToolDefinition } from "./tools/native/types.js";
export {
  syncSearchEnvFromConfig,
  isUnreadableArticlePage,
  readArticleContentWarning,
} from "./tools/native/web.js";

const execFileAsync = promisify(execFile);

type NativeToolHandler = (args: Record<string, unknown>, ctx: NativeToolContext) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, NativeToolHandler> = {
  post_create: postCreateTool,
  post_update: postUpdateTool,
  post_delete: postDeleteTool,
  memory_create: memoryCreateTool,
  memory_search: memorySearchTool,
  memory_delete: memoryDeleteTool,
  git_status: gitStatusTool,
  git_branch: gitBranchTool,
  git_checkout: gitCheckoutTool,
  git_clone: gitCloneTool,
  git_log: gitLogTool,
  git_diff: gitDiffTool,
  git_commit: gitCommitTool,
  git_pull: gitPullTool,
  git_push: gitPushTool,
  task_run: taskRunTool,
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
  invoke_api: invokeApiTool,
  spawn_subagent: spawnSubagentTool,
  session_clear: sessionClearTool,
  session_rotate: sessionRotateTool,
  session_compact: sessionCompactTool,
  // Swarm 管理工具
  agent_create: agentCreateTool,
  agent_update: agentUpdateTool,
  agent_delete: agentDeleteTool,
  agent_inspect: agentInspectTool,
  agent_send_message: agentSendMessageTool,
  agent_report_back: agentReportBackTool,
  agent_create_sub: agentCreateSubTool,
  workspace_create: workspaceCreateTool,
  workspace_archive: workspaceArchiveTool,
  // 邮件通知
  send_email: sendEmailTool,
  // 免费 API Key
  free_api_keys_list: freeApiKeysListTool,
  free_api_keys_fetch: freeApiKeysFetchTool,
  // Hermes 进化：超级 Agent 跨 Workspace 发现优秀 Skill 并推广（#45）
  skill_promote: skillPromoteTool,
  skill_discover: skillDiscoverTool,
  // Agent 进化高级版
  optimize_agent_prompt: optimizeAgentPromptTool,
  generate_skill_from_experience: generateSkillFromExperienceTool,
};

export const NATIVE_TOOL_DEFINITIONS: NativeToolDefinition[] = [
  {
    name: "post_create",
    description: "在本地知识库中创建一篇 Markdown 文章（content/posts）。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "文章标题" },
        content: { type: "string", description: "Markdown 正文" },
        slug: { type: "string", description: "URL 标识，不填则自动生成" },
        excerpt: { type: "string", description: "摘要" },
        coverImage: { type: "string", description: "封面图 URL" },
        category: { type: "string", description: "分类" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表" },
        published: { type: "boolean", description: "是否发布" },
      },
      required: ["title"],
    },
  },
  {
    name: "post_update",
    description: "更新本地知识库中的 Markdown 文章。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "文章 id" },
        title: { type: "string", description: "文章标题" },
        content: { type: "string", description: "Markdown 正文" },
        slug: { type: "string", description: "URL 标识" },
        excerpt: { type: "string", description: "摘要" },
        coverImage: { type: "string", description: "封面图 URL" },
        category: { type: "string", description: "分类" },
        tags: { type: "array", items: { type: "string" }, description: "标签列表" },
        published: { type: "boolean", description: "是否发布" },
      },
      required: ["id"],
    },
  },
  {
    name: "post_delete",
    description: "删除本地知识库中的 Markdown 文章。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "文章 id" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_create",
    description:
      "创建长期记忆。type：preference=用户偏好；semantic=稳定事实/决策；episodic=某次经历；note=笔记；procedural=操作流程。不要记可从代码/git/文档直接查到的内容。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "记忆内容" },
        type: {
          type: "string",
          enum: ["preference", "semantic", "episodic", "note", "procedural"],
          description: "记忆类型",
        },
        strength: { type: "number", description: "强度 0-1，默认 1" },
        keywords: { type: "array", items: { type: "string" }, description: "检索关键词" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description: "搜索本地记忆库。",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "关键词" },
        type: { type: "string", description: "按类型过滤" },
        page: { type: "number", description: "页码，默认 1" },
        pageSize: { type: "number", description: "每页条数，默认 20" },
      },
    },
  },
  {
    name: "memory_delete",
    description: "删除本地记忆库中的一条记忆。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "记忆 id" },
      },
      required: ["id"],
    },
  },
  {
    name: "git_branch",
    description: "查看 Git 仓库分支列表。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string", description: "已注册 GitRepo 的 id" },
        repoPath: { type: "string", description: "或直接指定本地仓库路径" },
        all: { type: "boolean", description: "是否包含远程分支，默认 false" },
      },
    },
  },
  {
    name: "git_checkout",
    description: "切换或新建并切换 Git 分支。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string", description: "已注册 GitRepo 的 id" },
        repoPath: { type: "string", description: "或直接指定本地仓库路径" },
        branch: { type: "string", description: "分支名" },
        create: { type: "boolean", description: "是否新建分支，默认 false" },
      },
      required: ["branch"],
    },
  },
  {
    name: "git_clone",
    description: "克隆远程 Git 仓库到项目根目录内的指定子目录。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "仓库 HTTPS/SSH URL" },
        dest: { type: "string", description: "项目内目标相对目录，如 repos/foo" },
      },
      required: ["url", "dest"],
    },
  },
  {
    name: "git_status",
    description: "查看 Git 仓库工作区状态。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string", description: "已注册 GitRepo 的 id" },
        repoPath: { type: "string", description: "或直接指定本地仓库路径" },
      },
    },
  },
  {
    name: "git_log",
    description: "查看 Git 提交历史。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        repoPath: { type: "string" },
        limit: { type: "number", description: "条数，默认 10" },
      },
    },
  },
  {
    name: "git_diff",
    description: "查看 Git 工作区 diff。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        repoPath: { type: "string" },
        staged: { type: "boolean", description: "是否只看暂存区" },
      },
    },
  },
  {
    name: "git_commit",
    description: "Git add -A 并提交当前仓库变更。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string", description: "已注册 GitRepo 的 id" },
        repoPath: { type: "string", description: "或直接指定本地仓库路径" },
        message: { type: "string", description: "提交信息" },
      },
      required: ["message"],
    },
  },
  {
    name: "git_pull",
    description: "Git pull 拉取远程更新。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "git_push",
    description: "Git push 推送本地提交到远程。",
    parameters: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "task_run",
    description: "立即执行一条已注册的后台 Task（如 db:sync）。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id" },
        name: { type: "string", description: "或按任务名称匹配" },
      },
    },
  },
  {
    name: "yuque_get_doc",
    description: "通过语雀 Open API v2 获取文档内容（需配置 YUQUE_SESSION 或 Credential scope=yuque）。",
    parameters: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "知识库 namespace，如 user/repo" },
        slug: { type: "string", description: "文档 slug" },
      },
      required: ["namespace", "slug"],
    },
  },
  {
    name: "yuque_list_books",
    description: "列出语雀知识库（内部 Web API，需 Cookie）。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "yuque_get_book_toc",
    description: "获取语雀知识库目录（内部 Web API，需 Cookie）。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string" },
      },
      required: ["bookId"],
    },
  },
  {
    name: "yuque_create_doc",
    description: "在语雀知识库创建文档（内部 Web API，需 Cookie）。",
    parameters: {
      type: "object",
      properties: {
        bookId: { type: "string" },
        title: { type: "string" },
        body: { type: "string", description: "Markdown 内容" },
      },
      required: ["bookId", "title", "body"],
    },
  },
  {
    name: "yuque_update_doc",
    description: "更新语雀文档（内部 Web API，需 Cookie）。",
    parameters: {
      type: "object",
      properties: {
        docId: { type: "string" },
        bookId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["docId", "title", "body"],
    },
  },
  {
    name: "yuque_delete_doc",
    description: "删除语雀文档（内部 Web API，需 Cookie）。",
    parameters: {
      type: "object",
      properties: {
        docId: { type: "string" },
        bookId: { type: "string" },
      },
      required: ["docId", "bookId"],
    },
  },
  {
    name: "yuque_list_repos",
    description: "列出语雀知识库（Open API v2，需 Token）。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "yuque_list_docs",
    description: "列出语雀知识库文档（Open API v2，需 Token）。",
    parameters: {
      type: "object",
      properties: {
        namespace: { type: "string" },
      },
      required: ["namespace"],
    },
  },
  {
    name: "yuque_create_doc_v2",
    description: "创建语雀文档（Open API v2，需 Token）。",
    parameters: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["namespace", "title", "body"],
    },
  },
  {
    name: "yuque_update_doc_v2",
    description: "更新语雀文档（Open API v2，需 Token）。",
    parameters: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        slug: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["namespace", "slug", "title", "body"],
    },
  },
  {
    name: "yuque_delete_doc_v2",
    description: "删除语雀文档（Open API v2，需 Token）。",
    parameters: {
      type: "object",
      properties: {
        namespace: { type: "string" },
        slug: { type: "string" },
      },
      required: ["namespace", "slug"],
    },
  },
  {
    name: "capture_zhihu_login",
    description: "弹出浏览器窗口让用户登录知乎，完成后保存登录态到 content/cookies/zhihu_storage_state.json。",
    parameters: {
      type: "object",
      properties: {
        timeoutSec: { type: "number", description: "等待超时秒数，默认 120" },
      },
    },
  },
  {
    name: "browser_login_status",
    description: "列出当前已保存的浏览器登录态平台。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "github_search_repos",
    description: "在 GitHub 搜索公开仓库。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "默认 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "github_get_repo",
    description: "获取 GitHub 仓库详情。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_create_repo",
    description: "创建 GitHub 仓库（需要 token 有 repo 或 public_repo 权限）。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        private: { type: "boolean", description: "默认 false" },
        autoInit: { type: "boolean", description: "是否自动初始化 README，默认 false" },
      },
      required: ["name"],
    },
  },
  {
    name: "github_update_repo",
    description: "更新 GitHub 仓库元信息。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        description: { type: "string" },
        private: { type: "boolean" },
        defaultBranch: { type: "string" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_get_file",
    description: "读取 GitHub 仓库文件内容（Base64 自动解码）。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        path: { type: "string" },
        ref: { type: "string", description: "分支/tag/sha，默认默认分支" },
      },
      required: ["repo", "path"],
    },
  },
  {
    name: "github_create_file",
    description: "在 GitHub 仓库创建文件。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        path: { type: "string" },
        content: { type: "string" },
        message: { type: "string" },
        branch: { type: "string" },
      },
      required: ["repo", "path", "content", "message"],
    },
  },
  {
    name: "github_update_file",
    description: "更新 GitHub 仓库文件（需要先获取 sha）。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        path: { type: "string" },
        content: { type: "string" },
        message: { type: "string" },
        sha: { type: "string" },
        branch: { type: "string" },
      },
      required: ["repo", "path", "content", "message", "sha"],
    },
  },
  {
    name: "github_delete_file",
    description: "删除 GitHub 仓库文件。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        path: { type: "string" },
        message: { type: "string" },
        sha: { type: "string" },
        branch: { type: "string" },
      },
      required: ["repo", "path", "message", "sha"],
    },
  },
  {
    name: "github_list_issues",
    description: "列出 GitHub 仓库 Issues。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        state: { type: "string", enum: ["open", "closed", "all"], description: "默认 open" },
        perPage: { type: "number", description: "默认 30" },
        page: { type: "number", description: "默认 1" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_get_issue",
    description: "获取单个 GitHub Issue 详情。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        number: { type: "number" },
      },
      required: ["repo", "number"],
    },
  },
  {
    name: "github_create_issue",
    description: "创建 GitHub Issue。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["repo", "title"],
    },
  },
  {
    name: "github_update_issue",
    description: "更新 GitHub Issue（状态/标题/正文/标签）。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        number: { type: "number" },
        title: { type: "string" },
        body: { type: "string" },
        state: { type: "string", enum: ["open", "closed"] },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["repo", "number"],
    },
  },
  {
    name: "github_list_pull_requests",
    description: "列出 GitHub 仓库 Pull Requests。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        state: { type: "string", enum: ["open", "closed", "all"], description: "默认 open" },
        perPage: { type: "number", description: "默认 30" },
        page: { type: "number", description: "默认 1" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_get_pull_request",
    description: "获取单个 GitHub Pull Request 详情。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        number: { type: "number" },
      },
      required: ["repo", "number"],
    },
  },
  {
    name: "github_create_pull_request",
    description: "创建 GitHub Pull Request。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        title: { type: "string" },
        head: { type: "string", description: "源分支" },
        base: { type: "string", description: "目标分支" },
        body: { type: "string" },
      },
      required: ["repo", "title", "head", "base"],
    },
  },
  {
    name: "github_list_branches",
    description: "列出 GitHub 仓库分支。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        perPage: { type: "number", description: "默认 30" },
        page: { type: "number", description: "默认 1" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_get_branch",
    description: "获取 GitHub 分支详情。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        branch: { type: "string" },
      },
      required: ["repo", "branch"],
    },
  },
  {
    name: "github_create_branch",
    description: "基于已有分支创建新分支。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        newBranch: { type: "string" },
        fromBranch: { type: "string", description: "默认 main" },
      },
      required: ["repo", "newBranch"],
    },
  },
  {
    name: "github_list_workflows",
    description: "列出 GitHub Actions 工作流。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
      },
      required: ["repo"],
    },
  },
  {
    name: "github_trigger_workflow",
    description: "触发 GitHub Actions 工作流 dispatch 事件。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        workflowId: { type: "string", description: "工作流 ID 或文件名" },
        ref: { type: "string", description: "触发分支，默认 main" },
        inputs: { type: "object", description: "工作流输入参数" },
      },
      required: ["repo", "workflowId"],
    },
  },
  {
    name: "github_create_release",
    description: "创建 GitHub Release。",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "仓库，格式 owner/repo" },
        tagName: { type: "string" },
        name: { type: "string" },
        body: { type: "string" },
        targetCommitish: { type: "string", description: "目标分支或 commit" },
      },
      required: ["repo", "tagName", "name"],
    },
  },
  {
    name: "github_tool",
    description: `调用完整版 GitHub 工具集（MetaBlog 全量）。可用 tool 名称：${listGitHubTools().join(", ")}。`,
    parameters: {
      type: "object",
      properties: {
        tool: { type: "string", description: "GitHub 工具名，如 github_create_issue" },
        params: { type: "object", description: "该工具所需参数" },
      },
      required: ["tool", "params"],
    },
  },
  {
    name: "feishu_send_text",
    description: "向飞书用户/群发送文本（优先 tenant token；也支持 user token）。",
    parameters: {
      type: "object",
      properties: {
        receiveId: { type: "string", description: "接收者 open_id / chat_id" },
        receiveIdType: { type: "string", enum: ["open_id", "chat_id", "user_id"], description: "默认 open_id" },
        text: { type: "string" },
      },
      required: ["receiveId", "text"],
    },
  },
  {
    name: "feishu_send_message",
    description: "向飞书发送任意类型消息（text/post/image/interactive 等）。",
    parameters: {
      type: "object",
      properties: {
        receiveId: { type: "string" },
        receiveIdType: { type: "string", enum: ["open_id", "chat_id", "user_id"], description: "默认 open_id" },
        msgType: { type: "string", description: "消息类型：text/post/image/interactive" },
        content: { type: "object", description: "消息内容对象" },
      },
      required: ["receiveId", "msgType", "content"],
    },
  },
  {
    name: "feishu_get_doc",
    description: "获取飞书文档详情（需 user_access_token）。",
    parameters: {
      type: "object",
      properties: {
        documentId: { type: "string" },
      },
      required: ["documentId"],
    },
  },
  {
    name: "feishu_create_doc",
    description: "创建飞书文档（需 user_access_token）。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        folderToken: { type: "string", description: "可选父文件夹 token" },
      },
      required: ["title"],
    },
  },
  {
    name: "feishu_search_docs",
    description: "搜索飞书文档（需 user_access_token）。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "feishu_get_wiki_space",
    description: "获取飞书 Wiki 空间信息（需 user_access_token）。",
    parameters: {
      type: "object",
      properties: {
        spaceId: { type: "string" },
      },
      required: ["spaceId"],
    },
  },
  {
    name: "feishu_get_wiki_nodes",
    description: "获取飞书 Wiki 节点列表（需 user_access_token）。",
    parameters: {
      type: "object",
      properties: {
        spaceId: { type: "string" },
        parentNodeToken: { type: "string", description: "可选父节点 token" },
      },
      required: ["spaceId"],
    },
  },
  {
    name: "feishu_create_spreadsheet",
    description: "创建飞书表格（需 user_access_token）。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        folderToken: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "feishu_append_spreadsheet_values",
    description: "向飞书表格追加数据（需 user_access_token）。",
    parameters: {
      type: "object",
      properties: {
        spreadsheetToken: { type: "string" },
        range: { type: "string", description: "如 sheet1!A1" },
        values: { type: "array", description: "二维数组" },
      },
      required: ["spreadsheetToken", "range", "values"],
    },
  },
  {
    name: "feishu_token_status",
    description: "查询飞书 user_access_token 状态（Credential 表或文件缓存）。",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "feishu_refresh_token",
    description: "手动刷新飞书 user_access_token。",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "invoke_api",
    description: "调用 KnowPilot 后端 tRPC 工具（如 post.list、memory.list）。tool 格式：post.list",
    parameters: {
      type: "object",
      properties: {
        tool: { type: "string" },
        args: { type: "object", description: "JSON 参数对象" },
      },
      required: ["tool"],
    },
  },
  {
    name: "spawn_subagent",
    description:
      "派生一个独立子 Agent（Subagent）执行长任务。waitForResult=false（默认）=异步投递：工具立刻返回，用户可继续与父 Agent 对话，子 Agent 完成后须调用 agent_report_back，结果进父会话异步任务结果队列。waitForResult=true=同步等待：父流挂起转圈，子会话空闲后系统抓取最后一条 assistant 作为工具返回值（不强制 report_back，也不进异步队列）。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "子 Agent 要执行的任务描述（详细越好）" },
        label: { type: "string", description: "子 Agent 卡片/队列中显示的简短标签" },
        agentId: { type: "string", description: "指定子 Agent 使用的 Agent ID（不填则新建）" },
        model: { type: "string", description: "指定子代理使用的模型 ID（不填则用 Agent 默认模型）" },
        workspaceId: {
          type: "string",
          description: "目标 Workspace（仅超级 Agent 可跨 Workspace；默认落在当前父 Agent 所在 Workspace）",
        },
        timeoutMs: { type: "number", description: "任务超时毫秒数，不填则使用全局默认值" },
        waitForResult: { type: "boolean", description: "true=同步等待子 Agent 完成并作为工具返回值；false(默认)=异步投递，立刻返回，结果经 report_back 进父异步队列" },
        shareToSessionIds: { type: "array", items: { type: "string" }, description: "swarm 协作：结果额外广播到这些会话 id" },
      },
      required: ["task"],
    },
  },
  {
    name: "session_clear",
    description:
      "删除所有 ChatSession 及其关联的 ChatMessage（级联清空）。这是一个破坏性操作，调用时必须将 confirm 显式设为 true。",
    parameters: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description: "必须设为 true 才会执行清空，否则拒绝调用",
        },
      },
      required: ["confirm"],
    },
  },
  {
    name: "session_rotate",
    description:
      "当当前会话轮数过多、话题切换或用户要求换干净上下文时调用：归档当前会话，创建同一 Agent 的新会话，并把你写的总结作为新会话第一条用户消息。用户若仍在看旧会话，不会自动跳转，只会收到提示。",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "给新会话用的中文总结（Markdown），需保留目标、决策、未完成事项与关键结论",
        },
        reason: {
          type: "string",
          description: "轮换原因，如「轮数过多」「话题切换」「用户要求」",
        },
        title: {
          type: "string",
          description: "新会话标题（可选，默认基于旧标题生成）",
        },
        carryMemoryIds: {
          type: "array",
          items: { type: "string" },
          description: "需要在新会话首条消息中提及的 Memory id（可选）",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "session_compact",
    description:
      "当用户要求压缩上下文、或当前会话过长需要释放 token 时调用：摘要更早的对话并写入会话摘要，保留最近消息继续聊。与 session_rotate 不同，不会换新会话。",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "压缩原因，如「用户要求」「上下文过长」",
        },
      },
    },
  },
  // ─── Swarm 管理工具 ───
  {
    name: "agent_create",
    description: "创建一个新 Agent（需超级权限）。可指定 tier/workspaceId/parentId。创建管理 Agent 时会自动生成主 session。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent 名称（可重复，id 全局唯一）" },
        description: { type: "string" },
        model: { type: "string", description: "模型 ID" },
        systemPrompt: { type: "string" },
        tools: { type: "array", items: { type: "string" }, description: "工具列表" },
        tier: { type: "string", enum: ["super", "manager", "sub"], description: "层级" },
        workspaceId: { type: "string", description: "所属 Workspace id（super 不需要）" },
        parentId: { type: "string", description: "上级 Agent id" },
        apiKey: { type: "string", description: "专属 API Key" },
        heartbeatModel: { type: "string", description: "心跳用便宜模型" },
        heartbeat: { type: "object", description: "心跳配置 { enabled, cron, goal }" },
      },
      required: ["name"],
    },
  },
  {
    name: "agent_update",
    description: "更新 Agent 配置（需超级权限，不能改自己 tier）。运行中的 Agent 用旧配置跑完，下次启动用新配置。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "目标 Agent id" },
        name: { type: "string" },
        description: { type: "string" },
        model: { type: "string" },
        systemPrompt: { type: "string" },
        tools: { type: "array", items: { type: "string" } },
        apiKey: { type: "string" },
        heartbeatModel: { type: "string" },
        heartbeat: { type: "object", description: "心跳配置" },
        status: { type: "string", enum: ["active", "idle", "dormant"], description: "Agent 状态" },
      },
      required: ["id"],
    },
  },
  {
    name: "agent_delete",
    description: "删除 Agent（需超级权限，不能删自己或其他 super）。先停止运行中任务，再级联删 session/message/memory，留 tombstone。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "目标 Agent id" },
      },
      required: ["id"],
    },
  },
  {
    name: "agent_inspect",
    description: "获取任意 Agent 的完整上下文（需超级权限）。包括 session 消息、memory、运行记录。默认管理 Agent 运行过程对超级不可见，此工具用于越级查看。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "目标 Agent id" },
        includeMemory: { type: "boolean", description: "是否包含 memory（默认 true）" },
      },
      required: ["id"],
    },
  },
  {
    name: "agent_send_message",
    description: "向另一个 Agent 发送消息。向下发（super→manager、manager→sub）可在工具调用中发；向上发（sub→manager、manager→super）只能在正式回复中发。跨 Workspace 只有超级能发。",
    parameters: {
      type: "object",
      properties: {
        toAgentId: { type: "string", description: "目标 Agent id" },
        content: { type: "string", description: "消息内容（纯文本或含文件路径引用）" },
        messageType: { type: "string", enum: ["command", "query", "report", "forward"], description: "消息类型" },
        taskRef: { type: "string", description: "关联的 taskId（可选）" },
      },
      required: ["toAgentId", "content"],
    },
  },
  {
    name: "agent_report_back",
    description: "向上级 Agent 回报结果（默认工具，所有 Agent 可用）。只能在正式回复中调用（不能在工具调用轮次中）。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "回报内容" },
        messageType: { type: "string", enum: ["report", "query"], description: "回报或请求帮助" },
        taskRef: { type: "string", description: "关联的 taskId" },
      },
      required: ["content"],
    },
  },
  {
    name: "agent_create_sub",
    description:
      "创建子 Agent。默认落在当前父 Agent 所在 Workspace；超级 Agent 可传 workspaceId 跨 Workspace 创建。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        model: { type: "string" },
        systemPrompt: { type: "string" },
        tools: { type: "array", items: { type: "string" } },
        workspaceId: {
          type: "string",
          description: "目标 Workspace（仅超级 Agent 可跨 Workspace；默认=父 Agent 所在 Workspace）",
        },
        apiKey: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "workspace_create",
    description: "创建 Workspace（需超级权限）。自动创建该 Workspace 的管理 Agent + 主 session + .knowpilot/ 目录结构。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workspace 名称" },
        description: { type: "string" },
        path: { type: "string", description: "磁盘目录路径" },
        managerModel: { type: "string", description: "管理 Agent 的模型" },
        managerSystemPrompt: { type: "string", description: "管理 Agent 的 system prompt（不填用默认模板）" },
      },
      required: ["name", "path"],
    },
  },
  {
    name: "workspace_archive",
    description: "归档 Workspace（需超级权限）。归档 = 所有 Agent 设为 dormant，不跑心跳，不接收消息。可恢复。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workspace id" },
      },
      required: ["id"],
    },
  },
  {
    name: "send_email",
    description: "发送邮件通知用户（任务完成、预算耗尽、心跳失败等）。需配置 EMAIL_PROVIDER 环境变量。",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "邮件主题" },
        body: { type: "string", description: "邮件正文（纯文本）" },
        to: { type: "string", description: "收件人邮箱（不填则用 EMAIL_TO 环境变量）" },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "free_api_keys_list",
    description: "列出可用的免费 API Key（从 Credential 表中 scope=llm 且 metadata.source=free 的记录）。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "free_api_keys_fetch",
    description: "获取一个可用的免费 API Key（轮询分配，标记 lastUsedAt）。用于 Agent 无专属 key 时获取临时 key。",
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", description: "偏好提供商（如 deepseek/openai），不填则随机分配" },
      },
    },
  },
  {
    name: "skill_discover",
    description: "发现跨 Workspace 的优秀 Skill（超级 Agent 专用，Hermes 进化 #45）。扫描所有 Skill，按使用频率/成功率排序，返回值得推广的候选。",
    parameters: {
      type: "object",
      properties: {
        minSuccessRate: { type: "number", description: "最低成功率阈值（0-100），默认 80" },
        limit: { type: "number", description: "返回数量上限，默认 10" },
      },
    },
  },
  {
    name: "skill_promote",
    description: "将一个优秀 Skill 推广到其他 Workspace（超级 Agent 专用，Hermes 进化 #45）。把 Skill 复制到目标 Workspace 的 Agent 工具列表中。",
    parameters: {
      type: "object",
      properties: {
        skillId: { type: "string", description: "要推广的 Skill id" },
        targetAgentIds: { type: "array", items: { type: "string" }, description: "目标 Agent id 列表（将 Skill 加入其工具列表）" },
      },
      required: ["skillId", "targetAgentIds"],
    },
  },
  {
    name: "optimize_agent_prompt",
    description: "自动优化子 Agent 的 system prompt（管理 Agent 专用，Agent 进化高级版）。基于近期运行经验分析成功率与工具使用模式，追加优化建议到 prompt。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "目标子 Agent id" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "generate_skill_from_experience",
    description: "从 Agent 运行经验中自动生成 Skill（管理 Agent 专用，Agent 进化高级版）。分析高频工具组合，提炼为可复用的 Skill。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "分析哪个 Agent 的经验" },
        skillName: { type: "string", description: "新 Skill 的名称" },
        skillDescription: { type: "string", description: "新 Skill 的描述" },
      },
      required: ["agentId", "skillName", "skillDescription"],
    },
  }
];

/** 将剩余 TOOL_HANDLERS + 域模块一并灌入统一注册表 */
let nativeToolsRegistered = false;
function ensureNativeToolsRegistered(): void {
  // 测试清空 registry 后需能重新灌入（域工具 + 本文件剩余工具）
  const probeRemaining = NATIVE_TOOL_DEFINITIONS[0]?.name;
  if (nativeToolsRegistered && probeRemaining && getTool(probeRemaining) && getTool("read_file")) return;

  registerNativeDomains();

  for (const def of NATIVE_TOOL_DEFINITIONS) {
    const handler = TOOL_HANDLERS[def.name];
    if (!handler) {
      console.warn(`[nativeTools] 定义了 schema 但无 handler: ${def.name}`);
      continue;
    }
    const cmd: ToolCommand<NativeToolContext> = {
      name: def.name,
      kind: "native",
      schema: () => ({ description: def.description, parameters: def.parameters }),
      execute: (args, ctx) => handler(args, ctx),
    };
    registerTool(cmd);
  }
  for (const name of Object.keys(TOOL_HANDLERS)) {
    if (!getTool(name)) {
      console.warn(`[nativeTools] 有 handler 但无 schema，跳过注册: ${name}`);
    }
  }
  nativeToolsRegistered = true;
}
ensureNativeToolsRegistered();

export function listNativeTools(): NativeToolDefinition[] {
  ensureNativeToolsRegistered();
  return listTools("native").map((t) => {
    const s = t.schema();
    return { name: t.name, description: s.description, parameters: s.parameters };
  });
}

/** 异步任务工具统一命名空间：async_task_{run|status|wait|cancel}。
 * 旧名 run_async/task_status/await_async/cancel_async 已废弃并移除。 */
export const TOOL_NAME_ALIASES: Record<string, string> = {};

export async function executeNativeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: NativeToolContext,
): Promise<unknown> {
  ensureNativeToolsRegistered();
  const resolvedName = TOOL_NAME_ALIASES[name] ?? name;

  // Swarm 权限硬拦截：检查 agent 是否有权调用此工具
  if (ctx.agentSnapshot?.tier) {
    const { checkToolPermission } = await import("./swarmPermissionGuard.js");
    const permError = checkToolPermission(name, args, {
      agentTier: ctx.agentSnapshot.tier,
      agentId: ctx.agentSnapshot.id,
      agentWorkspaceId: ctx.agentSnapshot.workspaceId,
      inToolRound: ctx.inToolRound ?? false,
    });
    if (permError) {
      return {
        error: `[${permError.code}] ${permError.reason}`,
        permissionDenied: true,
      };
    }
  }

  // Mock 模式：命中已覆盖的 native 工具则走 Mock 实现，避免真实网络调用
  if (process.env.MOCK_NATIVE_TOOLS === "true") {
    const { hasMockNativeTool, executeMockNativeTool } = await import("./mockNativeTools.js");
    if (hasMockNativeTool(name)) {
      return executeMockNativeTool(name, args, ctx);
    }
  }

  const cmd = getTool(resolvedName);
  if (!cmd || cmd.kind !== "native") {
    throw new Error(
      `未知原生工具 "${resolvedName}"（原始名 "${name}"）。可用：${listTools("native")
        .map((t) => t.name)
        .join(", ")}`,
    );
  }
  const started = Date.now();
  const raw = await cmd.execute(args, ctx);
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.elapsedMs !== "number") {
      return { ...obj, elapsedMs: Date.now() - started };
    }
  }
  return raw;
}

// resolveSafePath 已抽到 ./safePath.js，被本文件多处工具复用。
// 下方保留原位置仅作历史注释，实际导入见文件顶部。

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


async function postCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const title = String(args.title || "").trim();
  if (!title) throw new Error("title 不能为空");
  const input = {
    title,
    content: String(args.content ?? ""),
    slug: args.slug ? String(args.slug) : undefined,
    excerpt: args.excerpt ? String(args.excerpt) : undefined,
    coverImage: args.coverImage ? String(args.coverImage) : null,
    category: args.category ? String(args.category) : null,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    published: args.published === true,
  };
  const result = await ctx.services.post.create(input);
  if (!result.success) throw new Error(result.error?.message || "创建文章失败");
  const post = result.data as PostEntity;
  return { id: post.id, slug: post.slug, title: post.title };
}

async function postUpdateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("id 不能为空");
  const input = {
    id,
    title: args.title !== undefined ? String(args.title) : undefined,
    content: args.content !== undefined ? String(args.content) : undefined,
    slug: args.slug !== undefined ? String(args.slug) : undefined,
    excerpt: args.excerpt !== undefined ? String(args.excerpt) : undefined,
    coverImage: args.coverImage !== undefined ? (args.coverImage ? String(args.coverImage) : null) : undefined,
    category: args.category !== undefined ? (args.category ? String(args.category) : null) : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    published: args.published !== undefined ? args.published === true : undefined,
  };
  const result = await ctx.services.post.update(input);
  if (!result.success) throw new Error(result.error?.message || "更新文章失败");
  const post = result.data as PostEntity;
  return { id: post.id, slug: post.slug, title: post.title };
}

async function postDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("id 不能为空");
  const result = await ctx.services.post.delete(id);
  if (!result.success) throw new Error(result.error?.message || "删除文章失败");
  return { id, deleted: true };
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

async function memoryCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const content = String(args.content || "").trim();
  if (!content) throw new Error("content 不能为空");
  const strength = Number(args.strength ?? 1);
  const rawType = args.type ? String(args.type) : "note";
  if (!isMemoryUserCreatable(rawType)) {
    throw new Error(
      `type 无效：${rawType}。允许：preference（偏好）、semantic（事实）、episodic（经历）、note（笔记）、procedural（流程）。不要记可从代码/文档直接查到的内容。`,
    );
  }
  const input = {
    content,
    type: rawType as MemoryUserCreatableType,
    strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 1,
    keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : [],
  };
  const result = await ctx.services.memory.create(input);
  if (!result.success) throw new Error(result.error?.message || "创建记忆失败");
  const memory = result.data as MemoryEntity;
  return { id: memory.id, type: memory.type, strength: memory.strength, keywords: memory.keywords };
}

async function memorySearchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const keyword = String(args.keyword || "");
  const type = args.type ? String(args.type) : undefined;
  const page = Math.max(1, Number(args.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(args.pageSize || 20)));
  const result = await ctx.services.memory.list({ page, pageSize, keyword: keyword || undefined, type });
  return {
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    items: result.items.map((m: MemoryEntity) => ({
      id: m.id,
      content: m.content.slice(0, 200),
      type: m.type,
      strength: m.strength,
      keywords: m.keywords,
    })),
  };
}

async function memoryDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("id 不能为空");
  const result = await ctx.services.memory.delete(id);
  if (!result.success) throw new Error(result.error?.message || "删除记忆失败");
  return { id, deleted: true };
}

async function taskRunTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = args.id ? String(args.id) : undefined;
  const name = args.name ? String(args.name) : undefined;
  if (!id && !name) throw new Error("必须提供 task id 或 name");

  let taskId = id;
  if (!taskId && name) {
    const result = await ctx.services.task.list({ page: 1, pageSize: 50 });
    const matched = result.items.find((t) => t.name === name);
    if (!matched) throw new Error(`未找到名称为 "${name}" 的 Task`);
    taskId = matched.id;
  }

  const runResult = await ctx.services.task.run(taskId!);
  if (!runResult.success) throw new Error(runResult.error?.message || "Task 执行失败");
  return { taskId, output: runResult.data };
}

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

async function captureZhihuLoginTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  return captureZhihuLoginState(Number(args.timeoutSec || 120));
}

async function browserLoginStatusTool(_args: Record<string, unknown>, _ctx: NativeToolContext) {
  return { platforms: listSavedCookiePlatforms() };
}

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

async function invokeApiTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.invokeTrpc(String(args.tool), args.args ?? {});
}


/** LLM 主动派生子 Agent：语义明确为「派生一个独立子 Agent 并立即派活」。
 *  底层实现 = agent_create_sub + agent_send_message({ autoRun: true })。
 *  waitForResult=false（默认）= 异步投递：工具立刻返回，子 Agent 自行 report_back 进父异步队列。
 *  waitForResult=true = 同步等待：父流挂起，子会话空闲后系统抓取最后一条 assistant（不强制 report_back）。 */
async function spawnSubagentTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId || !ctx.agentSnapshot) {
    throw new Error("spawn_subagent 需要在 Chat 会话中调用（缺少 sessionId 或 Agent 上下文）");
  }
  const task = String(args.task || "");
  if (!task.trim()) throw new Error("spawn_subagent 需要 task（子 Agent 任务描述）");
  const waitForResult = coerceToolBoolean(args.waitForResult);

  // 1. 创建子 Agent（或复用指定 Agent）
  let subagentId: string;
  let subagentName: string;
  if (args.agentId && typeof args.agentId === "string") {
    const resolved = await ctx.services.agent.getById(String(args.agentId));
    if (!resolved) throw new Error("spawn_subagent 指定的 Agent 不存在");
    subagentId = resolved.id;
    subagentName = resolved.name;
  } else {
    const defaultPrompt = waitForResult
      ? `你是上级 Agent 派出的子 Agent。请完成下发的任务，必要时调用工具，并给出最终答复。上级正在同步等待你的回复，无需调用 agent_report_back；写完最终答复即可。\n\n任务：${task}`
      : `你是上级 Agent 派出的子 Agent。请完成下发的任务，必要时调用工具，最终使用 agent_report_back 向上级汇报结果。\n\n任务：${task}`;
    const createResult = await agentCreateSubTool(
      {
        name: args.name ? String(args.name) : `子 Agent ${Date.now().toString(36).slice(-4)}`,
        description: args.description ? String(args.description) : undefined,
        systemPrompt: args.systemPrompt ? String(args.systemPrompt) : defaultPrompt,
        // 默认执行类工具（native: 前缀）；再按 sub tier 裁剪，杜绝物化成空 → native:all
        tools: getAllowedToolsForTier(
          "sub",
          Array.isArray(args.tools) && (args.tools as string[]).length > 0
            ? (args.tools as string[])
            : [...DEFAULT_SUBAGENT_TOOLS],
        ),
        model: args.model ? String(args.model) : undefined,
        apiKey: args.apiKey as string | undefined,
        workspaceId: args.workspaceId,
      },
      ctx,
    );
    if ("error" in createResult) throw new Error(createResult.error as string);
    subagentId = (createResult as { agentId: string }).agentId;
    subagentName = (createResult as { name: string }).name;
    // 默认名时 fire-and-forget 调 LLM 起个正常名字；cuid 不变，父 Agent 仍能靠 agentId 找到
    if (!args.name && /^子\s*Agent\s+[a-z0-9]+$/i.test(subagentName)) {
      void import("./sessionAutoName.js")
        .then(({ autoNameAgent }) => autoNameAgent(subagentId, task))
        .catch(() => undefined);
    }
  }

  // 子 Agent 主会话（UI 跳转 + 跟踪 Task 绑定）
  const mainSession = await ctx.prisma?.chatSession.findFirst({
    where: { agentId: subagentId, isMainSession: true, status: { not: "deleted" } },
  });
  const subagentSessionId = mainSession?.id;

  // 2. 立即派活。同步等待时创建跟踪 Task（deliverToQueue=false，结果走 tool return）。
  let jobId: string | undefined;
  if (ctx.sessionId && typeof ctx.services.task?.create === "function") {
    try {
      const taskLabel = subagentName || `子 Agent ${subagentId.slice(0, 6)}`;
      const created = await ctx.services.task.create({
        name: `[async] ${taskLabel}`,
        type: "async_agent",
        status: "running",
        sessionId: ctx.sessionId,
        startedAt: new Date(),
        input: {
          kind: "async_agent",
          sessionId: ctx.sessionId,
          task: task.slice(0, 500),
          taskLabel,
          agentSnapshot: {
            id: subagentId,
            model: ctx.agentSnapshot.model,
            systemPrompt: "",
            tools: [],
            tier: "sub",
            parentId: ctx.agentSnapshot.id,
            workspaceId: ctx.agentSnapshot.workspaceId,
            name: subagentName,
          },
          subagentSessionId,
          sourceType: "subagent",
          // 同步等待：结果走 tool return，禁止 autoConsume 二次喂给父会话
          deliverToQueue: !waitForResult,
        },
      } as any);
      if (created.success && created.data) {
        jobId = (created.data as { id: string }).id;
      }
    } catch (err) {
      console.warn("[spawn_subagent] 创建父会话跟踪 Task 失败:", err);
    }
  }

  const sendResult = await agentSendMessageTool(
    {
      toAgentId: subagentId,
      content: task,
      messageType: "command",
      autoRun: true,
      // 始终非阻塞首轮；同步等待在下方轮询子会话空闲 / report_back
      waitForRun: false,
    },
    ctx,
  );

  if ("error" in sendResult || !sendResult.success) {
    if (jobId) {
      await ctx.services.task
        .update({
          id: jobId,
          status: "failed",
          finishedAt: new Date(),
          output: { error: (sendResult as { error?: string }).error ?? "派活失败" },
        } as any)
        .catch(() => undefined);
    }
    return { error: (sendResult as { error?: string }).error ?? "派活失败" };
  }

  if (!waitForResult) {
    return {
      success: true,
      agentId: subagentId,
      subagentName,
      subagentSessionId,
      jobId,
      status: jobId ? "running" : undefined,
      message: `子 Agent「${subagentName}」(agentId=${subagentId}) 已派生并启动，任务完成后结果会投递回父会话。请牢记返回的 agentId / jobId，勿编造 ID。`,
    };
  }

  // 同步等待：父流挂起。完成条件：
  // 1) 子 Agent 主动 report_back → 跟踪 Task success/failed（提前结束，不进异步队列）
  // 2) 否则：子会话曾运行过（或暖机后）且当前无流、无子会话内 running/queued Task → 抓取最后一条 assistant
  const waitDeadline = Date.now() + 10 * 60 * 1000;
  const waitStartedAt = Date.now();
  let finalContent = "";
  let finalStatus: "success" | "failed" | "timeout" = "timeout";
  let sawSubStream = false;

  while (Date.now() < waitDeadline) {
    if (jobId) {
      const row = await ctx.services.task.getById(jobId);
      if (row && (row.status === "success" || row.status === "failed")) {
        finalStatus = row.status as "success" | "failed";
        const out = (row.output ?? {}) as { asyncResult?: string; error?: string };
        finalContent =
          row.status === "success"
            ? out.asyncResult || ""
            : `任务失败：${out.error || "未知错误"}`;
        await ctx.services.task
          .update({ id: jobId, delivered: true, deliveredAt: new Date() } as any)
          .catch(() => undefined);
        break;
      }
    }

    let streaming = false;
    if (subagentSessionId) {
      try {
        const { getStreamHub } = await import("./sessionStreamHub.js");
        const hub = getStreamHub();
        streaming = !!hub?.isRunning(subagentSessionId);
      } catch {
        streaming = false;
      }
    }
    if (streaming) sawSubStream = true;

    let nestedActive = 0;
    if (subagentSessionId && ctx.prisma) {
      nestedActive = await ctx.prisma.task.count({
        where: {
          sessionId: subagentSessionId,
          status: { in: ["running", "queued"] },
        },
      });
    }

    // 暖机：避免 autoRun 尚未起流时被误判为空闲
    const warmedUp = sawSubStream || Date.now() - waitStartedAt >= 2000;
    if (warmedUp && !streaming && nestedActive === 0 && subagentSessionId && ctx.prisma) {
      const last = await ctx.prisma.chatMessage.findFirst({
        where: { sessionId: subagentSessionId, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      const text = (last?.content ?? "").trim();
      if (text) {
        finalContent = text;
        finalStatus = "success";
        if (jobId) {
          await ctx.services.task
            .update({
              id: jobId,
              status: "success",
              finishedAt: new Date(),
              delivered: true,
              deliveredAt: new Date(),
              output: { asyncResult: finalContent },
            } as any)
            .catch(() => undefined);
        }
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  // 无跟踪 Task 且超时前未抓到：最后再尝试一次抓取
  if (!finalContent && subagentSessionId && ctx.prisma) {
    const last = await ctx.prisma.chatMessage.findFirst({
      where: { sessionId: subagentSessionId, role: "assistant" },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (last?.content?.trim()) {
      finalContent = last.content;
      finalStatus = "success";
    }
  }

  if (!finalContent) {
    return {
      success: finalStatus === "success",
      agentId: subagentId,
      subagentName,
      subagentSessionId,
      jobId,
      status: finalStatus,
      hint:
        finalStatus === "timeout"
          ? `子 Agent「${subagentName}」(agentId=${subagentId}) 在时限内未完成。可用 agent_inspect(id=该 agentId) 查看进度（勿编造 ID）。`
          : `子 Agent「${subagentName}」未返回有效内容。`,
    };
  }

  return {
    success: finalStatus !== "failed",
    agentId: subagentId,
    subagentName,
    subagentSessionId,
    jobId,
    status: finalStatus,
    content: finalContent,
    hint: `子 Agent「${subagentName}」(agentId=${subagentId}) 已完成。请基于 content 字段生成最终回复；标识请用返回的 agentId/jobId，不要编造 memory key 或虚构 ID。`,
  };
}

async function sessionClearTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (args.confirm !== true) {
    throw new Error("缺少确认：请将 confirm 设为 true 以删除全部 Chat 会话");
  }
  if (!ctx.services?.session?.deleteMany) {
    throw new Error("当前上下文未提供 SessionService，无法执行 session_clear");
  }
  const result = await ctx.services.session.deleteMany();
  return { deletedSessions: result.count };
}

async function sessionCompactTool(_args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId) throw new Error("session_compact 需要在 Chat 会话中调用（缺少 sessionId）");
  if (!ctx.services?.session || !ctx.services?.message) {
    throw new Error("当前上下文未提供 Session/Message Service，无法执行 session_compact");
  }

  const session = await ctx.services.session.getByIdLite(ctx.sessionId);
  if (!session) throw new Error("当前会话不存在");
  if (session.status === "archived") {
    return { success: false, error: "当前会话已归档，无法压缩。" };
  }

  const { runSessionCompact } = await import("./autoCompact.js");
  const result = await runSessionCompact({
    config: ctx.config,
    services: ctx.services,
    sessionId: ctx.sessionId,
    model: session.model || ctx.agentSnapshot?.model || "deepseek-v4-flash",
    systemPrompt: session.systemPrompt || ctx.agentSnapshot?.systemPrompt || "你是 KnowPilot 助手。",
    existingSummary: (session as { contextSummary?: string | null }).contextSummary ?? null,
    trigger: "agent",
  });

  if (!result.compacted) {
    return { success: false, message: result.message };
  }

  return {
    success: true,
    message: result.message,
    boundaryMessageId: result.boundaryMessageId,
    messagesSummarized: result.messagesSummarized,
    memoriesFlushed: result.memoriesFlushed,
    generation: result.generation,
  };
}

/**
 * 归档当前会话并开启同 Agent 新会话；总结写入 content/sessions/ 与新会话首条消息。
 * 不自动切换前端视图——通过 SSE session_rotated 提示用户手动跳转。
 */
async function sessionRotateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const summary = String(args.summary ?? "").trim();
  if (!summary) throw new Error("session_rotate 需要非空的 summary");
  if (!ctx.sessionId) throw new Error("session_rotate 需要在 Chat 会话中调用（缺少 sessionId）");
  if (!ctx.services?.session || !ctx.services?.message) {
    throw new Error("当前上下文未提供 Session/Message Service，无法执行 session_rotate");
  }

  const oldSession = await ctx.services.session.getByIdLite(ctx.sessionId);
  if (!oldSession) throw new Error("当前会话不存在");
  if (oldSession.status === "archived") {
    return {
      success: false,
      error: "当前会话已归档，请勿重复调用 session_rotate。",
      oldSessionId: oldSession.id,
      newSessionId: oldSession.rotatedToSessionId ?? undefined,
    };
  }
  if (oldSession.kind === "subagent") {
    throw new Error("子 Agent 任务会话不支持 session_rotate；请在主对话会话中轮换。");
  }

  const agentId = oldSession.agentId ?? ctx.agentSnapshot?.id ?? null;
  if (!agentId) throw new Error("无法确定 Agent，无法创建新会话");

  const reason = args.reason ? String(args.reason).trim() : undefined;
  const carryMemoryIds = Array.isArray(args.carryMemoryIds)
    ? (args.carryMemoryIds as unknown[]).map((id) => String(id)).filter(Boolean)
    : [];

  const oldTitle = String(oldSession.title || "对话").slice(0, 40);
  const newTitle =
    (args.title ? String(args.title).trim() : "") ||
    `${oldTitle} · 续`.slice(0, 60);

  // 1) 写总结文件
  const sessionsDir = path.join(ctx.config.contentDir, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const summaryFileName = `${oldSession.id}-summary.md`;
  const summaryPath = path.join(sessionsDir, summaryFileName);
  const summaryDoc = [
    "---",
    `title: "${newTitle} 会话摘要"`,
    `oldSessionId: "${oldSession.id}"`,
    `agentId: "${agentId}"`,
    `reason: "${(reason ?? "session_rotate").replace(/"/g, "'")}"`,
    `rotatedAt: "${new Date().toISOString()}"`,
    "---",
    "",
    summary,
    ""
].join("\n");
  fs.writeFileSync(summaryPath, summaryDoc, "utf8");
  const relativeSummaryPath = path
    .relative(ctx.config.projectRoot, summaryPath)
    .split(path.sep)
    .join("/");

  // 2) 创建新会话
  const created = await ctx.services.session.create({
    title: newTitle,
    model: oldSession.model || "deepseek-v4-flash",
    systemPrompt: oldSession.systemPrompt ?? undefined,
    agentId,
    kind: "chat",
    status: "active",
  } as any);
  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建新会话失败");
  }
  const newSession = created.data as { id: string; title: string };

  // 3) 新会话首条用户消息 = 总结（可选附带 Memory 引用）
  let firstMessage = `【上一会话摘要】\n\n${summary}`;
  if (carryMemoryIds.length > 0) {
    firstMessage += `\n\n【需继续参考的 Memory】\n${carryMemoryIds.map((id) => `- ${id}`).join("\n")}`;
  }
  if (reason) {
    firstMessage += `\n\n（轮换原因：${reason}）`;
  }
  await ctx.services.message.create({
    sessionId: newSession.id,
    role: "user",
    content: firstMessage,
    source: "system",
  } as any);

  // 4) 归档旧会话并记录跳转
  await ctx.services.session.update({
    id: oldSession.id,
    status: "archived",
    contextSummary: summary.slice(0, 20000),
    contextCompactedAt: new Date(),
    rotatedToSessionId: newSession.id,
  } as any);

  // 5) SSE 通知旧会话页面（不自动切换）
  try {
    const { getStreamHub } = await import("./sessionStreamHub.js");
    const hub = getStreamHub();
    hub?.pushExternalEvent(oldSession.id, {
      type: "session_rotated",
      oldSessionId: oldSession.id,
      newSessionId: newSession.id,
      newTitle: newSession.title || newTitle,
      reason,
    });
  } catch (err) {
    console.warn("[session_rotate] SSE 推送失败:", err);
  }

  await ctx.services.log?.create?.({
    level: "info",
    component: "session",
    event: "session_rotated",
    message: `会话 ${oldSession.id} → ${newSession.id}`,
    metadata: {
      oldSessionId: oldSession.id,
      newSessionId: newSession.id,
      reason,
      summaryPath: relativeSummaryPath,
      agentId,
    },
  }).catch(() => {});

  return {
    success: true,
    oldSessionId: oldSession.id,
    newSessionId: newSession.id,
    newTitle: newSession.title || newTitle,
    summaryPath: relativeSummaryPath,
    message: "已归档当前会话并创建新会话。请告知用户可点击提示跳转；不要假设页面已自动切换。",
  };
}

// ─── Swarm 管理工具实现 ───

async function agentCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 超级 Agent 创建 Agent 未指定 workspaceId 时，默认挂到系统 Workspace
  let workspaceId = args.workspaceId as string | undefined;
  if (!workspaceId && ctx.agentSnapshot?.tier === "super") {
    const systemWs = await ctx.services.prisma.workspace.findFirst({
      where: { isSystem: true, systemType: "super", status: { not: "deleted" } },
    });
    if (systemWs) workspaceId = systemWs.id;
  }
  const created = await ctx.services.agent.create({
    name: String(args.name || ""),
    description: args.description ? String(args.description) : undefined,
    model: args.model ? String(args.model) : "deepseek-v4-flash",
    systemPrompt: args.systemPrompt ? String(args.systemPrompt) : "",
    tools: Array.isArray(args.tools) ? (args.tools as string[]) : [],
    tier: args.tier as "super" | "manager" | "sub" | undefined,
    workspaceId,
    parentId: args.parentId as string | undefined,
    source: "native_tool:agent_create",
    apiKey: args.apiKey as string | undefined,
    heartbeatModel: args.heartbeatModel as string | undefined,
    heartbeat: args.heartbeat as any,
  });
  if (!created.success || !created.data) {
    return { error: created.error?.message ?? "创建 Agent 失败" };
  }
  // 管理 Agent / 子 Agent：自动创建主 session
  if ((args.tier === "manager" || args.tier === "sub") && created.data.id) {
    await ctx.services.session.create({
      title: `${args.name} 主会话`,
      model: args.model ? String(args.model) : "deepseek-v4-flash",
      agentId: created.data.id,
      isMainSession: true,
    }).catch(() => { /* 主 session 创建失败不阻塞 */ });
  }
  // 审计日志
  await ctx.services.log?.create?.({
    level: "info",
    component: "swarm",
    event: "agent_created",
    message: `Agent ${created.data.name} 被创建（tier: ${args.tier ?? "sub"}）`,
    metadata: { agentId: created.data.id, operatorAgentId: ctx.agentSnapshot?.id, tier: args.tier ?? "sub" },
  }).catch(() => {});
  return { success: true, agentId: created.data.id, name: created.data.name };
}

async function agentUpdateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { id, ...updateData } = args;
  const result = await ctx.services.agent.update({
    id: String(id),
    name: updateData.name ? String(updateData.name) : undefined,
    description: updateData.description ? String(updateData.description) : undefined,
    model: updateData.model ? String(updateData.model) : undefined,
    systemPrompt: updateData.systemPrompt ? String(updateData.systemPrompt) : undefined,
    tools: Array.isArray(updateData.tools) ? (updateData.tools as string[]) : undefined,
    apiKey: updateData.apiKey !== undefined ? String(updateData.apiKey) : undefined,
    heartbeatModel: updateData.heartbeatModel ? String(updateData.heartbeatModel) : undefined,
    heartbeat: updateData.heartbeat as any,
    status: updateData.status as any,
  } as any);
  if (!result.success) return { error: result.error?.message ?? "更新 Agent 失败" };
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "agent_updated",
    message: `Agent ${id} 被更新`,
    metadata: { agentId: String(id), operatorAgentId: ctx.agentSnapshot?.id },
  }).catch(() => {});
  return { success: true };
}

async function agentDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const targetId = String(args.id || "");
  // tombstone 删除：先 abort 运行中任务，再标记 deleted（不真删 DB 记录）
  const existing = await ctx.services.agent.getById(targetId);
  if (!existing) return { error: "Agent 不存在" };
  // 超级不能删其他 super（#16）
  if (existing.tier === "super" && ctx.agentSnapshot?.tier === "super" && targetId !== ctx.agentSnapshot.id) {
    // super 删其他 super → 检查目标是不是自己也想删（已在权限层拦截 self delete）
    return { error: "[TIER_PROTECTED] 超级 Agent 不能删除其他超级 Agent。" };
  }
  // 先标记 deleted（tombstone），保留记录
  await ctx.services.agent.update({
    id: targetId,
    status: "deleted",
  } as any).catch(() => {});
  // 审计日志
  await ctx.services.log?.create?.({
    level: "warn", component: "swarm", event: "agent_deleted",
    message: `Agent ${existing.name} 被删除（tombstone）`,
    metadata: { agentId: targetId, agentName: existing.name, operatorAgentId: ctx.agentSnapshot?.id, deletedAt: new Date().toISOString() },
  }).catch(() => {});
  return { success: true, message: `Agent ${existing.name} 已标记为 deleted（tombstone 保留）。session/message/memory 将级联清理。` };
}

async function agentInspectTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const targetId = String(args.id || "");
  // 默认不附带全局 Memory：experience 会污染父 Agent 上下文，导致把「旧任务经验」当成当前结果
  const includeMemory = args.includeMemory === true;
  const agent = await ctx.services.agent.getById(targetId);
  if (!agent) return { error: "Agent 不存在" };
  // 获取最近 session + 消息
  const sessions = await ctx.prisma?.chatSession.findMany({
    where: { agentId: targetId },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 20 } },
    take: 5,
    orderBy: { updatedAt: "desc" },
  });
  let memories: unknown[] = [];
  if (includeMemory) {
    const rows =
      (await ctx.prisma?.memory.findMany({
        where: { type: { in: ["preference", "semantic", "episodic"] } },
        take: 8,
        orderBy: { updatedAt: "desc" },
      })) ?? [];
    // 过滤 experience 风格的 JSON 任务日志，只保留可读长期记忆
    memories = rows
      .filter((m) => {
        const c = (m.content || "").trim();
        if (c.startsWith("{") && c.includes("taskDescription")) return false;
        if (m.type === "experience") return false;
        return true;
      })
      .slice(0, 5)
      .map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content.slice(0, 200),
      }));
  }
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      tier: agent.tier,
      status: agent.status,
      model: agent.model,
      systemPrompt: agent.systemPrompt.slice(0, 200),
    },
    sessions:
      sessions?.map((s: any) => ({
        id: s.id,
        title: s.title,
        isMainSession: s.isMainSession,
        messageCount: s.messages?.length,
      })) ?? [],
    recentMessages:
      sessions?.flatMap(
        (s: any) =>
          s.messages?.map((m: any) => ({
            role: m.role,
            content: m.content?.slice(0, 100),
            source: m.source,
          })) ?? [],
      ) ?? [],
    memories,
    hint: includeMemory
      ? undefined
      : "默认不返回 Memory。需要长期偏好时可传 includeMemory=true（不会返回 experience 任务日志）。请以 agent.id（cuid）为准，勿编造 ID。",
  };
}

/** 防止同一 Agent 被并发触发自动运行 */
const agentRunLocks = new Map<string, Promise<{ content: string; subagentSessionId: string }>>();

async function triggerAgentRun(targetAgentId: string, input: string, ctx: NativeToolContext): Promise<{ content: string; subagentSessionId: string }> {
  const existing = agentRunLocks.get(targetAgentId);
  if (existing) await existing;

  const runPromise = (async (): Promise<{ content: string; subagentSessionId: string }> => {
    let sessionIdForCleanup: string | undefined;
    try {
      const agent = await resolveAgent(ctx.services, targetAgentId);
      if (!agent || agent.status === "deleted") throw new Error("目标 Agent 不存在或已删除");

      let mainSession = await ctx.prisma?.chatSession.findFirst({
        where: { agentId: targetAgentId, isMainSession: true, status: { not: "deleted" } },
      });
      if (!mainSession) {
        const created = await ctx.services.session.create({
          title: `${agent.name} 主会话`,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          agentId: targetAgentId,
          isMainSession: true,
          kind: "subagent",
          parentSessionId: ctx.sessionId ?? undefined,
          status: "running",
          taskDescription: input.slice(0, 200),
        });
        if (created.success && created.data) {
          mainSession = await ctx.prisma?.chatSession.findUnique({ where: { id: (created.data as { id: string }).id } }) ?? null;
        }
      } else {
        // 已有主会话：每次派活都刷新 parentSessionId，保证 report_back 回到「本次 spawn 的父会话」
        const patch: Record<string, unknown> = { status: "running" };
        if (mainSession.kind !== "subagent") patch.kind = "subagent";
        if (ctx.sessionId) patch.parentSessionId = ctx.sessionId;
        if (Object.keys(patch).length > 0) {
          try {
            await ctx.services.session.update({ id: mainSession.id, ...patch } as any);
            mainSession = { ...mainSession, ...patch } as typeof mainSession;
          } catch {
            /* 补齐失败不阻塞运行 */
          }
        }
      }
      if (!mainSession) throw new Error("无法创建或找到目标 Agent 的主会话");
      sessionIdForCleanup = mainSession.id;

      const messageSource = (ctx.agentSnapshot?.tier ?? "super") as "super" | "manager" | "sub" | "user" | "system";
      // 幂等：同内容父任务只写一次；若已有对应 assistant 则直接返回，避免双写/双跑
      const dupUser = await ctx.prisma?.chatMessage.findFirst({
        where: {
          sessionId: mainSession.id,
          role: "user",
          content: input,
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      if (dupUser) {
        const lastAssistant = await ctx.prisma?.chatMessage.findFirst({
          where: {
            sessionId: mainSession.id,
            role: "assistant",
            createdAt: { gte: dupUser.createdAt },
          },
          select: { content: true },
          orderBy: { createdAt: "desc" },
        });
        if (lastAssistant) {
          try {
            await ctx.services.session.update({ id: mainSession.id, status: "completed" } as any);
          } catch { /* ignore */ }
          return { content: lastAssistant.content || "(无文本输出)", subagentSessionId: mainSession.id };
        }
      } else {
        await ctx.services.message.create({
          sessionId: mainSession.id,
          role: "user",
          content: input,
          source: messageSource,
        });
      }

      const { getStreamHub } = await import("./sessionStreamHub.js");
      const { runAgentLoopStream } = await import("./agentStream.js");
      const hub = getStreamHub();
      if (!hub) {
        throw new Error("SessionStreamHub 未初始化，无法启动子 Agent 流式运行");
      }

      // 已有同会话流在跑：等待其结束，再读最终 assistant（避免双跑）
      if (hub.isRunning(mainSession.id)) {
        await hub.waitFor(mainSession.id);
        const lastAssistant = await ctx.prisma?.chatMessage.findFirst({
          where: { sessionId: mainSession.id, role: "assistant" },
          select: { content: true },
          orderBy: { createdAt: "desc" },
        });
        return {
          content: lastAssistant?.content || "(无文本输出)",
          subagentSessionId: mainSession.id,
        };
      }

      const memoryHint = await buildMemoryContext(ctx.services, input);
      const tierTools = resolveToolsForAgentTier(agent.tier, agent.tools);
      const systemPrompt = buildSystemPromptWithHints(agent.systemPrompt, tierTools, memoryHint, {
        tier: agent.tier,
        name: agent.name,
      });
      const messages: LlmMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: input }
];
      const invokeTrpc = createTrpcInvoker({ services: ctx.services });
      const agentMeta = {
        id: agent.id,
        model: agent.model,
        systemPrompt,
        tools: tierTools,
        tier: agent.tier,
        parentId: agent.parentId,
        workspaceId: agent.workspaceId,
      };

      let assistantContent = "(无文本输出)";

      await hub.start(mainSession.id, {
        sessionId: mainSession.id,
        agentId: agent.id,
        message: input,
      }, async (emit, hubSignal) => {
        try {
          const loop = await runAgentLoopStream({
            config: ctx.config,
            services: ctx.services,
            agent: { model: agent.model, systemPrompt, tools: tierTools },
            messages,
            llmOptions: {},
            invokeTrpc,
            emit,
            sessionId: mainSession!.id,
            agentMeta,
            signal: hubSignal,
            runOrigin: "parent",
          });

          assistantContent =
            (loop.content && loop.content.trim()) ||
            loop.toolCalls
              .filter((t) => t.kind === "content")
              .map((t) => String(t.result ?? ""))
              .join("\n")
              .trim() ||
            "(无文本输出)";

          await ctx.services.message.create({
            sessionId: mainSession!.id,
            role: "assistant",
            content: assistantContent,
            toolCalls: loop.toolCalls as any,
            tokenUsage: loop.tokenUsage,
            source: "sub",
          });

          try {
            await ctx.services.session.update({ id: mainSession!.id, status: "completed" } as any);
          } catch { /* ignore */ }

          emit({
            type: "done",
            sessionId: mainSession!.id,
            agentId: agent.id,
            content: assistantContent,
            toolCalls: loop.toolCalls,
            model: loop.model,
            provider: loop.provider,
            roundsUsed: loop.roundsUsed,
            tokenUsage: loop.tokenUsage,
          });
        } catch (err: unknown) {
          const errorText = err instanceof Error ? err.message : String(err);
          try {
            await ctx.services.message.create({
              sessionId: mainSession!.id,
              role: "assistant",
              content: `任务未能完成：${errorText}`,
              source: "sub",
            });
          } catch { /* ignore */ }
          try {
            await ctx.services.session.update({ id: mainSession!.id, status: "failed" } as any);
          } catch { /* ignore */ }
          emit({ type: "error", message: errorText, sessionId: mainSession!.id });
          throw err;
        }
      });

      // 通知前端立刻挂接子会话流（避免切到子页后空白、刷新才出现）
      hub.pushExternalEvent(mainSession.id, {
        type: "session_run_started",
        sessionId: mainSession.id,
        reason: "subagent_start",
      });
      if (ctx.sessionId && ctx.sessionId !== mainSession.id) {
        hub.pushExternalEvent(ctx.sessionId, {
          type: "session_run_started",
          sessionId: mainSession.id,
          reason: "subagent_start",
        });
      }

      await hub.waitFor(mainSession.id);
      return { content: assistantContent, subagentSessionId: mainSession.id };
    } catch (err) {
      if (sessionIdForCleanup) {
        try {
          await ctx.services.session.update({ id: sessionIdForCleanup, status: "failed" } as any);
        } catch { /* ignore */ }
      }
      throw err;
    } finally {
      agentRunLocks.delete(targetAgentId);
    }
  })();

  agentRunLocks.set(targetAgentId, runPromise);
  return runPromise;
}

async function agentSendMessageTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { getSwarmBus } = await import("./swarmBus.js");
  const { checkAgentSendMessagePermission } = await import("./swarmPermissionGuard.js");
  if (!ctx.prisma) throw new Error("agent_send_message 需要 prisma 上下文");
  const bus = getSwarmBus(ctx.prisma, ctx.services);
  const content = String(args.content || "");
  const autoRun = args.autoRun !== false;
  const waitForRun = args.waitForRun === true;
  const toAgentId = String(args.toAgentId || "");

  // 层级/范围权限硬拦截（#49）
  const toAgent = await ctx.prisma.agent.findUnique({ where: { id: toAgentId } });
  if (!toAgent || toAgent.status === "deleted") {
    return {
      success: false,
      error: `目标 Agent ${toAgentId} 不存在或已删除。`,
      permissionDenied: true,
    };
  }
  const permissionError = await checkAgentSendMessagePermission(ctx.prisma, {
    fromAgentId: ctx.agentSnapshot?.id ?? "",
    fromTier: ctx.agentSnapshot?.tier ?? "sub",
    fromWorkspaceId: ctx.agentSnapshot?.workspaceId,
  }, toAgent);
  if (permissionError) {
    return {
      success: false,
      error: `[${permissionError.code}] ${permissionError.reason}`,
      permissionDenied: true,
    };
  }

  // autoRun：只走 triggerAgentRun（写 ChatMessage + 执行），绝不先写 pending AgentMessage。
  // 否则前端 pullAgentMessages → SessionQueueItem → consumeQueue → runStream
  // 会与 triggerAgentRun 各写一条同内容 user 气泡，并可能二次跑 Agent。
  if (autoRun && content.trim()) {
    const runPromise = triggerAgentRun(toAgentId, content, ctx).catch(async (err: unknown) => {
      console.warn(`[agent_send_message] 自动触发目标 Agent ${toAgentId} 运行失败:`, err);
      return { content: "", subagentSessionId: "" };
    });
    if (waitForRun) {
      const runResult = await runPromise;
      return {
        success: true,
        message: "已派活并自动运行。",
        content: runResult.content,
        subagentSessionId: runResult.subagentSessionId,
      };
    }
    // 非阻塞：后台跑 StreamHub；失败时 triggerAgentRun 内部会写 failed + 错误气泡
    void runPromise;
    return { success: true, message: "已派活并自动运行（子会话可实时查看流式输出）。" };
  }

  // 非 autoRun：写入收件箱，由子会话 UI 队列消费后再 runStream
  const result = await bus.send(
    {
      fromAgentId: ctx.agentSnapshot?.id ?? "",
      toAgentId,
      content,
      messageType: args.messageType as any,
      source: ctx.agentSnapshot?.tier as any,
      taskRef: args.taskRef as string | undefined,
    },
    ctx.agentSnapshot?.tier ?? "sub",
    ctx.agentSnapshot?.workspaceId ?? null,
    ctx.inToolRound ?? false,
  );

  return result.success ? { success: true, message: result.message } : { error: `[${result.error?.code}] ${result.error?.reason}` };
}

async function agentReportBackTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 软限制：有上级即可回报。异步续跑 / 用户在子会话补充后也应能 report_back。
  // 投递目标由 parentSessionId（spawn 绑定）决定，见下方桥接逻辑。
  if (!ctx.agentSnapshot?.parentId) {
    return { error: "当前 Agent 无上级（parentId 为空），无法 report_back。" };
  }
  const { getSwarmBus } = await import("./swarmBus.js");
  if (!ctx.prisma) throw new Error("agent_report_back 需要 prisma 上下文");
  const content = String(args.content || "");
  const bus = getSwarmBus(ctx.prisma, ctx.services);
  // report_back 本身就是正式向上回报通道，即使在工具轮次中也必须放行
  const result = await bus.send(
    {
      fromAgentId: ctx.agentSnapshot.id,
      toAgentId: ctx.agentSnapshot.parentId,
      content,
      messageType: (args.messageType as any) ?? "report",
      source: ctx.agentSnapshot.tier as any,
      taskRef: args.taskRef as string | undefined,
    },
    ctx.agentSnapshot?.tier ?? "sub",
    ctx.agentSnapshot?.workspaceId ?? null,
    false,
  );
  if (!result.success) {
    return { error: `[${result.error?.code}] ${result.error?.reason}` };
  }

  // 桥接：完成父会话跟踪 Task（spawn 时创建）或新建投递，供 pullAsyncQueue / 异步列表消费
  try {
    let parentSessionId: string | undefined;
    if (ctx.sessionId) {
      const subSession = await ctx.prisma.chatSession.findUnique({
        where: { id: ctx.sessionId },
        select: { parentSessionId: true },
      });
      parentSessionId = subSession?.parentSessionId ?? undefined;
    }

    // 子会话未绑 parentSessionId 时：按「跟踪 Task」反查 spawn 时的父 session（多父会话场景）
    if (!parentSessionId && ctx.prisma) {
      const trackers = await ctx.prisma.task.findMany({
        where: {
          OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
          status: { in: ["running", "queued", "success"] },
        },
        orderBy: { createdAt: "desc" },
        take: 40,
      });
      const bySubSession = trackers.find((row) => {
        const input = row.input as { subagentSessionId?: string } | null;
        return !!ctx.sessionId && input?.subagentSessionId === ctx.sessionId;
      });
      if (bySubSession?.sessionId) {
        parentSessionId = bySubSession.sessionId;
      } else {
        const byAgent = trackers.find((row) => {
          const input = row.input as { agentSnapshot?: { id?: string } } | null;
          return input?.agentSnapshot?.id === ctx.agentSnapshot?.id;
        });
        if (byAgent?.sessionId) parentSessionId = byAgent.sessionId;
      }
    }

    // 仍找不到则跳过队列桥接（SwarmBus 消息已发出）；不再回退到父 Agent isMainSession，避免投错会话
    if (!parentSessionId) {
      console.warn(
        `[agent_report_back] 无法解析父 session（子会话 ${ctx.sessionId ?? "?"} 无 parentSessionId 且无跟踪 Task），跳过异步队列投递`,
      );
    }

    if (parentSessionId) {
      const snapshot = ctx.agentSnapshot!;
      let fromName: string | undefined;
      try {
        const me = await ctx.services.agent.getById(snapshot.id);
        fromName = (me as { name?: string })?.name;
      } catch { /* ignore */ }
      const taskLabel = fromName
        ? `子 Agent 回报 · ${fromName}`
        : `子 Agent 回报 · ${snapshot.id.slice(0, 6)}`;

      // 优先完成 spawn 时挂在父会话上的 running 跟踪 Task
      let jobId: string | undefined;
      const candidates = await ctx.prisma.task.findMany({
        where: {
          sessionId: parentSessionId,
          status: { in: ["running", "queued"] },
          OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      const matched = candidates.find((row) => {
        const input = row.input as { subagentSessionId?: string; agentSnapshot?: { id?: string } } | null;
        if (!input || typeof input !== "object") return false;
        if (ctx.sessionId && input.subagentSessionId === ctx.sessionId) return true;
        return input.agentSnapshot?.id === snapshot.id;
      });

      if (matched) {
        await ctx.services.task.update({
          id: matched.id,
          status: "success",
          finishedAt: new Date(),
          output: { asyncResult: content },
        } as any);
        jobId = matched.id;
      } else {
        const created = await ctx.services.task.create({
          name: `[async] ${taskLabel}`,
          type: "async_agent",
          status: "success",
          sessionId: parentSessionId,
          finishedAt: new Date(),
          delivered: false,
          input: {
            kind: "async_agent",
            sessionId: parentSessionId,
            task: content.slice(0, 200),
            taskLabel,
            agentSnapshot: {
              id: snapshot.id,
              model: snapshot.model,
              systemPrompt: "",
              tools: [],
              tier: snapshot.tier,
              parentId: snapshot.parentId,
              workspaceId: snapshot.workspaceId,
              name: fromName,
            },
            subagentSessionId: ctx.sessionId,
            sourceType: "subagent",
          },
          output: { asyncResult: content },
        } as any);
        if (created.success && created.data) {
          jobId = (created.data as { id: string }).id;
        }
      }

      if (jobId) {
        const matchedInput = (matched?.input ?? null) as { deliverToQueue?: boolean } | null;
        // waitForResult 的跟踪 Task 已约定由 spawn 工具返回结果，勿再 autoConsume
        if (matchedInput?.deliverToQueue === false) {
          /* skip notify */
        } else {
          const { notifyAndAutoConsumeAsyncDelivery } = await import("./asyncJobManager.js");
          await notifyAndAutoConsumeAsyncDelivery({
            sessionId: parentSessionId,
            jobId,
            status: "done",
            taskLabel,
            services: ctx.services,
            config: ctx.config,
          });
        }
      }
    }
  } catch (err) {
    console.warn("[agent_report_back] 桥接父会话异步投递失败:", err);
  }

  return { success: true, message: "已向上级回报。" };
}

async function agentCreateSubTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // 默认落在当前父 Agent 所在 Workspace；仅超级 Agent 可通过 workspaceId 跨 Workspace 创建
  const callerTier = ctx.agentSnapshot?.tier ?? "sub";
  let workspaceId = ctx.agentSnapshot?.workspaceId ?? undefined;
  if (callerTier === "super" && args.workspaceId) {
    workspaceId = String(args.workspaceId);
  }
  if (!workspaceId && ctx.prisma) {
    const systemWs = await ctx.prisma.workspace.findFirst({
      where: { isSystem: true, status: { not: "deleted" } },
      select: { id: true },
    });
    workspaceId = systemWs?.id;
  }
  const rawTools = Array.isArray(args.tools) ? (args.tools as string[]) : [];
  const tools = getAllowedToolsForTier("sub", resolveToolsForAgentTier("sub", rawTools));
  const created = await ctx.services.agent.create({
    name: String(args.name || ""),
    description: args.description ? String(args.description) : undefined,
    model: args.model ? String(args.model) : "deepseek-v4-flash",
    systemPrompt: args.systemPrompt ? String(args.systemPrompt) : "",
    tools,
    tier: "sub",
    workspaceId,
    parentId: ctx.agentSnapshot?.id,
    source: "native_tool:agent_create_sub",
    apiKey: args.apiKey as string | undefined,
  });
  if (!created.success || !created.data) return { error: created.error?.message ?? "创建子 Agent 失败" };
  // 审计日志
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "sub_agent_created",
    message: `子 Agent ${created.data.name} 被创建`,
    metadata: { agentId: created.data.id, parentAgentId: ctx.agentSnapshot?.id, workspaceId: ctx.agentSnapshot?.workspaceId },
  }).catch(() => {});
  return { success: true, agentId: created.data.id, name: created.data.name };
}

async function workspaceCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const name = String(args.name || "");
  const path = String(args.path || "");
  if (!name || !path) return { error: "workspace_create 需要 name 和 path" };
  // 复用 workspaceProvision 编排（与 workspace.create tRPC 路由共享逻辑）
  const { provisionWorkspace } = await import("./workspaceProvision.js");
  const result = await provisionWorkspace(ctx.config, ctx.services, {
    name,
    path,
    description: args.description as string | undefined,
    managerModel: args.managerModel as string | undefined,
    managerSystemPrompt: args.managerSystemPrompt as string | undefined,
    operatorAgentId: ctx.agentSnapshot?.id,
    managerParentId: ctx.agentSnapshot?.id,
  });
  if (!result.success) return { error: result.error };
  return {
    success: true,
    workspaceId: result.workspaceId,
    managerAgentId: result.managerAgentId,
    message: `Workspace ${name} 已创建，管理 Agent 已就绪。`,
  };
}

async function workspaceArchiveTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const wsId = String(args.id || "");
  // 归档：Workspace status=archived + 所有 Agent status=dormant
  await ctx.services.workspace.update({ id: wsId, status: "archived" } as any).catch(() => {});
  const agents = await ctx.prisma?.agent.findMany({ where: { workspaceId: wsId, status: { not: "deleted" } } }) ?? [];
  for (const a of agents) {
    await ctx.services.agent.update({ id: a.id, status: "dormant" } as any).catch(() => {});
  }
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "workspace_archived",
    message: `Workspace ${wsId} 已归档（${agents.length} 个 Agent 设为 dormant）`,
    metadata: { workspaceId: wsId, agentCount: agents.length, operatorAgentId: ctx.agentSnapshot?.id },
  }).catch(() => {});
  return { success: true, message: `Workspace 已归档，${agents.length} 个 Agent 设为 dormant。可随时恢复。` };
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

// ─── 免费 API Key 工具 ───

async function freeApiKeysListTool(_args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const creds = await ctx.prisma.credential.findMany({
    where: { scope: { contains: "llm" } },
    select: { id: true, name: true, type: true, scope: true, lastUsedAt: true, metadata: true },
  });
  // 过滤出免费 key（metadata.source === "free"）
  const freeKeys = creds.filter((c) => {
    try {
      const meta = JSON.parse(c.metadata || "{}");
      return meta.source === "free";
    } catch {
      return false;
    }
  });
  return {
    count: freeKeys.length,
    keys: freeKeys.map((c) => ({
      id: c.id,
      name: c.name,
      lastUsedAt: c.lastUsedAt,
      // 不返回 value（安全）
    })),
  };
}

async function freeApiKeysFetchTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const provider = args.provider as string | undefined;
  const where: any = { scope: { contains: "llm" } };
  // 按 lastUsedAt 升序排列，取最久未使用的
  const creds = await ctx.prisma.credential.findMany({
    where,
    orderBy: { lastUsedAt: "asc" },
    take: 20,
  });
  // 过滤免费 key + 可选 provider 匹配
  const freeKeys = creds.filter((c) => {
    try {
      const meta = JSON.parse(c.metadata || "{}");
      if (meta.source !== "free") return false;
      if (provider && meta.provider !== provider) return false;
      return true;
    } catch {
      return false;
    }
  });
  if (freeKeys.length === 0) {
    return { error: "无可用免费 API Key。请先运行 sync-free-keys 同步，或配置 LLM_API_KEY 环境变量。" };
  }
  const picked = freeKeys[0];
  // 标记 lastUsedAt
  await ctx.prisma.credential.update({
    where: { id: picked.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});
  return {
    apiKey: picked.value,
    credentialId: picked.id,
    name: picked.name,
    hint: "使用后请勿持久化此 key，每次需要时重新获取。",
  };
}

// ─── Hermes 进化：Skill 发现与推广（#45）───

async function skillDiscoverTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const minSuccessRate = (args.minSuccessRate as number) ?? 80;
  const limit = (args.limit as number) ?? 10;
  // 查所有启用的 Skill
  const skills = await ctx.prisma.skill.findMany({
    where: { enabled: true },
    select: { id: true, name: true, description: true, icon: true, metaJson: true },
  });
  // 按 Run 表中使用该 skill 的成功率排序
  // Run.toolCalls 中可能包含 skill 调用记录，此处简化：按 skill name 在 Run 中出现次数排序
  // 完整实现需要 Run 表记录 skill 调用明细，此处用 metaJson 中的统计作为近似
  const candidates = skills.map((s) => {
    let stats = { usageCount: 0, successRate: 100 };
    try {
      const meta = JSON.parse(s.metaJson || "{}");
      if (meta.stats) stats = meta.stats;
    } catch { /* ignore */ }
    return { ...s, ...stats };
  }).filter((s) => s.successRate >= minSuccessRate)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, limit);

  return {
    count: candidates.length,
    skills: candidates.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      icon: s.icon,
      usageCount: s.usageCount,
      successRate: s.successRate,
    })),
    hint: "使用 skill_promote 将优秀 Skill 推广到其他 Workspace 的 Agent。",
  };
}

async function skillPromoteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const skillId = String(args.skillId || "");
  const targetAgentIds = Array.isArray(args.targetAgentIds) ? (args.targetAgentIds as string[]) : [];
  if (!skillId || targetAgentIds.length === 0) {
    return { error: "skill_promote 需要 skillId 和 targetAgentIds" };
  }
  // 验证 Skill 存在
  const skill = await ctx.services.skill.getById(skillId);
  if (!skill) return { error: `Skill ${skillId} 不存在` };
  const skillToolName = `skill:${skill.name}`;
  let promoted = 0;
  const errors: string[] = [];
  for (const agentId of targetAgentIds) {
    try {
      const agent = await ctx.services.agent.getById(agentId);
      if (!agent) { errors.push(`Agent ${agentId} 不存在`); continue; }
      const currentTools = agent.tools || [];
      if (currentTools.includes(skillToolName)) {
        errors.push(`Agent ${agent.name} 已有 Skill ${skill.name}`);
        continue;
      }
      // 加入 Skill 到工具列表
      await ctx.services.agent.update({
        id: agentId,
        tools: [...currentTools, skillToolName],
      } as any);
      promoted++;
    } catch (err) {
      errors.push(`Agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 审计日志
  await ctx.services.log?.create?.({
    level: "info", component: "swarm", event: "skill_promoted",
    message: `Skill ${skill.name} 推广到 ${promoted} 个 Agent`,
    metadata: { skillId, skillName: skill.name, targetAgentIds, promoted, errors, operatorAgentId: ctx.agentSnapshot?.id },
  }).catch(() => {});
  return { success: true, promoted, errors: errors.length > 0 ? errors : undefined, message: `Skill ${skill.name} 已推广到 ${promoted} 个 Agent。` };
}

// ─── Agent 进化高级版 ───

async function optimizeAgentPromptTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const { optimizeAgentPrompt } = await import("./agentEvolution.js");
  const result = await optimizeAgentPrompt(
    ctx.prisma,
    ctx.services,
    String(args.agentId || ""),
    ctx.agentSnapshot?.id ?? "",
  );
  return result.success
    ? { success: true, message: "Prompt 已优化", optimized: result.optimized }
    : { error: result.reason ?? "优化失败" };
}

async function generateSkillFromExperienceTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) return { error: "需要 prisma 上下文" };
  const { generateSkillFromExperience } = await import("./agentEvolution.js");
  const result = await generateSkillFromExperience(
    ctx.prisma,
    ctx.services,
    String(args.agentId || ""),
    String(args.skillName || ""),
    String(args.skillDescription || ""),
  );
  return result.success
    ? { success: true, skillId: result.skillId, message: `Skill 已从经验中生成` }
    : { error: result.reason ?? "生成失败" };
}

export function resolveAllowedNativeTools(agentTools: string[]): string[] | "all" {
  const native = agentTools.filter((t) => t.startsWith("native:")).map((t) => t.replace(/^native:/, ""));
  if (agentTools.length === 0) return "all";
  if (native.length === 0) return [...DEFAULT_AGENT_NATIVE];
  return native;
}

export function buildNativeToolSchemas(allowed: string[] | "all") {
  ensureNativeToolsRegistered();
  const cmds =
    allowed === "all"
      ? listTools("native")
      : listTools("native").filter((t) => allowed.includes(t.name));
  return cmds.map((t) => {
    const s = t.schema();
    return {
      type: "function" as const,
      function: { name: t.name, description: s.description, parameters: s.parameters },
    };
  });
}
