/**
 * Agent 工具桥 — 统一 native / skill / mcp 三类工具的解析、Schema 构建与执行
 * 含：skill:* 通配 · 只读工具并发 · 写入串行
 */

import type { LlmToolCall } from "./llmClient.js";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { DEFAULT_AGENT_NATIVE } from "@knowpilot/shared";
import {
  buildNativeToolSchemas,
  executeNativeTool,
  listNativeTools,
  type NativeToolContext,
} from "./nativeTools.js";
import {
  buildSkillToolSchema,
  executeSkill,
  findSkillsByNames,
  parseSkillToolName,
  skillToolName,
} from "./skillRunner.js";
import {
  buildMcpToolSchemas,
  executeMcpTool,
  parseMcpToolName,
} from "./mcpClient.js";

function parseToolCallArgs(call: LlmToolCall): { name: string; args: Record<string, unknown> } {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    args = { raw: call.function.arguments };
  }
  return { name: call.function.name, args };
}

export interface ParsedAgentTools {
  native: string[] | "all";
  skills: string[];
  skillWildcard: boolean;
  mcpServers: string[];
}

export interface AgentToolContext extends NativeToolContext {
  allowedNative: string[] | "all";
  allowedSkills: string[];
  allowedMcpServers: string[];
}

export interface ToolRegistryEntry {
  kind: ToolKind;
  nativeName?: string;
  skillName?: string;
  mcpExternalName?: string;
  concurrencySafe?: boolean;
  /** 并发分级：A=纯CPU/内存高并发 B=网络只读中并发 C=本地进程低并发 D=写入/副作用串行 */
  concurrencyClass?: "A" | "B" | "C" | "D";
}

type ToolKind = "native" | "skill" | "mcp";

const DEFAULT_NATIVE = [...DEFAULT_AGENT_NATIVE];

/** 可并发执行的工具（只读 / 无副作用） */
const READ_ONLY_NATIVE = new Set(["web_search", "read_article", "scrape_web_page", "read_file", "list_directory", "wait", "sleep"]);

/**
 * 工具并发分级（用于 executeToolCallsBatch 分桶，避免三四个慢工具拖垮快工具）：
 * A 纯 CPU/内存（高并发 8）、B 网络只读（中并发 4）、C 本地进程（低并发 2）、D 写入/副作用（串行 1）
 */
const CONCURRENCY_CLASS_NATIVE: Record<string, "A" | "B" | "C" | "D"> = {
  // A: 纯本地只读/等待，几乎不占资源
  read_article: "A",
  read_file: "A",
  list_directory: "A",
  search_files: "A",
  wait: "A",
  sleep: "A",
  file_stat: "A",
  directory_create: "D",
  search_global: "A",
  // B: 网络只读
  web_search: "B",
  scrape_web_page: "B",
  invoke_api: "B",
  github_list_issues: "B",
  github_get_issue: "B",
  github_list_pull_requests: "B",
  github_get_pull_request: "B",
  github_list_branches: "B",
  github_get_branch: "B",
  github_list_workflows: "B",
  feishu_search_docs: "B",
  feishu_get_wiki_space: "B",
  feishu_get_wiki_nodes: "B",
  feishu_get_doc: "B",
  feishu_token_status: "B",
  // C: 本地进程 / OCR / shell（重资源）
  run_shell: "C",
  run_async: "A",
  task_status: "A",
  cancel_async: "A",
  await_async: "B",
  // D: 写入 / 副作用（串行）
  write_file: "D",
  append_to_file: "D",
  file_rename: "D",
  file_move: "D",
  file_copy: "D",
  directory_delete: "D",
  github_create_pull_request: "D",
  github_create_branch: "D",
  github_trigger_workflow: "D",
  github_create_release: "D",
  github_tool: "D",
  feishu_send_text: "D",
  feishu_send_message: "D",
  feishu_create_doc: "D",
  feishu_create_spreadsheet: "D",
  feishu_append_spreadsheet_values: "D",
  feishu_refresh_token: "D",
  session_clear: "D",
};

const CLASS_CONCURRENCY: Record<"A" | "B" | "C" | "D", number> = { A: 8, B: 4, C: 2, D: 1 };

/** 长等待工具：不受默认 30s 工具超时限制，使用 10 分钟等待上限（与 waitForAsyncJob 对齐）。
 *  这些工具实现 Pause-on-Result 语义：LLM 表达等待意图 → 阻塞等任务完成 → 拿到结果继续生成最终答案 */
const LONG_WAIT_TOOLS = new Set(["await_async", "async_task_wait", "sleep"]);
const LONG_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

function getToolConcurrencyClass(name: string, registry: Map<string, ToolRegistryEntry>): "A" | "B" | "C" | "D" {
  const entry = registry.get(name);
  if (entry?.concurrencyClass) return entry.concurrencyClass;
  if (entry?.kind === "mcp") return "B"; // MCP 默认网络类
  if (entry?.kind === "skill") return "B"; // skill 默认网络类
  const nativeName = entry?.nativeName || name;
  return CONCURRENCY_CLASS_NATIVE[nativeName] ?? "B";
}

const agentSchemaCache = new Map<
  string,
  {
    schemas: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    registryEntries: Array<[string, ToolRegistryEntry]>;
  }
>();

/** 解析 Agent tools 配置：native: / skill: / mcp: / skill:* */
export function parseAgentTools(agentTools: string[]): ParsedAgentTools {
  if (agentTools.length === 0) {
    return { native: "all", skills: [], skillWildcard: true, mcpServers: [] };
  }

  const native = agentTools.filter((t) => t.startsWith("native:")).map((t) => t.slice("native:".length));
  const skillRefs = agentTools.filter((t) => t.startsWith("skill:")).map((t) => t.slice("skill:".length));
  const skillWildcard = skillRefs.includes("*");
  const skills = skillRefs.filter((s) => s !== "*");
  const mcpServers = agentTools.filter((t) => t.startsWith("mcp:")).map((t) => t.slice("mcp:".length));

  let nativeResult: string[] | "all";
  if (native.length > 0) {
    nativeResult = native;
  } else if (skills.length === 0 && !skillWildcard && mcpServers.length === 0) {
    nativeResult = DEFAULT_NATIVE;
  } else {
    nativeResult = DEFAULT_NATIVE;
  }

  return { native: nativeResult, skills, skillWildcard, mcpServers };
}

async function resolveSkillNames(services: ServiceContainer, parsed: ParsedAgentTools): Promise<string[]> {
  if (parsed.skillWildcard) {
    const list = await services.skill.list({ page: 1, pageSize: 200, enabled: true });
    return list.items
      .filter((s) => {
        if (!s.metaJson) return true;
        try {
          const meta = JSON.parse(s.metaJson) as { kind?: string };
          return meta.kind !== "reference";
        } catch {
          return true;
        }
      })
      .map((s) => s.name);
  }
  return parsed.skills;
}

export function isConcurrencySafeTool(name: string, registry: Map<string, ToolRegistryEntry>): boolean {
  const entry = registry.get(name);
  if (entry?.concurrencySafe !== undefined) return entry.concurrencySafe;

  if (entry?.kind === "native" && entry.nativeName && READ_ONLY_NATIVE.has(entry.nativeName)) {
    return true;
  }
  if (entry?.kind === "skill") return true;

  if (entry?.kind === "mcp" || name.startsWith("mcp__")) {
    const meta = parseMcpToolName(name);
    if (meta && /^(get|list|read|search|fetch|describe|query)/i.test(meta.toolName)) return true;
  }

  return false;
}

export async function buildAgentToolSchemas(
  services: ServiceContainer,
  parsed: ParsedAgentTools,
  registry: Map<string, ToolRegistryEntry>,
): Promise<Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>> {
  const skillNames = await resolveSkillNames(services, parsed);
  const cacheKey = JSON.stringify({ ...parsed, skillNames });
  const cached = agentSchemaCache.get(cacheKey);
  if (cached) {
    registry.clear();
    for (const [key, entry] of cached.registryEntries) {
      registry.set(key, entry);
    }
    return cached.schemas;
  }

  registry.clear();

  const schemas = buildNativeToolSchemas(parsed.native);
  for (const schema of schemas) {
    const nativeName = schema.function.name;
    registry.set(schema.function.name, {
      kind: "native",
      nativeName,
      concurrencySafe: READ_ONLY_NATIVE.has(nativeName),
    });
  }

  // A2：批量加载所有 Skill（一次 list 查询），消除 N 次 findSkillByName 的 N+1。
  const skillMap = await findSkillsByNames(services, skillNames);
  for (const skillName of skillNames) {
    const skill = skillMap.get(skillName);
    if (!skill) {
      console.warn(`[AgentTools] Skill ${skillName} 跳过: 不存在或未启用`);
      continue;
    }
    const schema = buildSkillToolSchema(skill);
    registry.set(schema.function.name, { kind: "skill", skillName: skill.name, concurrencySafe: true });
    schemas.push(schema);
  }

  if (parsed.mcpServers.length > 0) {
    const mcpSchemas = await buildMcpToolSchemas(services, parsed.mcpServers);
    for (const schema of mcpSchemas) {
      const name = schema.function.name;
      const meta = parseMcpToolName(name);
      const concurrencySafe = meta ? /^(get|list|read|search|fetch|describe|query)/i.test(meta.toolName) : false;
      registry.set(name, { kind: "mcp", mcpExternalName: name, concurrencySafe });
      schemas.push(schema);
    }
  }

  agentSchemaCache.set(cacheKey, { schemas, registryEntries: [...registry.entries()] });
  return schemas;
}

export function isToolAuthorized(
  toolName: string,
  registry: Map<string, ToolRegistryEntry>,
  parsed: ParsedAgentTools,
): boolean {
  if (registry.get(toolName)) return true;
  const skillRef = parseSkillToolName(toolName);
  if (skillRef && (parsed.skillWildcard || parsed.skills.includes(skillRef))) return true;
  if (parseMcpToolName(toolName)) return parsed.mcpServers.length > 0;
  if (parsed.native === "all") return true;
  return parsed.native.includes(toolName);
}

export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext,
  registry: Map<string, ToolRegistryEntry>,
): Promise<unknown> {
  const entry = registry.get(toolName);

  if (entry?.kind === "skill" && entry.skillName) {
    return executeSkill(ctx.services, entry.skillName, args);
  }

  if (entry?.kind === "mcp" || parseMcpToolName(toolName)) {
    return executeMcpTool(ctx.services, toolName, args);
  }

  const skillRef = parseSkillToolName(toolName);
  if (skillRef && (ctx.allowedSkills.includes(skillRef) || ctx.allowedSkills.length === 0)) {
    return executeSkill(ctx.services, skillRef, args);
  }

  const nativeName = entry?.nativeName || toolName;
  if (ctx.allowedNative !== "all" && !ctx.allowedNative.includes(nativeName)) {
    throw new Error(`Agent 未授权使用原生工具 ${nativeName}`);
  }
  return executeNativeTool(nativeName, args, ctx);
}

/** 批量执行工具调用：只读并发（带超时与并发上限），写入串行 */
export async function executeToolCallsBatch(
  toolCalls: LlmToolCall[],
  ctx: AgentToolContext,
  registry: Map<string, ToolRegistryEntry>,
  parsed: ParsedAgentTools,
  signal?: AbortSignal,
): Promise<Array<{ call: LlmToolCall; parsed: { name: string; args: Record<string, unknown> }; result: unknown }>> {
  const prepared = toolCalls.map((call) => ({ call, parsed: parseToolCallArgs(call) }));

  // 按 concurrencyClass 分桶（A/B/C/D），每桶独立并发上限，桶间并行
  const buckets: Record<"A" | "B" | "C" | "D", typeof prepared> = { A: [], B: [], C: [], D: [] };
  const unauthorized: typeof prepared = [];

  for (const item of prepared) {
    if (!isToolAuthorized(item.parsed.name, registry, parsed)) {
      unauthorized.push(item);
      continue;
    }
    buckets[getToolConcurrencyClass(item.parsed.name, registry)].push(item);
  }

  const defaultTimeoutMs = ctx.config.llm.toolCallTimeoutMs;

  // 单工具执行包裹超时 + abort：超时或被中断时返回错误结果，绝不永久挂起
  // 长等待工具（await_async / async_task_wait）豁免默认超时，使用 10 分钟上限
  const runOne = async (item: { call: LlmToolCall; parsed: { name: string; args: Record<string, unknown> } }) => {
    const started = Date.now();
    const isLongWait = LONG_WAIT_TOOLS.has(item.parsed.name);
    const timeoutMs = isLongWait ? LONG_WAIT_TIMEOUT_MS : defaultTimeoutMs;
    try {
      const result = await withToolTimeout(
        executeAgentTool(item.parsed.name, item.parsed.args, ctx, registry),
        timeoutMs,
        item.parsed.name,
        signal,
      );
      return { ...item, result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("执行超时");
      // 慢工具自动转异步建议：超时后提示 LLM 用 run_async / spawn_subagent 重试，
      // 而非直接报错让用户手动处理
      const suggestion = isTimeout && !isLongWait
        ? `（该工具超过 ${timeoutMs / 1000}s 超时。建议改用 run_async 异步执行，或 spawn_subagent 派生子代理处理长任务，避免阻塞主对话。）`
        : "";
      return {
        ...item,
        result: {
          error: msg + suggestion,
          elapsedMs: Date.now() - started,
          timedOut: isTimeout,
        },
      };
    }
  };

  const results: Array<{ call: LlmToolCall; parsed: { name: string; args: Record<string, unknown> }; result: unknown }> = [];

  // 各桶独立并发执行，桶间并行（A 类快工具不被 C 类慢进程阻塞）
  const bucketTasks: Array<Promise<Array<{ call: LlmToolCall; parsed: { name: string; args: Record<string, unknown> }; result: unknown }>>> = [];
  for (const cls of ["A", "B", "C", "D"] as const) {
    const items = buckets[cls];
    if (items.length === 0) continue;
    const limit = CLASS_CONCURRENCY[cls];
    bucketTasks.push(runWithConcurrency(items.map((item) => () => runOne(item)), limit));
  }
  if (bucketTasks.length > 0) {
    const bucketResults = await Promise.all(bucketTasks);
    for (const r of bucketResults) results.push(...r);
  }

  // 未授权工具串行返回错误结果
  for (const item of unauthorized) {
    results.push(await runOne(item));
  }

  return results;
}

/** 工具调用超时包装：超时或 abort 时拒绝，调用方捕获后转为错误结果 */
function withToolTimeout<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`工具 ${label} 执行超时（${ms}ms）`)), ms);
  });
  const abortPromise = signal
    ? new Promise<T>((_, reject) => {
        if (signal.aborted) reject(new Error("流式输出已被用户中断"));
        else signal.addEventListener("abort", () => reject(new Error("流式输出已被用户中断")), { once: true });
      })
    : null;
  const racers = abortPromise ? [promise, timeout, abortPromise] : [promise, timeout];
  return Promise.race(racers).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 简单并发限制器：最多 limit 个 Promise 同时运行 */
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

export function createAgentToolContext(
  config: AppConfig,
  services: ServiceContainer,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
  parsed: ParsedAgentTools,
  skillNames?: string[],
  meta?: { sessionId?: string; agentSnapshot?: NativeToolContext["agentSnapshot"]; runOrigin?: NativeToolContext["runOrigin"] },
): AgentToolContext {
  return {
    config,
    services,
    prisma: services.prisma,
    invokeTrpc,
    sessionId: meta?.sessionId,
    agentSnapshot: meta?.agentSnapshot,
    runOrigin: meta?.runOrigin,
    allowedNative: parsed.native,
    allowedSkills: skillNames ?? parsed.skills,
    allowedMcpServers: parsed.mcpServers,
  };
}

export function formatAgentToolRef(kind: "native" | "skill" | "mcp", name: string): string {
  return `${kind}:${name}`;
}

export { skillToolName, DEFAULT_NATIVE };

export interface AgentToolSummary {
  authLines: number;
  nativeBuiltinTotal: number;
  nativeGranted: number;
  skillTools: number;
  mcpTools: number;
  apiProcedures: number;
  llmFunctions: number;
  /** 配置原文（每行授权） */
  configuredLines: string[];
  /** 实际生效的内置工具名 */
  resolvedNative: string[];
  /** 实际生效的 Skill 名 */
  resolvedSkills: string[];
  /** 实际生效的 MCP 服务名 */
  resolvedMcpServers: string[];
  /** 是否使用了未写明的默认内置工具包 */
  usesDefaultNative: boolean;
}

export async function countAiReadableProcedures(): Promise<number> {
  const { appRouter } = await import("../router.js");
  let count = 0;
  for (const [path, proc] of Object.entries(appRouter._def.procedures)) {
    if (path.startsWith("ai.")) continue;
    const meta = (proc as { _def?: { meta?: { aiReadable?: boolean } } })._def?.meta ?? {};
    if (meta.aiReadable === false) continue;
    count++;
  }
  return count;
}

/** 解析 Agent tools 授权并统计 LLM 可见工具规模 */
export async function summarizeAgentTools(
  services: ServiceContainer,
  tools: string[],
): Promise<AgentToolSummary> {
  const parsed = parseAgentTools(tools);
  const skillNames = await resolveSkillNames(services, parsed);
  const allNative = listNativeTools();
  const grantedNative = parsed.native === "all" ? allNative.map((t) => t.name) : parsed.native;
  const hasInvokeApi = grantedNative.includes("invoke_api");
  const apiProcedures = hasInvokeApi ? await countAiReadableProcedures() : 0;

  let mcpTools = 0;
  if (parsed.mcpServers.length > 0) {
    try {
      mcpTools = (await buildMcpToolSchemas(services, parsed.mcpServers)).length;
    } catch {
      mcpTools = 0;
    }
  }

  const nativeLlm =
    grantedNative.filter((n) => n !== "invoke_api").length + (hasInvokeApi ? 1 : 0);

  const explicitNative = tools.filter((t) => t.startsWith("native:")).map((t) => t.slice("native:".length));
  const usesDefaultNative =
    explicitNative.length === 0 &&
    tools.length > 0 &&
    (parsed.skillWildcard || parsed.skills.length > 0 || parsed.mcpServers.length > 0);

  return {
    authLines: tools.length,
    nativeBuiltinTotal: allNative.length,
    nativeGranted: parsed.native === "all" ? allNative.length : grantedNative.length,
    skillTools: skillNames.length,
    mcpTools,
    apiProcedures,
    llmFunctions: nativeLlm + skillNames.length + mcpTools,
    configuredLines: tools,
    resolvedNative: grantedNative,
    resolvedSkills: skillNames,
    resolvedMcpServers: parsed.mcpServers,
    usesDefaultNative,
  };
}
