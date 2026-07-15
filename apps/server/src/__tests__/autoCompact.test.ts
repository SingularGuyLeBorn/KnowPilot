import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../infra/config.js";
import {
  maybeCompactMessages,
  estimateChars,
  SUMMARY_MARKER,
  COMPACT_BOUNDARY_PREFIX,
  DEFAULT_COMPACT_KEEP_RECENT,
  microCompactMessages,
  resolveCompactThresholdForModel,
} from "../infra/autoCompact.js";
import * as llmClient from "../infra/llmClient.js";
import type { LlmMessage } from "../infra/llmClient.js";

function makeConfig(overrides?: Partial<AppConfig["compact"]>): AppConfig {
  return {
    compact: {
      enabled: true,
      triggerRatio: 0.75,
      keepRecent: 4,
      microCompact: { enabled: true, toolResultMaxChars: 500 },
      memoryFlush: { enabled: false, maxFacts: 5 },
      ...overrides,
    },
  } as AppConfig;
}

function longMessages(n: number, charsEach = 200): LlmMessage[] {
  const msgs: LlmMessage[] = [{ role: "system", content: "sys" }];
  for (let i = 0; i < n; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg-${i}-` + "x".repeat(charsEach),
    });
  }
  return msgs;
}

describe("autoCompact", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spy: any;

  beforeEach(() => {
    spy = vi.spyOn(llmClient, "chatCompletion").mockResolvedValue({
      content: "这是压缩后的摘要内容。",
      tool_calls: undefined,
      usage: undefined,
    } as any);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("未超阈值时不压缩", async () => {
    const messages = longMessages(3, 20);
    const threshold = resolveCompactThresholdForModel(makeConfig(), "deepseek-v4-flash");
    const result = await maybeCompactMessages(
      makeConfig({ triggerRatio: 0.99 }),
      messages,
      "deepseek-v4-flash",
    );
    expect(result.compacted).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(threshold).toBeGreaterThan(300_000);
  });

  it("超阈值时调用 LLM 并返回带 boundary 的 summaryText", async () => {
    const messages = longMessages(40, 500);
    expect(estimateChars(messages)).toBeGreaterThan(25_000);
    const result = await maybeCompactMessages(makeConfig({ triggerRatio: 0.05 }), messages, "deepseek-v4-flash");
    expect(result.compacted).toBe(true);
    expect(result.summaryText).toContain("摘要");
    expect(result.reused).toBeFalsy();
    expect(spy).toHaveBeenCalledOnce();
    expect(result.messages.some((m) => String(m.content).includes(SUMMARY_MARKER))).toBe(true);
    expect(result.messages.some((m) => String(m.content).includes(COMPACT_BOUNDARY_PREFIX))).toBe(true);
  });

  it("已有摘要且体积够用时复用，不再调 LLM", async () => {
    const messages = longMessages(20, 500);
    const result = await maybeCompactMessages(makeConfig({ triggerRatio: 0.99 }), messages, "deepseek-v4-flash", {
      existingSummary: "旧摘要内容",
    });
    expect(result.compacted).toBe(true);
    expect(result.reused).toBe(true);
    expect(result.summaryText).toBe("旧摘要内容");
    expect(spy).not.toHaveBeenCalled();
  });

  it("消息过少时不压缩", async () => {
    const keep = DEFAULT_COMPACT_KEEP_RECENT;
    const messages = longMessages(keep, 2000);
    const result = await maybeCompactMessages(makeConfig({ triggerRatio: 0.05, keepRecent: keep }), messages, "m");
    expect(result.compacted).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("LLM 失败时降级裁剪最早消息", async () => {
    spy.mockRejectedValueOnce(new Error("llm down"));
    const messages = longMessages(40, 500);
    const result = await maybeCompactMessages(makeConfig({ triggerRatio: 0.05 }), messages, "deepseek-v4-flash");
    expect(result.compacted).toBe(true);
    expect(result.summaryText).toBeUndefined();
    const nonSystem = result.messages.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBeLessThanOrEqual(4);
  });

  it("microCompact 截断超大 tool result", () => {
    const messages: LlmMessage[] = [
      { role: "tool", tool_call_id: "1", name: "read_file", content: "x".repeat(2000) },
    ];
    const out = microCompactMessages(messages, 500);
    expect(String(out[0].content).length).toBeLessThan(2000);
    expect(String(out[0].content)).toContain("micro-compact");
  });
});
