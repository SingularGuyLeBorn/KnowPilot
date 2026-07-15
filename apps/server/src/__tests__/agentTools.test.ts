import { describe, it, expect, vi } from "vitest";
import {
  parseAgentTools,
  buildAgentToolSchemas,
  isToolAuthorized,
  isConcurrencySafeTool,
  executeAgentTool,
  executeToolCallsBatch,
  createAgentToolContext,
  formatAgentToolRef,
  resolveToolCallTimeoutMs,
  DEFAULT_NATIVE,
} from "../infra/agentTools.js";
import { skillToolName, parseSkillToolName, buildSkillToolSchema, executeSkill } from "../infra/skillRunner.js";
import { mcpToolName } from "../infra/mcpClient.js";
import { createTempProjectDir, createAgentCtx, makeSkillEntity } from "./helpers/toolTestFixtures.js";
import type { ToolRegistryEntry } from "../infra/agentTools.js";
import fs from "fs";

describe("Agent 工具桥 — parseAgentTools", () => {
  it("空 tools 返回 all native + skillWildcard", () => {
    const parsed = parseAgentTools([]);
    expect(parsed.native).toBe("all");
    expect(parsed.skills).toEqual([]);
    expect(parsed.skillWildcard).toBe(true);
    expect(parsed.mcpServers).toEqual([]);
  });

  it("解析 native / skill / mcp 前缀", () => {
    const parsed = parseAgentTools([
      "native:web_search",
      "native:read_file",
      "skill:frontend-design",
      "mcp:filesystem",
    ]);
    expect(parsed.native).toEqual(["web_search", "read_file"]);
    expect(parsed.skills).toEqual(["frontend-design"]);
    expect(parsed.skillWildcard).toBe(false);
    expect(parsed.mcpServers).toEqual(["filesystem"]);
  });

  it("skill:* 开启通配", () => {
    const parsed = parseAgentTools(["skill:*", "native:read_file"]);
    expect(parsed.skillWildcard).toBe(true);
    expect(parsed.skills).toEqual([]);
  });

  it("仅有 skill/mcp 时仍附带默认 native", () => {
    const parsed = parseAgentTools(["skill:refactor", "mcp:filesystem"]);
    expect(Array.isArray(parsed.native)).toBe(true);
    expect((parsed.native as string[]).length).toBeGreaterThan(0);
    expect(parsed.skills).toEqual(["refactor"]);
    expect(parsed.mcpServers).toEqual(["filesystem"]);
  });

  it("formatAgentToolRef 格式化引用", () => {
    expect(formatAgentToolRef("native", "read_file")).toBe("native:read_file");
    expect(formatAgentToolRef("skill", "ui-ux")).toBe("skill:ui-ux");
  });

  it("DEFAULT_NATIVE 包含基础工具", () => {
    expect(DEFAULT_NATIVE).toContain("read_file");
    expect(DEFAULT_NATIVE).toContain("invoke_api");
  });
});

describe("Agent 工具桥 — 命名 round-trip", () => {
  it("skill 工具名 round-trip", () => {
    const external = skillToolName("frontend-design");
    expect(external).toBe("skill__frontend-design");
    expect(parseSkillToolName(external)).toBe("frontend-design");
  });

  it("mcp 工具名格式", () => {
    expect(mcpToolName("filesystem", "read_file")).toBe("mcp__filesystem__read_file");
  });

  it("buildSkillToolSchema 结构正确", () => {
    const schema = buildSkillToolSchema(makeSkillEntity({ name: "calc", description: "计算器" }));
    expect(schema.function.name).toBe("skill__calc");
    expect(schema.function.parameters.required).toContain("input");
  });
});

describe("Agent 工具桥 — isToolAuthorized", () => {
  const registry = new Map<string, ToolRegistryEntry>([
    ["read_file", { kind: "native", nativeName: "read_file", concurrencySafe: true }],
    ["skill__calc", { kind: "skill", skillName: "calc", concurrencySafe: true }],
  ]);

  it("registry 内工具已授权", () => {
    expect(isToolAuthorized("read_file", registry, parseAgentTools(["native:read_file"]))).toBe(true);
  });

  it("skillWildcard 授权 skill__ 工具", () => {
    expect(isToolAuthorized("skill__calc", registry, parseAgentTools(["skill:*"]))).toBe(true);
  });

  it("未授权 native 拒绝", () => {
    expect(isToolAuthorized("write_file", registry, parseAgentTools(["native:read_file"]))).toBe(false);
  });
});

describe("Agent 工具桥 — isConcurrencySafeTool", () => {
  it("只读 native 可并发", () => {
    const registry = new Map<string, ToolRegistryEntry>([
      ["read_file", { kind: "native", nativeName: "read_file" }],
      ["write_file", { kind: "native", nativeName: "write_file" }],
    ]);
    expect(isConcurrencySafeTool("read_file", registry)).toBe(true);
    expect(isConcurrencySafeTool("write_file", registry)).toBe(false);
  });

  it("MCP read 类工具可并发", () => {
    const name = mcpToolName("fs", "list_dir");
    const registry = new Map<string, ToolRegistryEntry>([
      [name, { kind: "mcp", mcpExternalName: name, concurrencySafe: true }],
    ]);
    expect(isConcurrencySafeTool(name, registry)).toBe(true);
  });
});

describe("Agent 工具桥 — buildAgentToolSchemas", () => {
  it("skill:* 注册全部非 reference Skill", async () => {
    const services = {
      skill: {
        list: vi.fn(async () => ({
          items: [
            makeSkillEntity({ name: "calc", metaJson: null }),
            makeSkillEntity({ name: "ref", metaJson: JSON.stringify({ kind: "reference" }) }),
          ],
          total: 2,
          page: 1,
          pageSize: 200,
          totalPages: 1,
        })),
      },
    };
    const registry = new Map<string, ToolRegistryEntry>();
    const schemas = await buildAgentToolSchemas(
      services as never,
      parseAgentTools(["skill:*", "native:read_file"]),
      registry,
    );
    const names = schemas.map((s) => s.function.name);
    expect(names).toContain("read_file");
    expect(names).toContain("skill__calc");
    expect(names).not.toContain("skill__ref");
  });
});

describe("Agent 工具桥 — executeAgentTool", () => {
  it("executeAgentTool 调用 native read_file", async () => {
    const root = createTempProjectDir();
    fs.writeFileSync(`${root}/test.txt`, "content", "utf8");
    const parsed = parseAgentTools(["native:read_file"]);
    const registry = new Map<string, ToolRegistryEntry>([
      ["read_file", { kind: "native", nativeName: "read_file" }],
    ]);
    const ctx = createAgentCtx(root, parsed);
    const result = (await executeAgentTool("read_file", { path: "test.txt" }, ctx, registry)) as {
      content: string;
    };
    expect(result.content).toBe("content");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("executeAgentTool 未授权 native 抛错", async () => {
    const root = createTempProjectDir();
    const parsed = parseAgentTools(["native:read_file"]);
    const registry = new Map<string, ToolRegistryEntry>();
    const ctx = createAgentCtx(root, parsed);
    await expect(executeAgentTool("write_file", { path: "x", content: "y" }, ctx, registry)).rejects.toThrow(
      /未授权/,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("executeAgentTool 经 registry 执行 Skill", async () => {
    const root = createTempProjectDir();
    const services = {
      skill: {
        list: vi.fn(async () => ({
          items: [makeSkillEntity({ name: "calc", code: "function run(i){ return i.length; }" })],
          total: 1,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        })),
      },
    };
    const parsed = parseAgentTools(["skill:calc"]);
    const registry = new Map<string, ToolRegistryEntry>([
      ["skill__calc", { kind: "skill", skillName: "calc" }],
    ]);
    const ctx = createAgentCtx(root, parsed, { services: services as never });
    const result = (await executeAgentTool("skill__calc", { input: "hello" }, ctx, registry)) as {
      mode: string;
      result: number;
    };
    expect(result.mode).toBe("sandbox");
    expect(result.result).toBe(5);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("Agent 工具桥 — executeToolCallsBatch", () => {
  it("只读工具并发执行", async () => {
    const root = createTempProjectDir();
    fs.writeFileSync(`${root}/a.txt`, "a", "utf8");
    fs.writeFileSync(`${root}/b.txt`, "b", "utf8");
    const parsed = parseAgentTools(["native:read_file"]);
    const registry = new Map<string, ToolRegistryEntry>([
      ["read_file", { kind: "native", nativeName: "read_file", concurrencySafe: true }],
    ]);
    const ctx = createAgentCtx(root, parsed);
    const order: string[] = [];
    const orig = ctx.invokeTrpc;
    ctx.invokeTrpc = async (...args) => {
      order.push("trpc");
      return orig(...args);
    };

    const results = await executeToolCallsBatch(
      [
        { id: "1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "a.txt" }) } },
        { id: "2", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "b.txt" }) } },
      ],
      ctx,
      registry,
      parsed,
    );
    expect(results).toHaveLength(2);
    expect((results[0].result as { content: string }).content).toBe("a");
    expect((results[1].result as { content: string }).content).toBe("b");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("未授权工具返回 error 对象", async () => {
    const root = createTempProjectDir();
    const parsed = parseAgentTools(["native:read_file"]);
    const registry = new Map<string, ToolRegistryEntry>();
    const ctx = createAgentCtx(root, parsed);
    const results = await executeToolCallsBatch(
      [
        { id: "1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "x", content: "y" }) } },
      ],
      ctx,
      registry,
      parsed,
    );
    expect((results[0].result as { error: string }).error).toMatch(/未授权/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("Skill executeSkill", () => {
  it("Prompt 模式 Skill 返回 instructions", async () => {
    const services = {
      skill: {
        list: vi.fn(async () => ({
          items: [makeSkillEntity({ name: "design", code: "# Design guidelines\nBe bold." })],
          total: 1,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        })),
      },
    };
    const result = (await executeSkill(services as never, "design", { input: "redesign chat panel" })) as {
      mode: string;
      instructions: string;
    };
    expect(result.mode).toBe("prompt");
    expect(result.instructions).toContain("Design guidelines");
  });
});

describe("长等待超时预算（P2/S5）", () => {
  const DEFAULT_MS = 30_000;
  const LONG_WAIT_MS = 10 * 60 * 1000;

  it("P2：async_task_run(waitForResult=true) 拿长等待档而非默认 30s", () => {
    // 负向断言（旧实现即红）：waitForResult=true 是同步等待语义（结果走 tool return），
    // 内层 waitForAsyncJob 轮询上限 10 分钟；外层 30s race 会让 >30s 任务拿超时错误而非结果。
    expect(resolveToolCallTimeoutMs("async_task_run", { waitForResult: true }, DEFAULT_MS)).toBe(LONG_WAIT_MS);
    // LLM 常把 boolean 写成字符串 "true"（与 shell.ts 的 coerceToolBoolean 同款容忍，否则误判为异步投递）
    expect(resolveToolCallTimeoutMs("async_task_run", { waitForResult: "true" }, DEFAULT_MS)).toBe(LONG_WAIT_MS);
  });

  it("P2 对照：async_task_run 默认异步投递（waitForResult 缺省/false）不豁免", () => {
    expect(resolveToolCallTimeoutMs("async_task_run", {}, DEFAULT_MS)).toBe(DEFAULT_MS);
    expect(resolveToolCallTimeoutMs("async_task_run", { waitForResult: false }, DEFAULT_MS)).toBe(DEFAULT_MS);
  });

  it("S5：agent_send_message(waitForRun=true) 拿长等待档；默认 fire-and-forget 不豁免", () => {
    // waitForRun=true 父流挂起等子会话 drain 处理完成，子的当前轮 + 排队项可远超 30s
    expect(resolveToolCallTimeoutMs("agent_send_message", { waitForRun: true }, DEFAULT_MS)).toBe(LONG_WAIT_MS);
    expect(resolveToolCallTimeoutMs("agent_send_message", { waitForRun: "true" }, DEFAULT_MS)).toBe(LONG_WAIT_MS);
    expect(resolveToolCallTimeoutMs("agent_send_message", {}, DEFAULT_MS)).toBe(DEFAULT_MS);
  });

  it("既有按名豁免不变：spawn_subagent / sleep 长等待档；普通工具默认档", () => {
    expect(resolveToolCallTimeoutMs("spawn_subagent", {}, DEFAULT_MS)).toBe(LONG_WAIT_MS);
    expect(resolveToolCallTimeoutMs("sleep", { seconds: 60 }, DEFAULT_MS)).toBe(LONG_WAIT_MS);
    expect(resolveToolCallTimeoutMs("web_search", {}, DEFAULT_MS)).toBe(DEFAULT_MS);
  });
});
