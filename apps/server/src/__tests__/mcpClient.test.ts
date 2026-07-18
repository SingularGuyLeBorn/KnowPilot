/**
 * MCP Client — 单元测试
 */

import { describe, it, expect } from "vitest";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  mcpToolName,
  parseMcpToolName,
  truncateMcpResult,
  MCP_MAX_RESULT_CHARS,
  createMcpTransport,
} from "../infra/mcpClient.js";
import type { McpServerEntity } from "../services.js";
import { createMcpServerSchema } from "@knowpilot/shared";

describe("MCP 工具命名", () => {
  it("mcpToolName 生成安全外部名", () => {
    expect(mcpToolName("filesystem", "read_file")).toBe("mcp__filesystem__read_file");
    expect(mcpToolName("my-server", "get/list")).toBe("mcp__my-server__get_list");
  });

  it("parseMcpToolName 解析外部名", () => {
    const meta = parseMcpToolName("mcp__filesystem__read_file");
    expect(meta).toEqual({ serverName: "filesystem", toolName: "read_file" });
  });

  it("非 MCP 名返回 null", () => {
    expect(parseMcpToolName("read_file")).toBeNull();
    expect(parseMcpToolName("skill__foo")).toBeNull();
  });
});

describe("truncateMcpResult", () => {
  it("小结果原样返回", () => {
    const data = { ok: true, items: [1, 2] };
    expect(truncateMcpResult(data)).toEqual(data);
  });

  it("超大 JSON 截断并附 hint", () => {
    const huge = { blob: "x".repeat(MCP_MAX_RESULT_CHARS + 500) };
    const result = truncateMcpResult(huge) as {
      _truncated: boolean;
      _originalChars: number;
      hint: string;
    };
    expect(result._truncated).toBe(true);
    expect(result._originalChars).toBeGreaterThan(MCP_MAX_RESULT_CHARS);
    expect(result.hint).toMatch(/截断/);
  });
});

describe("createMcpTransport", () => {
  const base = {
    id: "m1",
    name: "demo",
    args: [] as string[],
    env: {} as Record<string, string>,
    headers: {} as Record<string, string>,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("stdio 返回 StdioClientTransport", () => {
    const t = createMcpTransport({
      ...base,
      transport: "stdio",
      command: "npx",
      args: ["-y", "x"],
      url: null,
    } as McpServerEntity);
    expect(t).toBeInstanceOf(StdioClientTransport);
  });

  it("http 返回 StreamableHTTPClientTransport", () => {
    const t = createMcpTransport({
      ...base,
      transport: "http",
      command: "",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer t" },
    } as McpServerEntity);
    expect(t).toBeInstanceOf(StreamableHTTPClientTransport);
  });

  it("http 缺 url 抛错", () => {
    expect(() =>
      createMcpTransport({
        ...base,
        transport: "http",
        command: "",
        url: null,
      } as McpServerEntity),
    ).toThrow(/url/);
  });

  it("stdio 缺 command 抛错", () => {
    expect(() =>
      createMcpTransport({
        ...base,
        transport: "stdio",
        command: "",
        url: null,
      } as McpServerEntity),
    ).toThrow(/command/);
  });
});

describe("createMcpServerSchema transport", () => {
  it("stdio 缺 command 失败", () => {
    const r = createMcpServerSchema.safeParse({ name: "a", transport: "stdio", command: "" });
    expect(r.success).toBe(false);
  });

  it("http 有 url 通过", () => {
    const r = createMcpServerSchema.safeParse({
      name: "a",
      transport: "http",
      url: "https://example.com/mcp",
    });
    expect(r.success).toBe(true);
  });
});
