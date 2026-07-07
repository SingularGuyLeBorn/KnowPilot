/**
 * 原生工具注册表 — Agent 可直接调用的内置能力
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
import {
  smartSearch,
  parsePlatformUrl,
  scrapePage,
  resetSearchEngineConfigs,
  detectPlatform,
  isArticleFetchFatalError,
  type SearchEngineName,
} from "./metablog/index.js";
import { runShellRestricted, waitMs } from "./shellRunner.js";
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

import { DEFAULT_AGENT_NATIVE } from "@knowpilot/shared";
import { isSmokeInfoSource } from "./smokeArtifacts.js";

const execFileAsync = promisify(execFile);

export interface NativeToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NativeToolContext {
  config: AppConfig;
  services: ServiceContainer;
  prisma?: PrismaClient;
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>;
  /** 当前 Chat 会话 — run_async 等需要 */
  sessionId?: string;
  agentSnapshot?: {
    id: string;
    model: string;
    systemPrompt: string;
    tools: string[];
  };
}

type NativeToolHandler = (args: Record<string, unknown>, ctx: NativeToolContext) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, NativeToolHandler> = {
  web_search: webSearch,
  read_article: readArticleTool,
  scrape_web_page: scrapeWebPageTool,
  read_file: readFileTool,
  write_file: writeFileTool,
  append_to_file: appendToFileTool,
  list_directory: listDirectoryTool,
  file_rename: fileRenameTool,
  file_move: fileMoveTool,
  file_copy: fileCopyTool,
  search_files: searchFilesTool,
  directory_create: directoryCreateTool,
  directory_delete: directoryDeleteTool,
  file_stat: fileStatTool,
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
  file_delete: fileDeleteTool,
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
  run_async: runAsyncTool,
  run_shell: runShellTool,
  wait: waitTool,
  session_clear: sessionClearTool,
};

export const NATIVE_TOOL_DEFINITIONS: NativeToolDefinition[] = [
  {
    name: "web_search",
    description:
      "搜索互联网（MetaBlog smartSearch 多引擎；/sources 信息源启用后 Tavily/SerpAPI 优先 scoped 到信息源域名）。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        maxResults: { type: "number", description: "最大结果数，默认 5" },
        engine: {
          type: "string",
          description: "优先引擎：baidu_qianfan|metaso|bocha|tavily|bing_crawler|duckduckgo|searxng|serpapi 等",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_article",
    description:
      "读取网页文章为 Markdown（MetaBlog readArticle）。支持知乎/微信/小红书/B站/掘金/CSDN/InfoQ/SegmentFault/开源中国/博客园/简书等；InfoQ 走官方 API；SPA 站 HTTP→Playwright→DOM→Jina 降级；404/壳页明确报错；正文偏短返回 contentWarning。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "文章 URL" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        platform: { type: "string", description: "可选平台：zhihu、wechat、xiaohongshu、bilibili 等" },
        method: { type: "string", enum: ["playwright"], description: "强制 Playwright 渲染" },
        embedOcr: { type: "boolean", description: "是否 OCR 嵌入图片文字，默认 true" },
        maxChars: { type: "number", description: "返回正文最大字符数，默认 16000" },
        minChars: { type: "number", description: "可读正文下限，低于且标题像 404 则报错，默认 80" },
      },
      required: ["url"],
    },
  },
  {
    name: "scrape_web_page",
    description: "Playwright 采集网页正文、链接与元数据（MetaBlog scrapeWebPage）。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "目标 URL" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        waitFor: { type: "string", description: "可选 CSS 选择器" },
        extractArticle: { type: "boolean", description: "启发式提取正文，默认 true" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_file",
    description: "读取项目根目录内的文本文件（相对路径），支持偏移与最大长度。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径，如 content/posts/foo.md" },
        maxChars: { type: "number", description: "最大读取字符数，默认 12000" },
        offset: { type: "number", description: "起始字符偏移，默认 0" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "写入项目根目录内的文本文件（相对路径）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径" },
        content: { type: "string", description: "文件内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "append_to_file",
    description: "在项目根目录内的文本文件末尾追加内容（文件不存在则创建）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径" },
        content: { type: "string", description: "追加内容" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "列出项目内目录内容，可选递归。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对目录，默认 ." },
        recursive: { type: "boolean", description: "是否递归列出子目录，默认 false" },
      },
    },
  },
  {
    name: "file_rename",
    description: "重命名项目根目录内的文件。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "原相对路径" },
        newName: { type: "string", description: "新文件名（不含目录）" },
      },
      required: ["path", "newName"],
    },
  },
  {
    name: "file_move",
    description: "移动项目根目录内的文件到另一个相对路径。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "原相对路径" },
        dest: { type: "string", description: "目标相对路径（含文件名）" },
      },
      required: ["path", "dest"],
    },
  },
  {
    name: "file_copy",
    description: "复制项目根目录内的文件到另一个相对路径。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "原相对路径" },
        dest: { type: "string", description: "目标相对路径（含文件名）" },
      },
      required: ["path", "dest"],
    },
  },
  {
    name: "search_files",
    description: "在项目根目录内搜索包含指定关键词的文本文件，返回文件路径、行号与片段。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "搜索关键词或正则表达式" },
        path: { type: "string", description: "相对起始目录，默认 ." },
        isRegex: { type: "boolean", description: "是否将 pattern 视为正则表达式，默认 false（字面量匹配）" },
        caseSensitive: { type: "boolean", description: "是否区分大小写，默认 false" },
        glob: { type: "string", description: "文件名通配过滤，如 *.md" },
        maxResults: { type: "number", description: "最大返回结果数，默认 30" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "directory_create",
    description: "在项目根目录内创建目录（自动创建父目录）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对目录路径" },
      },
      required: ["path"],
    },
  },
  {
    name: "file_stat",
    description: "获取项目根目录内文件或目录的元信息。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对路径" },
      },
      required: ["path"],
    },
  },
  {
    name: "directory_delete",
    description: "删除项目根目录内的空目录；设置 recursive=true 可递归删除。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对目录路径" },
        recursive: { type: "boolean", description: "是否递归删除非空目录，默认 false" },
      },
      required: ["path"],
    },
  },
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
    description: "创建一条记忆（写入 content/memories）。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "记忆内容" },
        type: { type: "string", description: "类型，默认 note" },
        strength: { type: "number", description: "强度 0-1，默认 1" },
        keywords: { type: "array", items: { type: "string" }, description: "关键词列表" },
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
    name: "file_delete",
    description: "删除项目根目录内的文件（相对路径）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径" },
      },
      required: ["path"],
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
    name: "run_async",
    description:
      "启动后台异步任务（不阻塞当前对话）。任务完成后结果会自动进入发送队列最前，你可继续与用户聊天。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "交给后台 Agent 执行的任务描述" },
        label: { type: "string", description: "队列中显示的简短标签" },
        timeoutMs: { type: "number", description: "任务超时毫秒数，不填则使用全局默认值" },
      },
      required: ["task"],
    },
  },
  {
    name: "run_shell",
    description:
      "在项目根目录内执行 Shell 命令（host_restricted：超时/输出上限/危险命令拦截）。Windows 默认 PowerShell，Linux/macOS 默认 bash。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令，如 pnpm test 或 dir" },
        cwd: { type: "string", description: "相对项目根的工作目录，默认 ." },
        shell: { type: "string", enum: ["auto", "powershell", "cmd", "bash"], description: "Shell 类型，默认 auto" },
        timeoutMs: { type: "number", description: "命令超时毫秒数，不填则使用全局默认值" },
      },
      required: ["command"],
    },
  },
  {
    name: "wait",
    description: "等待指定时间（用于安装、服务启动、轮询前的延迟）。最多 300 秒。",
    parameters: {
      type: "object",
      properties: {
        seconds: { type: "number", description: "等待秒数，默认 1，最大 300" },
        ms: { type: "number", description: "或直接指定毫秒数（与 seconds 二选一）" },
      },
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
];

export function listNativeTools(): NativeToolDefinition[] {
  return NATIVE_TOOL_DEFINITIONS;
}

export async function executeNativeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: NativeToolContext,
): Promise<unknown> {
  // Mock 模式：命中已覆盖的 native 工具则走 Mock 实现，避免真实网络调用
  if (process.env.MOCK_NATIVE_TOOLS === "true") {
    const { hasMockNativeTool, executeMockNativeTool } = await import("./mockNativeTools.js");
    if (hasMockNativeTool(name)) {
      return executeMockNativeTool(name, args, ctx);
    }
  }

  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    throw new Error(`未知原生工具 "${name}"。可用：${Object.keys(TOOL_HANDLERS).join(", ")}`);
  }
  const started = Date.now();
  const raw = await handler(args, ctx);
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

interface InfoSourceSnapshot {
  name: string;
  slug?: string | null;
  url: string;
  type: string;
  description: string;
  reliability: number;
}

async function loadEnabledInfoSources(ctx: NativeToolContext): Promise<InfoSourceSnapshot[]> {
  if (!ctx.services?.infoSource?.list) return [];
  try {
    const items: Array<{
      name: string;
      url: string;
      type: string;
      description: string | null;
      reliability: number;
      sourceSlug?: string | null;
    }> = [];
    let page = 1;
    while (true) {
      const result = await ctx.services.infoSource.list({ page, pageSize: 100, enabled: true });
      items.push(...result.items);
      if (page >= result.totalPages) break;
      page += 1;
    }
    return items
      .filter((s) => !isSmokeInfoSource(s.name, s.sourceSlug))
      .slice()
      .sort((a, b) => b.reliability - a.reliability)
      .map((s) => ({
        name: s.name,
        slug: s.sourceSlug,
        url: s.url,
        type: s.type,
        description: s.description ?? "",
        reliability: s.reliability,
      }));
  } catch {
    return [];
  }
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function getInfoSourceDomains(sources: InfoSourceSnapshot[]): string[] {
  const domains = new Set<string>();
  for (const source of sources) {
    const domain = extractDomain(source.url);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

function summarizeInfoSources(sources: InfoSourceSnapshot[]) {
  return sources.map((s) => ({ name: s.name, url: s.url, reliability: s.reliability, type: s.type }));
}

function scoreInfoSourceMatch(source: InfoSourceSnapshot, query: string): number {
  const q = query.toLowerCase().trim();
  let score = source.reliability;
  const haystack = `${source.name} ${source.description} ${source.url} ${source.type}`.toLowerCase();
  if (q && haystack.includes(q)) score += 10;
  for (const word of q.split(/\s+/).filter((w) => w.length > 1)) {
    if (haystack.includes(word)) score += 2;
  }
  return score;
}

function buildInfoSourceCatalogResults(
  sources: InfoSourceSnapshot[],
  query: string,
  maxResults: number,
) {
  return sources
    .map((source) => ({ source, score: scoreInfoSourceMatch(source, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ source }) => ({
      title: source.name,
      url: source.url,
      content: source.description,
      reliability: source.reliability,
      type: source.type,
    }));
}

async function tavilySearch(
  apiKey: string,
  query: string,
  maxResults: number,
  includeDomains?: string[],
) {
  const body: Record<string, unknown> = {
    api_key: apiKey,
    query,
    max_results: maxResults,
    include_answer: true,
  };
  if (includeDomains?.length) body.include_domains = includeDomains;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily 搜索失败: HTTP ${res.status}`);
  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return {
    provider: "tavily" as const,
    answer: data.answer,
    results: (data.results || []).slice(0, maxResults),
  };
}

async function serpApiSearch(apiKey: string, query: string, maxResults: number) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(maxResults));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI 搜索失败: HTTP ${res.status}`);
  const data = (await res.json()) as { organic_results?: Array<{ title: string; link: string; snippet: string }> };
  return {
    provider: "serpapi" as const,
    results: (data.organic_results || []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    })),
  };
}

export function syncSearchEnvFromConfig(config: AppConfig) {
  const entries: Array<[string, string | undefined]> = [
    ["SEARCH_BAIDU_QIANFAN_API_KEY", config.search.baiduQianfanApiKey],
    ["SEARCH_TAVILY_API_KEY", config.search.tavilyApiKey],
    ["SEARCH_SERPAPI_API_KEY", config.search.serpApiKey],
    ["SEARCH_METASO_API_KEY", config.search.metasoApiKey],
    ["SEARCH_BOCHA_API_KEY", config.search.bochaApiKey],
    ["SEARCH_LANGSEARCH_API_KEY", config.search.langsearchApiKey],
    ["SEARCH_BRAVE_API_KEY", config.search.braveApiKey],
    ["SEARCH_BING_API_KEY", config.search.bingApiKey],
  ];
  for (const [key, val] of entries) {
    if (val) process.env[key] = val;
  }
  process.env.SEARCH_ENGINE_PRIORITY = config.search.enginePriority;
  resetSearchEngineConfigs();
}

function mapSmartSearchResponse(data: Awaited<ReturnType<typeof smartSearch>>, maxResults: number) {
  return {
    provider: data.engine,
    engine: data.engine,
    query: data.query,
    total: data.total,
    elapsedMs: data.elapsedMs,
    enginesAttempted: data.enginesAttempted,
    results: data.results.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.snippet,
      snippet: r.snippet,
      source: r.source,
    })),
  };
}

async function tryScopedInfoSourceSearch(
  args: { query: string; maxResults: number },
  ctx: NativeToolContext,
  infoSources: InfoSourceSnapshot[],
) {
  if (infoSources.length === 0) return null;

  const { query, maxResults } = args;
  const domains = getInfoSourceDomains(infoSources);
  const infoSourcesUsed = summarizeInfoSources(infoSources);
  const { tavilyApiKey, serpApiKey } = ctx.config.search;

  if (tavilyApiKey && domains.length > 0) {
    try {
      const scoped = await tavilySearch(tavilyApiKey, query, maxResults, domains);
      if (scoped.results.length > 0) {
        return { ...scoped, infoSourcesUsed, searchPhase: "infoSource-scoped" as const };
      }
    } catch {
      /* continue */
    }
  }

  if (serpApiKey && domains.length > 0) {
    try {
      const siteQuery = domains.map((d) => `site:${d}`).join(" OR ");
      const scoped = await serpApiSearch(serpApiKey, `${query} (${siteQuery})`, maxResults);
      if (scoped.results.length > 0) {
        return { ...scoped, infoSourcesUsed, searchPhase: "infoSource-scoped" as const };
      }
    } catch {
      /* continue */
    }
  }

  return null;
}

async function fallbackInfoSourceSearch(
  args: { query: string; maxResults: number },
  ctx: NativeToolContext,
  infoSources: InfoSourceSnapshot[],
) {
  const { query, maxResults } = args;
  const infoSourcesUsed = summarizeInfoSources(infoSources);
  const { tavilyApiKey, serpApiKey } = ctx.config.search;

  if (infoSources.length > 0) {
    return {
      provider: "infoSource" as const,
      query,
      results: buildInfoSourceCatalogResults(infoSources, query, maxResults),
      infoSourcesUsed,
      searchPhase: "infoSource-catalog" as const,
      note: "MetaBlog 多引擎搜索失败，回退至已启用信息源目录。",
    };
  }

  if (tavilyApiKey) {
    return {
      ...(await tavilySearch(tavilyApiKey, query, maxResults)),
      searchPhase: "general-fallback" as const,
    };
  }

  if (serpApiKey) {
    return {
      ...(await serpApiSearch(serpApiKey, query, maxResults)),
      searchPhase: "general-fallback" as const,
    };
  }

  return null;
}

async function webSearch(args: Record<string, unknown>, ctx: NativeToolContext) {
  const query = String(args.query || "");
  const maxResults = Number(args.maxResults || 5);
  const preferredEngine = args.engine ? (String(args.engine) as SearchEngineName) : undefined;
  if (!query) throw new Error("query 不能为空");

  const infoSources = await loadEnabledInfoSources(ctx);
  const infoSourcesUsed = summarizeInfoSources(infoSources);

  syncSearchEnvFromConfig(ctx.config);

  const started = Date.now();

  const scopedFirst = await tryScopedInfoSourceSearch({ query, maxResults }, ctx, infoSources);
  if (scopedFirst) {
    return { ...scopedFirst, elapsedMs: Date.now() - started };
  }

  try {
    const data = await smartSearch(query, maxResults, preferredEngine);
    return {
      ...mapSmartSearchResponse(data, maxResults),
      infoSourcesUsed: infoSources.length > 0 ? infoSourcesUsed : undefined,
      searchPhase: "smart-search" as const,
      elapsedMs: data.elapsedMs ?? Date.now() - started,
    };
  } catch (smartErr) {
    const fallback = await fallbackInfoSourceSearch({ query, maxResults }, ctx, infoSources);
    if (fallback) {
      return { ...fallback, elapsedMs: Date.now() - started };
    }
    throw smartErr instanceof Error ? smartErr : new Error(String(smartErr));
  }
}

const READ_ARTICLE_MAX_CHARS = 16_000;
/** 低于此字数且已通过 minReadable 校验时，提示 Agent 正文可能不完整 */
const READ_ARTICLE_SHORT_WARN_CHARS = 150;

/** read_article 是否应视为失效页（404 标题 / 平台壳页 + 正文过短） */
export function isUnreadableArticlePage(
  title: string,
  contentLength: number,
  minReadable = 80,
  content = "",
): boolean {
  if (content.includes("简书系信息发布平台") && content.includes("著作权归作者所有") && contentLength < 200) {
    return true;
  }
  if (contentLength >= minReadable) return false;
  if (/404|页面不存在|not found|找不到页面|http 404|page not found/i.test(title)) return true;
  if (content.includes("简书系信息发布平台") && content.includes("著作权归作者所有")) return true;
  return false;
}

export function readArticleContentWarning(contentLength: number, minReadable = 80): string | undefined {
  if (contentLength < minReadable || contentLength >= READ_ARTICLE_SHORT_WARN_CHARS) return undefined;
  return "正文较短";
}

function formatReadArticleFatalError(url: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  let platform = "unknown";
  try {
    platform = detectPlatform(new URL(url).hostname);
  } catch {
    /* ignore */
  }
  const hostMatch = msg.match(/\(([^)]+)\)\s*$/);
  const detail = (hostMatch?.[1] ?? msg.replace(/^页面(?:不可用|不存在)或已删除\s*/i, "").trim()) || msg;
  return new Error(`页面不可用或已删除 · ${platform} · ${detail.slice(0, 80)}`);
}

async function readArticleTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const url = String(args.url || "");
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  let result;
  try {
    result = await parsePlatformUrl({
      url,
      timeout: args.timeout !== undefined ? Number(args.timeout) : 30000,
      platform: args.platform ? String(args.platform) : undefined,
      method: args.method === "playwright" ? "playwright" : undefined,
      embedOcr: args.embedOcr !== false,
      fetchImageFiles: false,
    });
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw formatReadArticleFatalError(url, err);
    throw err;
  }

  const maxChars = Number(args.maxChars || READ_ARTICLE_MAX_CHARS);
  const content = result.content ?? "";
  const truncated = content.length > maxChars;
  const title = result.title ?? "";
  const minReadable = Number(args.minChars ?? 80);
  const platform = result.platform ?? "unknown";
  const contentWarning = readArticleContentWarning(content.length, minReadable);
  if (isUnreadableArticlePage(title, content.length, minReadable, content)) {
    throw new Error(`页面不可用或已删除 · ${platform} · ${title.slice(0, 80)}`);
  }

  return {
    title: result.title,
    author: result.author,
    platform: result.platform,
    url: result.url,
    method: result.method,
    content: truncated ? content.slice(0, maxChars) : content,
    contentTruncated: truncated,
    contentChars: content.length,
    contentWarning,
    suggestedTool: contentWarning ? "scrape_web_page" : undefined,
    elapsedMs: Date.now() - started,
    images: result.images?.slice(0, 20),
    videos: result.videos,
    metadata: result.metadata,
  };
}

async function scrapeWebPageTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const url = String(args.url || "");
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  const result = await scrapePage({
    url,
    timeout: args.timeout !== undefined ? Number(args.timeout) : 30000,
    waitFor: args.waitFor ? String(args.waitFor) : undefined,
    extractArticle: args.extractArticle !== false,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error || "网页采集失败");
  }

  const { data } = result;
  let platform = "unknown";
  try {
    platform = detectPlatform(new URL(url).hostname);
  } catch {
    /* ignore */
  }

  return {
    url: data.url,
    title: data.title,
    description: data.description,
    text: data.text.slice(0, 12000),
    textChars: data.text.length,
    textTruncated: data.text.length > 12000,
    method: "playwright",
    platform,
    elapsedMs: Date.now() - started,
    links: data.links.slice(0, 30),
    images: data.images.slice(0, 20),
    metadata: data.metadata,
    scrapedAt: data.scrapedAt,
  };
}

async function readFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  if (!fs.statSync(abs).isFile()) throw new Error("目标不是文件");
  const maxChars = Number(args.maxChars || 12000);
  const offset = Math.max(0, Number(args.offset || 0));
  const content = fs.readFileSync(abs, "utf8");
  const totalChars = content.length;
  const slice = content.slice(offset, offset + maxChars);
  return {
    path: args.path,
    offset,
    totalChars,
    truncated: totalChars > offset + maxChars,
    content: slice,
  };
}

async function writeFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(args.content ?? ""), "utf8");
  return { path: args.path, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
}

async function appendToFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(abs, String(args.content ?? ""), "utf8");
  return { path: args.path, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
}

async function listDirectoryTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path || "."));
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${args.path || "."}`);
  if (args.recursive === true) {
    const entries: Array<{ path: string; type: "file" | "directory" }> = [];
    function walk(dir: string, prefix: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        entries.push({ path: rel.replace(/\\/g, "/"), type: e.isDirectory() ? "directory" : "file" });
        if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      }
    }
    walk(abs, path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/"));
    return entries;
  }
  return fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "directory" : "file",
  }));
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

async function fileDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持删除目录，请指定文件: ${args.path}`);
  fs.unlinkSync(abs);
  return { path: args.path, deleted: true };
}

async function fileRenameTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持重命名目录: ${args.path}`);
  const newName = String(args.newName || "").trim();
  if (!newName) throw new Error("newName 不能为空");
  if (newName.includes("/") || newName.includes("\\")) throw new Error("newName 不能包含目录分隔符");
  const dest = path.join(path.dirname(abs), newName);
  if (!dest.startsWith(path.resolve(ctx.config.projectRoot))) throw new Error("目标路径超出项目根目录范围");
  if (fs.existsSync(dest)) throw new Error(`目标已存在: ${newName}`);
  fs.renameSync(abs, dest);
  return { from: args.path, to: path.relative(ctx.config.projectRoot, dest).replace(/\\/g, "/") };
}

async function fileMoveTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) throw new Error(`不支持移动目录: ${args.path}`);
  const destRel = String(args.dest || "").trim();
  if (!destRel) throw new Error("dest 不能为空");
  const destAbs = resolveSafePath(ctx.config, destRel);
  if (fs.existsSync(destAbs)) throw new Error(`目标已存在: ${destRel}`);
  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(abs, destAbs);
  return { from: args.path, to: destRel };
}

async function fileCopyTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${args.path}`);
  if (!fs.statSync(abs).isFile()) throw new Error(`只能复制文件: ${args.path}`);
  const destRel = String(args.dest || "").trim();
  if (!destRel) throw new Error("dest 不能为空");
  const destAbs = resolveSafePath(ctx.config, destRel);
  if (fs.existsSync(destAbs)) throw new Error(`目标已存在: ${destRel}`);
  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(abs, destAbs);
  return { from: args.path, to: destRel };
}

async function searchFilesTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const root = resolveSafePath(ctx.config, String(args.path || "."));
  if (!fs.existsSync(root)) throw new Error(`目录不存在: ${args.path || "."}`);
  const rawPattern = String(args.pattern || "");
  if (!rawPattern) throw new Error("pattern 不能为空");
  const isRegex = args.isRegex === true;
  const caseSensitive = args.caseSensitive === true;
  const flags = caseSensitive ? "" : "i";
  const regex = isRegex
    ? new RegExp(rawPattern, flags)
    : new RegExp(rawPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  const maxResults = Math.min(200, Math.max(1, Number(args.maxResults || 30)));
  const glob = args.glob ? String(args.glob) : undefined;
  const globRegex = glob
    ? new RegExp(
        "^" +
          glob
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".") +
          "$",
        flags,
      )
    : undefined;
  const results: Array<{ file: string; line: number; snippet: string }> = [];
  const skipDirs = new Set(["node_modules", ".git", ".next", "dist", "out", "tmp", "weights", "backups"]);

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (globRegex && !globRegex.test(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (
        [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp4", ".mp3", ".pdf", ".zip", ".gz", ".exe", ".dll", ".db", ".db-wal", ".db-shm"].includes(ext)
      ) {
        continue;
      }
      try {
        const text = fs.readFileSync(abs, "utf8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line && regex.test(line)) {
            results.push({
              file: path.relative(ctx.config.projectRoot, abs).replace(/\\/g, "/"),
              line: i + 1,
              snippet: line.slice(0, 160),
            });
            if (results.length >= maxResults) return;
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }
  }

  walk(root);
  return { pattern: rawPattern, isRegex, caseSensitive, glob: glob ?? null, total: results.length, results };
}

async function directoryCreateTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (fs.existsSync(abs)) throw new Error(`路径已存在: ${args.path}`);
  fs.mkdirSync(abs, { recursive: true });
  return { path: args.path, created: true };
}

async function fileStatTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`文件或目录不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  return {
    path: args.path,
    exists: true,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  };
}

async function directoryDeleteTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${args.path}`);
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error(`目标不是目录: ${args.path}`);
  if (args.recursive === true) {
    fs.rmSync(abs, { recursive: true, force: true });
  } else {
    fs.rmdirSync(abs);
  }
  return { path: args.path, deleted: true };
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
  const input = {
    content,
    type: args.type ? String(args.type) : "note",
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

async function runAsyncTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId || !ctx.agentSnapshot) {
    throw new Error("run_async 需要在 Chat 会话中调用（缺少 sessionId 或 Agent 上下文）");
  }
  const { startAsyncAgentTask } = await import("./asyncJobManager.js");
  const timeoutMs =
    args.timeoutMs !== undefined ? Math.max(1000, Number(args.timeoutMs)) : undefined;
  return startAsyncAgentTask({
    sessionId: ctx.sessionId,
    task: String(args.task || ""),
    label: args.label ? String(args.label) : undefined,
    timeoutMs,
    config: ctx.config,
    services: ctx.services,
    agent: ctx.agentSnapshot,
  });
}

async function runShellTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return runShellRestricted(ctx.config, String(args.command || ""), {
    cwd: args.cwd ? String(args.cwd) : undefined,
    shell: args.shell ? String(args.shell) : undefined,
    timeoutMs: args.timeoutMs !== undefined ? Math.max(1000, Number(args.timeoutMs)) : undefined,
  });
}

async function waitTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const ms =
    args.ms !== undefined
      ? Number(args.ms)
      : Math.round(Number(args.seconds !== undefined ? args.seconds : 1) * 1000);
  if (!Number.isFinite(ms)) throw new Error("seconds/ms 必须是有效数字");
  const result = await waitMs(ms);
  return { ...result, waitedSeconds: result.waitedMs / 1000 };
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

export function resolveAllowedNativeTools(agentTools: string[]): string[] | "all" {
  const native = agentTools.filter((t) => t.startsWith("native:")).map((t) => t.replace(/^native:/, ""));
  if (agentTools.length === 0) return "all";
  if (native.length === 0) return [...DEFAULT_AGENT_NATIVE];
  return native;
}

export function buildNativeToolSchemas(allowed: string[] | "all") {
  const defs = allowed === "all" ? NATIVE_TOOL_DEFINITIONS : NATIVE_TOOL_DEFINITIONS.filter((d) => allowed.includes(d.name));
  return defs.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}
