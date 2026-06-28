/**
 * 原生工具注册表 — Agent 可直接调用的内置能力
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";

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
}

type NativeToolHandler = (args: Record<string, unknown>, ctx: NativeToolContext) => Promise<unknown>;

const TOOL_HANDLERS: Record<string, NativeToolHandler> = {
  web_search: webSearch,
  read_file: readFileTool,
  write_file: writeFileTool,
  list_directory: listDirectoryTool,
  git_status: gitStatusTool,
  git_log: gitLogTool,
  git_diff: gitDiffTool,
  yuque_get_doc: yuqueGetDocTool,
  github_search_repos: githubSearchReposTool,
  feishu_send_text: feishuSendTextTool,
  invoke_api: invokeApiTool,
};

export const NATIVE_TOOL_DEFINITIONS: NativeToolDefinition[] = [
  {
    name: "web_search",
    description: "搜索互联网获取最新信息。优先 Tavily，回退 SerpAPI。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        maxResults: { type: "number", description: "最大结果数，默认 5" },
      },
      required: ["query"],
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
  return handler(args, ctx);
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

async function webSearch(args: Record<string, unknown>, ctx: NativeToolContext) {
  const query = String(args.query || "");
  const maxResults = Number(args.maxResults || 5);
  if (!query) throw new Error("query 不能为空");

  const { tavilyApiKey, serpApiKey } = ctx.config.search;

  if (tavilyApiKey) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: tavilyApiKey, query, max_results: maxResults, include_answer: true }),
    });
    if (!res.ok) throw new Error(`Tavily 搜索失败: HTTP ${res.status}`);
    const data = (await res.json()) as { answer?: string; results?: Array<{ title: string; url: string; content: string }> };
    return { provider: "tavily", answer: data.answer, results: (data.results || []).slice(0, maxResults) };
  }

  if (serpApiKey) {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", serpApiKey);
    url.searchParams.set("num", String(maxResults));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SerpAPI 搜索失败: HTTP ${res.status}`);
    const data = (await res.json()) as { organic_results?: Array<{ title: string; link: string; snippet: string }> };
    return {
      provider: "serpapi",
      results: (data.organic_results || []).slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.link,
        content: r.snippet,
      })),
    };
  }

  throw new Error("未配置 SEARCH_TAVILY_API_KEY 或 SEARCH_SERPAPI_API_KEY");
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
