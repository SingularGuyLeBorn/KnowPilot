/**
 * MCP Client — 连接 content/mcp 配置的 MCP Server，桥接工具到 Agent
 * 含：结果截断 · 断线重连 · 单次重试 · W12 断路器熔断
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ServiceContainer } from "./serviceContainer.js";
import type { McpServerEntity } from "../services.js";
import { executeMockMcpTool, getMockMcpToolSchemas } from "./mockMcpRegistry.js";
import { CircuitBreaker } from "./circuitBreaker.js";

interface McpToolMeta {
  serverName: string;
  toolName: string;
}

const clientCache = new Map<string, Client>();
const toolRegistry = new Map<string, McpToolMeta>();
const schemaCache = new Map<string, Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>>();

/** W12：每个 MCP server 一个断路器实例（模块级；进程重启自然重置） */
const circuitBreakers = new Map<string, CircuitBreaker>();

const MCP_CONNECT_TIMEOUT_MS = 12_000;
const MCP_MAX_RESULT_CHARS = 12_000;

function getMcpCircuitBreaker(serverName: string): CircuitBreaker {
  let breaker = circuitBreakers.get(serverName);
  if (!breaker) {
    breaker = new CircuitBreaker(); // 默认 failureThreshold=5 / openDurationMs=60s
    circuitBreakers.set(serverName, breaker);
  }
  return breaker;
}

/** 测试隔离：清空全部 MCP 断路器实例 */
export function __resetMcpCircuitBreakersForTests(): void {
  circuitBreakers.clear();
}

/** 测试/观测用：读取某 MCP server 的断路器实例（未创建过则为 undefined） */
export function __getMcpCircuitBreakerForTests(serverName: string): CircuitBreaker | undefined {
  return circuitBreakers.get(serverName);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // 修复：原实现 setTimeout 在 promise 正常完成后未清除，timer 持有 reject 闭包
  // 12 秒不被 GC。改为 .finally 清除 timer。
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 连接超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function mcpToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${safeServer}__${safeTool}`;
}

export function parseMcpToolName(externalName: string): McpToolMeta | null {
  if (!externalName.startsWith("mcp__")) return null;
  const meta = toolRegistry.get(externalName);
  if (meta) return meta;
  const parts = externalName.slice(5).split("__");
  if (parts.length < 2) return null;
  const toolName = parts.pop()!;
  const serverName = parts.join("__").replace(/_/g, "-");
  return { serverName, toolName };
}

/** 截断过大 MCP 结果，避免撑爆上下文 */
export function truncateMcpResult(result: unknown): unknown {
  const json = JSON.stringify(result);
  if (json.length <= MCP_MAX_RESULT_CHARS) return result;

  const truncated = json.slice(0, MCP_MAX_RESULT_CHARS);
  let parsed: unknown = truncated;
  try {
    parsed = JSON.parse(truncated);
  } catch {
    parsed = truncated;
  }

  return {
    _truncated: true,
    _originalChars: json.length,
    _maxChars: MCP_MAX_RESULT_CHARS,
    preview: parsed,
    hint: "MCP 结果过大已截断。请缩小查询范围或分页获取。",
  };
}

async function findMcpServer(services: ServiceContainer, name: string): Promise<McpServerEntity> {
  const list = await services.mcp.list({ page: 1, pageSize: 50, keyword: name });
  const exact = list.items.find((s) => s.name === name);
  if (exact) return exact;
  throw new Error(`MCP Server "${name}" 不存在。请在 content/mcp/ 添加配置后 db:sync。`);
}

function evictClient(serverName: string): void {
  const client = clientCache.get(serverName);
  if (client) {
    void client.close().catch(() => undefined);
  }
  clientCache.delete(serverName);
}

async function connectClient(server: McpServerEntity): Promise<Client> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...process.env, ...server.env } as Record<string, string>,
  });

  const client = new Client({ name: "knowpilot", version: "1.0.0" }, { capabilities: {} });
  await withTimeout(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `MCP ${server.name}`);
  clientCache.set(server.name, client);
  return client;
}

async function getOrConnectClient(server: McpServerEntity, forceReconnect = false): Promise<Client> {
  if (forceReconnect) evictClient(server.name);
  const cached = clientCache.get(server.name);
  if (cached) return cached;
  return connectClient(server);
}

export async function buildMcpToolSchemas(
  services: ServiceContainer,
  serverNames: string[],
): Promise<Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>> {
  if (serverNames.length === 0) return [];

  if (process.env.MOCK_MCP === "true") {
    // 按 agent 配置的 serverNames 过滤，避免 Mock 模式下授权边界比真实更宽
    const allowed = new Set(serverNames);
    const schemas = getMockMcpToolSchemas().filter((s) => {
      const meta = parseMcpToolName(s.function.name);
      return meta ? allowed.has(meta.serverName) : false;
    });
    for (const schema of schemas) {
      const meta = parseMcpToolName(schema.function.name);
      if (meta) toolRegistry.set(schema.function.name, meta);
    }
    return schemas;
  }

  const cacheKey = serverNames.slice().sort().join(",");
  const cached = schemaCache.get(cacheKey);
  if (cached) return cached;

  const schemas: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [];

  for (const serverName of serverNames) {
    const server = await findMcpServer(services, serverName);
    if (!server.enabled) continue;

    try {
      const client = await getOrConnectClient(server);
      const listed = await withTimeout(client.listTools(), MCP_CONNECT_TIMEOUT_MS, `MCP ${server.name} listTools`);
      for (const tool of listed.tools) {
        const externalName = mcpToolName(server.name, tool.name);
        toolRegistry.set(externalName, { serverName: server.name, toolName: tool.name });
        schemas.push({
          type: "function",
          function: {
            name: externalName,
            description: `[MCP:${server.name}] ${tool.description || tool.name}`,
            parameters: (tool.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
          },
        });
      }
    } catch (err: unknown) {
      console.warn(`[MCP] 连接 ${serverName} 失败，跳过 MCP 工具:`, err instanceof Error ? err.message : err);
      evictClient(serverName);
    }
  }

  schemaCache.set(cacheKey, schemas);
  return schemas;
}

async function callToolOnce(
  server: McpServerEntity,
  toolName: string,
  args: Record<string, unknown>,
  reconnect: boolean,
): Promise<unknown> {
  const client = await getOrConnectClient(server, reconnect);
  return client.callTool({ name: toolName, arguments: args });
}

export async function executeMcpTool(
  services: ServiceContainer,
  externalName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (process.env.MOCK_MCP === "true") {
    return executeMockMcpTool(externalName, args, services);
  }

  const meta = parseMcpToolName(externalName);
  if (!meta) throw new Error(`无效的 MCP 工具名: ${externalName}`);

  const server = await findMcpServer(services, meta.serverName);
  if (!server.enabled) throw new Error(`MCP Server "${meta.serverName}" 已禁用`);

  // W12 断路器：open 期间零真实连接尝试，结构化错误结果直接喂回 LLM（不抛）
  const breaker = getMcpCircuitBreaker(server.name);
  const permit = breaker.tryAcquire();
  if (!permit.allowed) {
    const retryAfterSec = Math.ceil(permit.retryAfterMs / 1000);
    console.warn(`[MCP] ${server.name} 熔断中，跳过 ${meta.toolName} 真实调用（${retryAfterSec}s 后重试）`);
    return {
      error: "MCP_CIRCUIT_OPEN",
      message: `MCP 服务「${server.name}」熔断中（连续失败已达阈值），约 ${retryAfterSec} 秒后自动半开探测恢复，请稍后重试。`,
      circuitOpen: true,
      retryAfterMs: permit.retryAfterMs,
    };
  }

  try {
    const result = await callToolOnce(server, meta.toolName, args, false);
    breaker.recordSuccess();
    return truncateMcpResult(result);
  } catch (firstErr) {
    console.warn(`[MCP] ${meta.serverName}.${meta.toolName} 失败，尝试重连…`, firstErr instanceof Error ? firstErr.message : firstErr);
    evictClient(server.name);
    try {
      const result = await callToolOnce(server, meta.toolName, args, true);
      breaker.recordSuccess();
      return truncateMcpResult(result);
    } catch (retryErr) {
      // 首试 + 重连重试整体计一次失败（避免一次调用双重计数提前开闸）
      breaker.recordFailure();
      throw new Error(
        `MCP 工具 ${meta.toolName} 调用失败（已重连）：${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
    }
  }
}

export async function disconnectAllMcpClients(): Promise<void> {
  for (const [name] of clientCache) {
    evictClient(name);
  }
  toolRegistry.clear();
  schemaCache.clear();
}

export { MCP_MAX_RESULT_CHARS };
