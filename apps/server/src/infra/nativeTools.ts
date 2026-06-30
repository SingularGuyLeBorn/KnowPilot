/**
 * 原生工具注册表 — Agent 可直接调用的内置能力
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
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
  list_directory: listDirectoryTool,
  git_status: gitStatusTool,
  git_log: gitLogTool,
  git_diff: gitDiffTool,
  git_commit: gitCommitTool,
  git_pull: gitPullTool,
  git_push: gitPushTool,
  file_delete: fileDeleteTool,
  task_run: taskRunTool,
  yuque_get_doc: yuqueGetDocTool,
  github_search_repos: githubSearchReposTool,
  feishu_send_text: feishuSendTextTool,
  invoke_api: invokeApiTool,
  run_async: runAsyncTool,
  run_shell: runShellTool,
  wait: waitTool,
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
    description: "读取项目根目录内的文本文件（相对路径）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的路径，如 content/posts/foo.md" },
        maxChars: { type: "number", description: "最大读取字符数，默认 12000" },
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
    name: "list_directory",
    description: "列出项目内目录内容。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对目录，默认 ." },
      },
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
    description: "通过语雀 API 获取文档内容（需配置 YUQUE_SESSION）。",
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
    name: "feishu_send_text",
    description: "向飞书用户/群发送文本（需配置 FEISHU_TENANT_ACCESS_TOKEN）。",
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
];

export function listNativeTools(): NativeToolDefinition[] {
  return NATIVE_TOOL_DEFINITIONS;
}

export async function executeNativeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: NativeToolContext,
): Promise<unknown> {
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

function resolveSafePath(config: AppConfig, relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("路径不允许包含 ..");
  const abs = path.resolve(config.projectRoot, normalized);
  const root = path.resolve(config.projectRoot);
  if (!abs.startsWith(root)) throw new Error("路径超出项目根目录范围");
  return abs;
}

async function resolveRepoPath(ctx: NativeToolContext, repoId?: string, repoPath?: string): Promise<string> {
  if (repoPath) return resolveSafePath(ctx.config, repoPath);
  if (repoId) {
    const repo = await ctx.services.git.getById(repoId);
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
  const content = fs.readFileSync(abs, "utf8");
  return { path: args.path, truncated: content.length > maxChars, content: content.slice(0, maxChars) };
}

async function writeFileTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path));
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(args.content ?? ""), "utf8");
  return { path: args.path, bytes: Buffer.byteLength(String(args.content ?? ""), "utf8") };
}

async function listDirectoryTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const abs = resolveSafePath(ctx.config, String(args.path || "."));
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${args.path || "."}`);
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
  const { session, ctoken } = ctx.config.integrations.yuque;
  if (!session) throw new Error("未配置 YUQUE_SESSION");
  const res = await fetch(`https://www.yuque.com/api/v2/repos/${args.namespace}/docs/${args.slug}`, {
    headers: {
      Cookie: `_yuque_session=${session}`,
      ...(ctoken ? { "X-Auth-Token": ctoken } : {}),
      "User-Agent": "KnowPilot/1.0",
    },
  });
  if (!res.ok) throw new Error(`语雀 API 失败: HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { title?: string; body?: string; slug?: string } };
  return { title: data.data?.title, slug: data.data?.slug, body: (data.data?.body || "").slice(0, 12000) };
}

async function githubSearchReposTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = ctx.config.integrations.github.token;
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", String(args.query));
  url.searchParams.set("per_page", String(args.limit || 5));
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "KnowPilot/1.0",
    },
  });
  if (!res.ok) throw new Error(`GitHub API 失败: HTTP ${res.status}`);
  const data = (await res.json()) as { items?: Array<{ full_name: string; html_url: string; description: string; stargazers_count: number }> };
  return (data.items || []).map((r) => ({ name: r.full_name, url: r.html_url, description: r.description, stars: r.stargazers_count }));
}

async function feishuSendTextTool(args: Record<string, unknown>, ctx: NativeToolContext) {
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

async function invokeApiTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.invokeTrpc(String(args.tool), args.args ?? {});
}

async function runAsyncTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.sessionId || !ctx.agentSnapshot) {
    throw new Error("run_async 需要在 Chat 会话中调用（缺少 sessionId 或 Agent 上下文）");
  }
  const { startAsyncAgentTask } = await import("./asyncJobManager.js");
  return startAsyncAgentTask({
    sessionId: ctx.sessionId,
    task: String(args.task || ""),
    label: args.label ? String(args.label) : undefined,
    config: ctx.config,
    services: ctx.services,
    agent: ctx.agentSnapshot,
  });
}

async function runShellTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return runShellRestricted(ctx.config, String(args.command || ""), {
    cwd: args.cwd ? String(args.cwd) : undefined,
    shell: args.shell ? String(args.shell) : undefined,
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

export function resolveAllowedNativeTools(agentTools: string[]): string[] | "all" {
  const native = agentTools.filter((t) => t.startsWith("native:")).map((t) => t.replace(/^native:/, ""));
  if (agentTools.length === 0) return "all";
  if (native.length === 0) return ["web_search", "read_file", "list_directory", "invoke_api"];
  return native;
}

export function buildNativeToolSchemas(allowed: string[] | "all") {
  const defs = allowed === "all" ? NATIVE_TOOL_DEFINITIONS : NATIVE_TOOL_DEFINITIONS.filter((d) => allowed.includes(d.name));
  return defs.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}
