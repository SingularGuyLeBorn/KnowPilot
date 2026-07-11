import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_NATIVE,
  materializeAgentTools,
  parseAgentToolSelection,
  serializeAgentTools,
} from "../agentTools.js";

describe("materializeAgentTools", () => {
  it("空配置物化为默认 native + skill:*", () => {
    expect(materializeAgentTools([])).toEqual([
      "native:web_search",
      "native:read_file",
      "native:list_directory",
      "native:invoke_api",
      "native:session_clear",
      "skill:*",
    ]);
  });

  it("仅有 skill:* 时补全默认 native", () => {
    expect(materializeAgentTools(["skill:*"])).toEqual([
      "native:web_search",
      "native:read_file",
      "native:list_directory",
      "native:invoke_api",
      "native:session_clear",
      "skill:*",
    ]);
  });

  it("已有 native 时不重复注入", () => {
    const input = ["native:read_file", "native:write_file", "skill:calc"];
    expect(materializeAgentTools(input)).toEqual([
      "native:read_file",
      "native:write_file",
      "skill:calc",
    ]);
  });

  it("仅有 skill/mcp 时补全默认 native", () => {
    expect(materializeAgentTools(["skill:refactor", "mcp:filesystem"])).toEqual([
      "native:web_search",
      "native:read_file",
      "native:list_directory",
      "native:invoke_api",
      "native:session_clear",
      "skill:refactor",
      "mcp:filesystem",
    ]);
  });

  it("serialize 保持稳定排序", () => {
    const sel = parseAgentToolSelection([
      "mcp:zebra",
      "native:write_file",
      "native:web_search",
      "skill:beta",
      "skill:alpha",
    ]);
    expect(serializeAgentTools(sel)).toEqual([
      "native:web_search",
      "native:write_file",
      "skill:alpha",
      "skill:beta",
      "mcp:zebra",
    ]);
  });

  it("DEFAULT_AGENT_NATIVE 包含五项基础能力", () => {
    expect(DEFAULT_AGENT_NATIVE).toContain("read_file");
    expect(DEFAULT_AGENT_NATIVE).toContain("invoke_api");
    expect(DEFAULT_AGENT_NATIVE).toContain("session_clear");
    expect(DEFAULT_AGENT_NATIVE).toHaveLength(5);
  });

  it("裸工具名视为 native，避免物化成空数组", () => {
    expect(materializeAgentTools(["sleep", "agent_report_back", "web_search"])).toEqual([
      "native:web_search",
      "native:agent_report_back",
      "native:sleep",
    ]);
  });
});
