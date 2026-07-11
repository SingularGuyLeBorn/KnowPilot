import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../infra/config.js";
import {
  maybeCompactMessages,
  estimateChars,
  SUMMARY_MARKER,
  DEFAULT_COMPACT_KEEP_RECENT,
} from "../infra/autoCompact.js";
import * as llmClient from "../infra/llmClient.js";
import type { LlmMessage } from "../infra/llmClient.js";

function makeConfig(overrides?: Partial<AppConfig["compact"]>): AppConfig {
  return {
    compact: {
      enabled: true,
      charThreshold: 8_000,
      keepRecent: 4,
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
    const result = await maybeCompactMessages(makeConfig({ charThreshold: 100_000 }), messages, "m");
    expect(result.compacted).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("超阈值时调用 LLM 并返回 summaryText", async () => {
    // getCompactSettings 下限 8000 字符；用足够长的消息触发
    const messages = longMessages(20, 500);
    expect(estimateChars(messages)).toBeGreaterThan(8_000);
    const result = await maybeCompactMessages(makeConfig(), messages, "m");
    expect(result.compacted).toBe(true);
    expect(result.summaryText).toContain("摘要");
    expect(result.reused).toBeFalsy();
    expect(spy).toHaveBeenCalledOnce();
    expect(result.messages.some((m) => String(m.content).includes(SUMMARY_MARKER))).toBe(true);
  });

  it("已有摘要且体积够用时复用，不再调 LLM", async () => {
    const messages = longMessages(20, 500);
    const result = await maybeCompactMessages(makeConfig({ charThreshold: 100_000 }), messages, "m", {
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
    const result = await maybeCompactMessages(makeConfig({ charThreshold: 8_000, keepRecent: keep }), messages, "m");
    expect(result.compacted).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("LLM 失败时降级裁剪最早消息", async () => {
    spy.mockRejectedValueOnce(new Error("llm down"));
    const messages = longMessages(20, 500);
    const result = await maybeCompactMessages(makeConfig(), messages, "m");
    expect(result.compacted).toBe(true);
    expect(result.summaryText).toBeUndefined();
    const nonSystem = result.messages.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBeLessThanOrEqual(4);
  });
});
