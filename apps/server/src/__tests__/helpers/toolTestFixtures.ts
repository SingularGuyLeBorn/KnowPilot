/**
 * Agent 工具单元测试 — 共享 fixture
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { AppConfig } from "../../infra/config.js";
import type { NativeToolContext } from "../../infra/nativeTools.js";
import type { AgentToolContext, ParsedAgentTools } from "../../infra/agentTools.js";
import type { SkillEntity } from "../../services.js";

export function createTempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kp-tool-test-"));
}

export function createTestConfig(projectRoot: string, overrides?: Partial<AppConfig>): AppConfig {
  return {
    port: 3010,
    projectRoot,
    contentDir: path.join(projectRoot, "content"),
    contentPaths: {
      posts: path.join(projectRoot, "content", "posts"),
      agents: path.join(projectRoot, "content", "agents"),
      skills: path.join(projectRoot, "content", "skills"),
      mcp: path.join(projectRoot, "content", "mcp"),
      memories: path.join(projectRoot, "content", "memories"),
      tasks: path.join(projectRoot, "content", "tasks"),
      prompts: path.join(projectRoot, "content", "prompts"),
      sources: path.join(projectRoot, "content", "sources"),
    },
    uploadDir: path.join(projectRoot, "content", "uploads"),
    env: "test",
    publicUrl: "",
    corsOrigins: [],
    serverInternalUrl: "http://127.0.0.1:3010",
    webHost: "127.0.0.1",
    llm: {
      defaultProvider: "deepseek",
      dailyBudget: 0,
      maxToolRounds: 8,
      providers: {},
    },
    asyncJobs: { maxConcurrent: 2, maxPerSession: 2, taskTimeoutMs: 60_000 },
    ocr: {
      paddleCliPath: path.join(projectRoot, "missing-paddle.py"),
      paddlePythonPath: "python3",
      ppocrHome: path.join(projectRoot, "weights", "ocr", "paddleocr"),
      ocrSpaceApiKey: "",
      ocrSpaceDefaultLang: "chs",
    },
    search: {
      tavilyApiKey: "",
      serpApiKey: "",
      baiduQianfanApiKey: "",
      metasoApiKey: "",
      bochaApiKey: "",
      langsearchApiKey: "",
      braveApiKey: "",
      bingApiKey: "",
      enginePriority: "bing_crawler,tavily",
    },
    integrations: {
      feishu: { appId: "", appSecret: "", userAccessToken: "", tenantAccessToken: "" },
      yuque: { session: "", ctoken: "" },
      github: { token: "" },
    },
    auth: {
      mode: "none",
      password: "",
      token: "",
    },
    cloudflare: {
      tunnelToken: "",
    },
    shell: {
      enabled: true,
      mode: "host_restricted",
      timeoutMs: 30_000,
      maxOutputChars: 12_000,
      shell: "auto",
    },
    ...overrides,
  };
}

export function createNativeCtx(
  projectRoot: string,
  opts?: {
    config?: Partial<AppConfig>;
    invokeTrpc?: (tool: string, args?: unknown) => Promise<unknown>;
    services?: NativeToolContext["services"];
  },
): NativeToolContext {
  const config = createTestConfig(projectRoot, opts?.config);
  return {
    config,
    services: opts?.services ?? ({} as NativeToolContext["services"]),
    invokeTrpc: opts?.invokeTrpc ?? (async () => ({ ok: true })),
  };
}

export function createAgentCtx(
  projectRoot: string,
  parsed: ParsedAgentTools,
  opts?: Parameters<typeof createNativeCtx>[1],
): AgentToolContext {
  const base = createNativeCtx(projectRoot, opts);
  return {
    ...base,
    allowedNative: parsed.native,
    allowedSkills: parsed.skills,
    allowedMcpServers: parsed.mcpServers,
  };
}

export function makeSkillEntity(partial: Partial<SkillEntity> & Pick<SkillEntity, "name">): SkillEntity {
  return {
    id: partial.id ?? "skill-id",
    description: partial.description ?? "test skill",
    code: partial.code ?? "# prompt skill",
    icon: partial.icon ?? "Wand2",
    trigger: partial.trigger ?? null,
    enabled: partial.enabled ?? true,
    metaJson: partial.metaJson ?? null,
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
    ...partial,
  };
}

export const ALL_NATIVE_TOOL_NAMES = [
  "web_search",
  "read_article",
  "scrape_web_page",
  "read_file",
  "write_file",
  "list_directory",
  "file_rename",
  "file_move",
  "file_copy",
  "file_delete",
  "search_files",
  "directory_create",
  "directory_delete",
  "file_stat",
  "post_create",
  "post_update",
  "git_status",
  "git_branch",
  "git_checkout",
  "git_log",
  "git_diff",
  "git_commit",
  "git_pull",
  "git_push",
  "task_run",
  "yuque_get_doc",
  "github_search_repos",
  "feishu_send_text",
  "invoke_api",
  "run_async",
  "run_shell",
  "wait",
] as const;
