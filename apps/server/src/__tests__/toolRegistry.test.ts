/**
 * ToolCommand 注册表 — PR-3 骨架验收
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  registerTool,
  getTool,
  listTools,
  listToolNames,
  hasTool,
  __resetToolRegistryForTests,
} from "../infra/tools/index.js";
import { listNativeTools, executeNativeTool, buildNativeToolSchemas } from "../infra/nativeTools.js";
import { createNativeCtx, createTempProjectDir } from "./helpers/toolTestFixtures.js";
import fs from "fs";

describe("ToolCommand registry", () => {
  afterEach(() => {
    __resetToolRegistryForTests();
    // 清空后经 listNativeTools 触发 ensureNativeToolsRegistered 重新灌入
    listNativeTools();
  });

  it("registerTool + getTool 可注册假工具并执行", async () => {
    registerTool({
      name: "__test_echo",
      kind: "native",
      schema: () => ({
        description: "echo for unit test",
        parameters: { type: "object", properties: { msg: { type: "string" } } },
      }),
      execute: async (args) => ({ echoed: String(args.msg ?? "") }),
    });

    const cmd = getTool("__test_echo");
    expect(cmd).toBeDefined();
    expect(cmd!.kind).toBe("native");
    await expect(cmd!.execute({ msg: "hi" }, {})).resolves.toEqual({ echoed: "hi" });
    expect(listToolNames("native")).toContain("__test_echo");
    expect(hasTool("__test_echo")).toBe(true);
  });

  it("listTools(kind) 按 kind 过滤", () => {
    registerTool({
      name: "__test_skill_stub",
      kind: "skill",
      schema: () => ({ description: "stub", parameters: {} }),
      execute: async () => ({}),
    });
    expect(listTools("skill").some((t) => t.name === "__test_skill_stub")).toBe(true);
    expect(listTools("native").some((t) => t.name === "__test_skill_stub")).toBe(false);
  });

  it("native 工具经 registry 执行与 schema 构建仍可用", async () => {
    const names = listNativeTools().map((d) => d.name);
    expect(names).toContain("read_file");
    expect(getTool("read_file")?.kind).toBe("native");

    const schemas = buildNativeToolSchemas(["read_file"]);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.name).toBe("read_file");

    const root = createTempProjectDir();
    try {
      const file = `${root}/hello.txt`;
      fs.writeFileSync(file, "ok", "utf8");
      const ctx = createNativeCtx(root);
      const result = (await executeNativeTool("read_file", { path: "hello.txt" }, ctx)) as {
        content?: string;
      };
      expect(result.content).toContain("ok");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("清空 registry 后 ensure 可重新灌入 native", () => {
    expect(getTool("read_file")).toBeDefined();
    __resetToolRegistryForTests();
    expect(getTool("read_file")).toBeUndefined();
    listNativeTools();
    expect(getTool("read_file")?.kind).toBe("native");
  });
});
