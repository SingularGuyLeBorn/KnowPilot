/**
 * Agent 工具桥 — 统一 native / skill / mcp 三类工具的解析、Schema 构建与执行
 * 含：skill:* 通配 · 只读工具并发 · 写入串行
 */

import type { LlmToolCall } from "./llmClient.js";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import {
  buildNativeToolSchemas,
  executeNativeTool,
  listNativeTools,
  type NativeToolContext,
} from "./nativeTools.js";
import {
  buildSkillToolSchema,
  executeSkill,
  findSkillByName,
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
}

type ToolKind = "native" | "skill" | "mcp";

const DEFAULT_NATIVE = ["web_search", "read_file", "list_directory", "invoke_api"];

/** 可并发执行的工具（只读 / 无副作用） */
const READ_ONLY_NATIVE = new Set(["web_search", "read_file", "list_directory"]);

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

  for (const skillName of skillNames) {
    try {
      const skill = await findSkillByName(services, skillName);
      const schema = buildSkillToolSchema(skill);
      registry.set(schema.function.name, { kind: "skill", skillName: skill.name, concurrencySafe: true });
      schemas.push(schema);
    } catch (err: unknown) {
      console.warn(`[AgentTools] Skill ${skillName} 跳过:`, err instanceof Error ? err.message : err);
    }
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

/** 批量执行工具调用：只读并发，写入串行 */
export async function executeToolCallsBatch(
  toolCalls: LlmToolCall[],
  ctx: AgentToolContext,
  registry: Map<string, ToolRegistryEntry>,
  parsed: ParsedAgentTools,
): Promise<Array<{ call: LlmToolCall; parsed: { name: string; args: Record<string, unknown> }; result: unknown }>> {
  const prepared = toolCalls.map((call) => ({ call, parsed: parseToolCallArgs(call) }));

  const safe: typeof prepared = [];
  const unsafe: typeof prepared = [];

  for (const item of prepared) {
    if (!isToolAuthorized(item.parsed.name, registry, parsed)) {
      unsafe.push(item);
      continue;
    }
    if (isConcurrencySafeTool(item.parsed.name, registry)) safe.push(item);
    else unsafe.push(item);
  }

  const results: Array<{ call: LlmToolCall; parsed: { name: string; args: Record<string, unknown> }; result: unknown }> = [];

  if (safe.length > 0) {
    const safeResults = await Promise.all(
      safe.map(async (item) => {
        try {
          const result = await executeAgentTool(item.parsed.name, item.parsed.args, ctx, registry);
          return { ...item, result };
        } catch (err: unknown) {
          return { ...item, result: { error: err instanceof Error ? err.message : String(err) } };
        }
      }),
    );
    results.push(...safeResults);
  }

  for (const item of unsafe) {
    try {
      if (!isToolAuthorized(item.parsed.name, registry, parsed)) {
        throw new Error(`Agent 未授权使用工具 ${item.parsed.name}`);
      }
      const result = await executeAgentTool(item.parsed.name, item.parsed.args, ctx, registry);
      results.push({ ...item, result });
    } catch (err: unknown) {
      results.push({ ...item, result: { error: err instanceof Error ? err.message : String(err) } });
    }
  }

  return results;
}

export function createAgentToolContext(
  config: AppConfig,
  services: ServiceContainer,
  invokeTrpc: (tool: string, args?: unknown) => Promise<unknown>,
  parsed: ParsedAgentTools,
  skillNames?: string[],
): AgentToolContext {
  return {
    config,
    services,
    invokeTrpc,
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

  return {
    authLines: tools.length,
    nativeBuiltinTotal: allNative.length,
    nativeGranted: parsed.native === "all" ? allNative.length : grantedNative.length,
    skillTools: skillNames.length,
    mcpTools,
    apiProcedures,
    llmFunctions: nativeLlm + skillNames.length + mcpTools,
  };
}
