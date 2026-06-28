/**
 * MCP Client — 单元测试
 */

import { describe, it, expect } from "vitest";
import { mcpToolName, parseMcpToolName, truncateMcpResult, MCP_MAX_RESULT_CHARS } from "../infra/mcpClient.js";

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
