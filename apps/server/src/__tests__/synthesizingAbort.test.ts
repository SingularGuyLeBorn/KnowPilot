/**
 * A1：合成轮 AbortError 不得被 catch-all 吞掉后以 success + 兜底文案收口。
 *
 * 负向断言（旧实现红）：
 * - synthesizing 阶段 transport.complete 抛 AbortError → 旧：success +「已达到最大工具调用轮次」
 * - 新：cancelled，且兜底文案不作为 success 内容返回
 * - finalizeRun 对 aborted 状态拒绝 success（强制 cancelled）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { runReactLoop } from "../infra/loop/reactLoop.js";
import type { ReactLoopInput, LlmTransport } from "../infra/loop/types.js";
import type { LlmToolCall } from "../infra/llmClient.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";
import { listNativeTools } from "../infra/nativeTools.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";
import { makeAbortError } from "../infra/abortReason.js";

function tc(id: string, name: string, args: Record<string, unknown>): LlmToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function stubServices() {
  const runCreate = vi.fn(async (_input: Record<string, unknown>) => ({
    success: true,
    data: { id: "run-a1" },
  }));
  const runUpdate = vi.fn(async (_input: Record<string, unknown>) => ({
    success: true,
    data: { id: "run-a1" },
  }));
  const services = { run: { create: runCreate, update: runUpdate } } as unknown as ServiceContainer;
  return { services, runUpdate };
}

function isFallbackSuccess(status?: string, content?: string): boolean {
  if (status !== "success" || typeof content !== "string") return false;
  return content.includes("已达到最大工具调用轮次") || content.includes("工具调用上限");
}

describe("A1 synthesizing AbortError 终态不变量", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    listNativeTools();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("synthesizing 阶段 abort → cancelled，兜底文案不落库为 success", async () => {
    const { services, runUpdate } = stubServices();
    const ac = new AbortController();
    let synthesisCalls = 0;

    const transport: LlmTransport = {
      async complete({ withTools }) {
        if (withTools) {
          return {
            content: "",
            toolCalls: [tc("c1", "write_file", { path: "a.txt", content: "1" })],
            model: "test-model",
            provider: "test",
          };
        }
        synthesisCalls += 1;
        ac.abort("user");
        throw makeAbortError(ac.signal);
      },
    };

    const base = createTestConfig(root);
    const input: ReactLoopInput = {
      config: createTestConfig(root, {
        llm: { ...base.llm, maxToolRounds: 1 },
      }),
      services,
      agent: { model: "test-model", systemPrompt: "", tools: ["native:write_file"] },
      messages: [{ role: "user", content: "go" }],
      invokeTrpc: async () => ({}),
      transport,
      signal: ac.signal,
      runOrigin: "user",
    };

    await expect(runReactLoop(input)).rejects.toMatchObject({ name: "AbortError" });
    expect(synthesisCalls).toBe(1);

    const terminals = runUpdate.mock.calls
      .map((c) => c[0] as unknown as { status?: string; output?: { content?: string } })
      .filter((u) => u.status === "success" || u.status === "cancelled" || u.status === "failed");

    expect(terminals.some((t) => t.status === "success")).toBe(false);
    expect(terminals.some((t) => t.status === "cancelled")).toBe(true);
    expect(terminals.some((t) => isFallbackSuccess(t.status, t.output?.content))).toBe(false);
  });

  it("finalizeRun：synthesizing 入口已 aborted 时拒绝 success，强制 cancelled", async () => {
    const { services, runUpdate } = stubServices();
    const ac = new AbortController();
    let round = 0;

    const transport: LlmTransport = {
      async complete({ withTools }) {
        round += 1;
        if (withTools && round === 1) {
          return {
            content: "",
            toolCalls: [tc("c1", "write_file", { path: "a.txt", content: "1" })],
            model: "test-model",
            provider: "test",
          };
        }
        throw new Error("unexpected synthesis call while aborted");
      },
    };

    const base = createTestConfig(root);
    const input: ReactLoopInput = {
      config: createTestConfig(root, {
        llm: { ...base.llm, maxToolRounds: 1 },
      }),
      services,
      agent: { model: "test-model", systemPrompt: "", tools: ["native:write_file"] },
      messages: [{ role: "user", content: "go" }],
      invokeTrpc: async () => ({}),
      transport,
      signal: ac.signal,
      runOrigin: "user",
      hooks: {
        onPhase: (to) => {
          if (to === "synthesizing") ac.abort("user");
        },
      },
    };

    await expect(runReactLoop(input)).rejects.toMatchObject({ name: "AbortError" });

    const terminals = runUpdate.mock.calls
      .map((c) => c[0] as unknown as { status?: string; output?: { content?: string } })
      .filter((u) => typeof u.status === "string");

    expect(terminals.some((t) => t.status === "success")).toBe(false);
    expect(terminals.some((t) => t.status === "cancelled")).toBe(true);
    expect(terminals.some((t) => isFallbackSuccess(t.status, t.output?.content))).toBe(false);
  });
});
