/**
 * Mock MCP Tool Registry —— 用于 E2E / 单元测试，避免启动真实 MCP Server。
 *
 * 通过环境变量启用：
 *   MOCK_MCP=true
 *
 * 当前提供 filesystem / fetch 两个 mock server，可在 agent.tools 中按真实名称配置。
 */

import type { ServiceContainer } from "./serviceContainer.js";
import { mcpToolName, truncateMcpResult } from "./mcpClient.js";

export interface MockMcpTool {
  serverName: string;
  toolName: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>, services: ServiceContainer) => unknown;
}

export const MOCK_MCP_SERVERS = ["filesystem", "fetch"];

export const MOCK_MCP_TOOLS: MockMcpTool[] = [
  {
    serverName: "filesystem",
    toolName: "read_file",
    description: "读取本地文件内容（Mock）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
      },
      required: ["path"],
    },
    handler: (args) => ({
      content: `// Mock file content for ${args.path}\nconsole.log("hello mock");`,
      chars: 64,
    }),
  },
  {
    serverName: "filesystem",
    toolName: "list_directory",
    description: "列出目录内容（Mock）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径" },
      },
      required: ["path"],
    },
    handler: (args) => ({
      entries: ["README.md", "src", "package.json"].map((name) => ({ name, type: name.endsWith(".md") ? "file" : "directory" })),
      path: args.path,
    }),
  },
  {
    serverName: "fetch",
    toolName: "get",
    description: "HTTP GET 请求（Mock）",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "目标 URL" },
      },
      required: ["url"],
    },
    handler: (args) => ({
      status: 200,
      url: args.url,
      text: `<html><body>Mock page for ${args.url}</body></html>`,
      chars: 64,
    }),
  },
  {
    serverName: "fetch",
    toolName: "post",
    description: "HTTP POST 请求（Mock）",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "目标 URL" },
        body: { type: "string", description: "请求体" },
      },
      required: ["url"],
    },
    handler: (args) => ({
      status: 200,
      url: args.url,
      text: `Mock POST response`,
    }),
  },
];

export function getMockMcpToolSchemas(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return MOCK_MCP_TOOLS.map((tool) => ({
    type: "function",
    function: {
      name: mcpToolName(tool.serverName, tool.toolName),
      description: `[MCP:${tool.serverName}] ${tool.description}`,
      parameters: tool.parameters,
    },
  }));
}

export function findMockMcpTool(externalName: string): MockMcpTool | undefined {
  return MOCK_MCP_TOOLS.find((t) => mcpToolName(t.serverName, t.toolName) === externalName);
}

export async function executeMockMcpTool(
  externalName: string,
  args: Record<string, unknown>,
  services: ServiceContainer,
): Promise<unknown> {
  const tool = findMockMcpTool(externalName);
  if (!tool) throw new Error(`Mock MCP 工具 ${externalName} 未注册`);
  const result = await Promise.resolve(tool.handler(args, services));
  return truncateMcpResult(result);
}
