import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../infra/config.js";
import {
  maybeCompactMessages,
  buildLlmContextSinceCompact,
  CONTEXT_SUMMARY_ACK,
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
      // 单测消息体远小于默认 20k tokens；需小预算才能切出可摘要段
      keepRecentTokens: overrides?.keepRecentTokens ?? 200,
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

/** deepseek-v4-flash @ triggerRatio=0.05 → 阈值 25600；留足余量避免贴边假红 */
const OVER_THRESHOLD_CHARS = 800;

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
    const messages = longMessages(40, OVER_THRESHOLD_CHARS);
    expect(estimateChars(messages)).toBeGreaterThan(25_600);
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
    const messages = longMessages(40, OVER_THRESHOLD_CHARS);
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

  it("复用摘要时保留压缩后全部原文，不用 keepRecent 截断", async () => {
    const messages = longMessages(20, 80);
    const result = await maybeCompactMessages(makeConfig({ triggerRatio: 0.99, keepRecent: 4 }), messages, "deepseek-v4-flash", {
      existingSummary: "旧摘要内容",
    });
    expect(result.reused).toBe(true);
    const nonSystem = result.messages.filter((m) => m.role !== "system");
    // summary pair(2) + 原 20 条（longMessages 含 system，rest=20）
    expect(nonSystem.length).toBe(22);
    expect(nonSystem.some((m) => String(m.content).includes("msg-0-"))).toBe(true);
    expect(nonSystem.some((m) => String(m.content).includes("msg-19-"))).toBe(true);
  });

  it("buildLlmContextSinceCompact = summaryText + 边界后全部消息", () => {
    const boundary = `${COMPACT_BOUNDARY_PREFIX}v1@2026-01-01T00:00:00.000Z]`;
    const history = [
      { role: "user", content: "旧 SECRET_OLD" },
      { role: "assistant", content: "旧答" },
      {
        role: "assistant",
        content: `${boundary}\n已自动压缩`,
        toolCalls: [{ id: "c1", name: "__context_compact__", kind: "compact", args: {}, result: {} }],
      },
      { role: "user", content: "边界后-1" },
      { role: "assistant", content: "边界后-2" },
      { role: "user", content: "边界后-3" },
    ];
    const messages = buildLlmContextSinceCompact("sys", history, {
      contextSummary: "这是持久化摘要 SUMMARY_SECRET",
    });
    const blob = JSON.stringify(messages);
    expect(blob).toContain("SUMMARY_SECRET");
    expect(blob).toContain(SUMMARY_MARKER);
    expect(blob).toContain("边界后-1");
    expect(blob).toContain("边界后-2");
    expect(blob).toContain("边界后-3");
    expect(blob).toContain(CONTEXT_SUMMARY_ACK);
    expect(blob).not.toContain("SECRET_OLD");
    // 边界 UI 气泡本身不进 LLM
    expect(blob).not.toContain("已自动压缩");
  });

  it("buildLlmContextSinceCompact 幂等：已含摘要 pair 不双重注入", () => {
    const history = [
      { role: "user", content: "继续" },
    ];
    const once = buildLlmContextSinceCompact("sys", history, { contextSummary: "摘要A" });
    const twice = buildLlmContextSinceCompact("sys", history, { contextSummary: "摘要A" });
    const count = (msgs: typeof once) =>
      msgs.filter((m) => typeof m.content === "string" && m.content.includes(SUMMARY_MARKER)).length;
    expect(count(once)).toBe(1);
    expect(count(twice)).toBe(1);
  });

});
