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
    emailProvider: "none",
    llm: {
      defaultProvider: "deepseek",
      dailyBudget: 0,
      maxToolRounds: 8,
      maxToolCallsPerRun: 168,
      toolCallTimeoutMs: 30_000,
      toolCallConcurrency: 4,
      providers: {},
    },
    asyncJobs: { maxConcurrent: 2, maxPerSession: 2, taskTimeoutMs: 60_000, queuedTimeoutMs: 0, maxRetries: 3, maxSubagentsPerSession: 10 },
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
    stream: {
      ringSize: 100,
      persist: false,
      eventTtlMs: 0,
      cleanupIntervalMs: 0,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    },
    compact: {
      enabled: true,
      triggerRatio: 0.75,
      charThreshold: 48_000,
      keepRecent: 8,
      microCompact: { enabled: true, toolResultMaxChars: 4000 },
      memoryFlush: { enabled: true, maxFacts: 5 },
    },
    heartbeat: {
      loopContract: { maxStaleRounds: 3, maxEvidence: 50 },
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
    prisma?: NativeToolContext["prisma"];
  },
): NativeToolContext {
  const config = createTestConfig(projectRoot, opts?.config);
  return {
    config,
    services: opts?.services ?? ({} as NativeToolContext["services"]),
    prisma: opts?.prisma,
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
  "rss_fetch",
  "rss_draft_posts",
  "read_article",
  "scrape_web_page",
  "read_file",
  "write_file",
  "append_to_file",
  "list_directory",
  "file_rename",
  "file_move",
  "file_copy",
  "search_files",
  "directory_create",
  "file_stat",
  "directory_delete",
  "post_create",
  "post_update",
  "post_delete",
  "memory_create",
  "memory_search",
  "memory_delete",
  "git_branch",
  "git_checkout",
  "git_clone",
  "git_status",
  "git_log",
  "git_diff",
  "git_commit",
  "git_pull",
  "git_push",
  "file_delete",
  "task_run",
  "yuque_get_doc",
  "yuque_list_books",
  "yuque_get_book_toc",
  "yuque_create_doc",
  "yuque_update_doc",
  "yuque_delete_doc",
  "yuque_list_repos",
  "yuque_list_docs",
  "yuque_create_doc_v2",
  "yuque_update_doc_v2",
  "yuque_delete_doc_v2",
  "capture_zhihu_login",
  "browser_login_status",
  "github_search_repos",
  "github_get_repo",
  "github_create_repo",
  "github_update_repo",
  "github_get_file",
  "github_create_file",
  "github_update_file",
  "github_delete_file",
  "github_list_issues",
  "github_get_issue",
  "github_create_issue",
  "github_update_issue",
  "github_list_pull_requests",
  "github_get_pull_request",
  "github_create_pull_request",
  "github_list_branches",
  "github_get_branch",
  "github_create_branch",
  "github_list_workflows",
  "github_trigger_workflow",
  "github_create_release",
  "github_tool",
  "feishu_send_text",
  "feishu_send_message",
  "feishu_get_doc",
  "feishu_create_doc",
  "feishu_search_docs",
  "feishu_get_wiki_space",
  "feishu_get_wiki_nodes",
  "feishu_create_spreadsheet",
  "feishu_append_spreadsheet_values",
  "feishu_token_status",
  "feishu_refresh_token",
  "invoke_api",
  "async_task_run",
  "spawn_subagent",
  "async_task_status",
  "async_task_wait",
  "async_task_cancel",
  "run_shell",
  "wait",
  "sleep",
  "session_clear",
  "session_rotate",
  "session_compact",
  // Swarm 管理工具
  "agent_create",
  "agent_update",
  "agent_delete",
  "agent_inspect",
  "agent_send_message",
  "agent_report_back",
  "agent_create_sub",
  "workspace_create",
  "workspace_archive",
  "send_email",
  "free_api_keys_list",
  "free_api_keys_fetch",
  "skill_discover",
  "skill_promote",
  "optimize_agent_prompt",
  "generate_skill_from_experience",
] as const;
