import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import {
  buildSmokeArgs,
  getProcedureValidator,
  isSmokeOutcomeOk,
  listAiTools,
  smokeInvokeTool,
  type AiToolDescriptor,
  type SmokeInvokeResult,
} from "./helpers/trpcSmokeHarness.js";

describe("tRPC AI 工具 smoke（~100+ procedures）", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let allTools: AiToolDescriptor[] = [];
  let trpcTools: AiToolDescriptor[] = [];
  let nativeTools: AiToolDescriptor[] = [];
  let smokeTargets: AiToolDescriptor[] = [];

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    const ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);

    allTools = await caller.ai.tools();
    trpcTools = allTools.filter((t) => !t.name.startsWith("native."));
    nativeTools = allTools.filter((t) => t.name.startsWith("native."));
    smokeTargets = listAiTools(allTools);
  });

  it("ai.tools 应暴露至少 90 个 tRPC procedure", () => {
    expect(trpcTools.length).toBeGreaterThanOrEqual(90);
  });

  it("ai.tools 应包含 native.* 内置工具", () => {
    expect(nativeTools.length).toBeGreaterThanOrEqual(10);
    expect(nativeTools.some((t) => t.name === "native.web_search")).toBe(true);
  });

  it("所有 ai-readable 工具均可通过 ai.invoke 触达（无未捕获崩溃）", async () => {
    const procedures = appRouter._def.procedures;
    const results: SmokeInvokeResult[] = [];

    for (const tool of smokeTargets) {
      const path = tool.name;
      const validator = path.startsWith("native.")
        ? undefined
        : getProcedureValidator(procedures, path);
      const args = buildSmokeArgs(path, validator);
      const result = await smokeInvokeTool(caller, path, args);
      results.push(result);
    }

    const crashes = results.filter((r) => !isSmokeOutcomeOk(r));
    if (crashes.length > 0) {
      const summary = crashes.map((c) => `${c.tool}: ${c.message}`).join("\n");
      expect(crashes, `以下工具 smoke 崩溃:\n${summary}`).toEqual([]);
    }

    expect(results.length).toBeGreaterThanOrEqual(100);

    const byKind = results.reduce(
      (acc, r) => {
        acc[r.kind] = (acc[r.kind] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(byKind.crash ?? 0).toBe(0);
    expect((byKind.success ?? 0) + (byKind.failure ?? 0) + (byKind.trpc_error ?? 0)).toBe(results.length);
  }, 120_000);

  it("只读类 procedure 直接 caller 调用应返回数据", async () => {
    const readOnlyPaths = [
      "post.list",
      "post.tree",
      "post.categories",
      "post.tags",
      "agent.list",
      "agent.llmProviders",
      "agent.llmBudgetStatus",
      "skill.list",
      "mcp.list",
      "memory.list",
      "infoSource.list",
      "session.list",
      "file.list",
      "log.list",
      "git.list",
      "task.list",
      "workspace.list",
      "trigger.list",
      "approval.list",
      "tool.list",
      "run.list",
      "prompt.list",
      "credential.list",
      "native.list",
      "native.capabilities",
      "analytics.dashboard",
      "about.getProfile",
      "search.global",
    ] as const;

    for (const path of readOnlyPaths) {
      const parts = path.split(".");
      let method: unknown = caller;
      for (const part of parts) {
        method = (method as Record<string, unknown>)[part];
      }
      expect(typeof method).toBe("function");

      const validator = getProcedureValidator(appRouter._def.procedures, path);
      const args = buildSmokeArgs(path, validator);
      const result = await (method as (input?: unknown) => Promise<unknown>)(args);
      expect(result).toBeDefined();
    }
  }, 60_000);
});
