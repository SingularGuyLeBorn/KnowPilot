/**
 * W4 防线：import 顺序冒烟测试
 *
 * 背景：历史循环依赖环 agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime，
 * nativeTools 值导入 agentRuntime 的 prompt 构建函数，靠 10+ 处 await import() 动态导入躲环。
 * W4 把 prompt 构建抽进 promptBuilder.ts、Agent 解析抽进 agentResolver.ts（均为叶子模块）打断环。
 *
 * 本测试以不同入口文件作为「首个加载模块」（vi.resetModules 后动态 import），
 * 验证任意加载顺序下模块求值都不炸、关键导出不是 undefined
 * （循环依赖的典型症状就是先求值的模块拿到 undefined 的导出）。
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const entries: Array<{ name: string; specifier: string; key: string }> = [
  { name: "nativeTools", specifier: "../infra/nativeTools.js", key: "executeNativeTool" },
  { name: "agentTools", specifier: "../infra/agentTools.js", key: "executeAgentTool" },
  { name: "reactLoop", specifier: "../infra/loop/reactLoop.js", key: "runReactLoop" },
  { name: "agentRuntime", specifier: "../infra/agentRuntime.js", key: "runAgentLoop" },
  { name: "promptBuilder", specifier: "../infra/promptBuilder.js", key: "buildSystemPromptWithHints" },
  { name: "agentResolver", specifier: "../infra/agentResolver.js", key: "resolveAgent" },
];

describe("W4 import 顺序冒烟（循环依赖防线）", () => {
  for (const entry of entries) {
    it(`以 ${entry.name} 为首个入口加载，模块求值不炸且 ${entry.key} 已定义`, async () => {
      vi.resetModules();
      const mod = (await import(entry.specifier)) as Record<string, unknown>;
      expect(
        typeof mod[entry.key],
        `${entry.name}.${entry.key} 为 ${typeof mod[entry.key]}——循环依赖导致模块求值顺序问题`,
      ).toBe("function");
    });
  }

  it("agentRuntime 兼容 re-export 仍然可用（promptBuilder / agentResolver）", async () => {
    vi.resetModules();
    const ar = (await import("../infra/agentRuntime.js")) as Record<string, unknown>;
    for (const key of [
      "buildMemoryContext",
      "buildAgentToolGuide",
      "buildTierIdentityHint",
      "buildSystemPromptWithHints",
      "resolveAgent",
    ]) {
      expect(typeof ar[key], `agentRuntime 兼容 re-export ${key} 丢失`).toBe("function");
    }
  });

  it("源码防线：nativeTools 不得再值导入 agentRuntime（环内模块）", () => {
    const src = readFileSync(path.resolve(__dirname, "../infra/nativeTools.ts"), "utf-8");
    expect(src).not.toMatch(/from\s+["']\.\/agentRuntime\.js["']/);
  });

  it("源码防线：promptBuilder / agentResolver 必须是叶子模块（不 import 环内模块）", () => {
    for (const leaf of ["promptBuilder", "agentResolver"]) {
      const src = readFileSync(path.resolve(__dirname, `../infra/${leaf}.ts`), "utf-8");
      for (const banned of ["agentRuntime", "nativeTools", "agentTools", "loop/index", "loop/reactLoop", "agentStream"]) {
        expect(
          src.includes(`./${banned}.js`) || src.includes(`../${banned}.js`),
          `${leaf}.ts 不得 import 环内模块 ${banned}`,
        ).toBe(false);
      }
    }
  });
});
