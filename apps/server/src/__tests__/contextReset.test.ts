/**
 * P1 Context Reset 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  estimateTokenCount,
  resolveContextWindow,
  shouldResetContext,
  resetContext,
} from "../infra/loop/contextReset.js";
import type { LlmMessage } from "../infra/llmClient.js";

function makeMessages(n: number, contentLen = 100): LlmMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(contentLen),
  }));
}

describe("contextReset", () => {
  beforeEach(() => {
    delete process.env.AGENT_CONTEXT_RESET_THRESHOLD;
  });
  afterEach(() => {
    delete process.env.AGENT_CONTEXT_RESET_THRESHOLD;
  });

  it("估算 token 数 = 总字符 / 3.5 向上取整", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "a".repeat(350) },
      { role: "user", content: "b".repeat(350) },
    ];
    expect(estimateTokenCount(messages)).toBe(200);
  });

  it("resolveContextWindow 对已知模型返回合理值", () => {
    expect(resolveContextWindow("deepseek-v4-flash")).toBe(131_072);
    expect(resolveContextWindow("kimi-k2")).toBe(256_000);
    expect(resolveContextWindow("gpt-4o")).toBe(128_000);
  });

  it("未超过阈值时不重置", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "system prompt" },
      ...makeMessages(10, 100),
    ];
    const result = resetContext(messages, {
      modelId: "deepseek-v4-flash",
      systemPrompt: "system prompt",
      contextWindow: 100_000,
      thresholdRatio: 0.5,
      keepRecentTurns: 1,
    });
    expect(result.reset).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("超过阈值时重置并保留 system prompt + 交接文档 + 最近 user/assistant", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "goal: build a calculator" },
      ...makeMessages(100, 1000),
    ];
    const result = resetContext(messages, {
      modelId: "test-model",
      systemPrompt: "system prompt\n- 禁止删除自己\n- 必须写测试",
      contextWindow: 10_000,
      thresholdRatio: 0.4,
      keepRecentTurns: 1,
    });
    expect(result.reset).toBe(true);
    expect(result.estimatedTokens).toBeGreaterThan(result.threshold);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toBe("system prompt");
    expect(result.messages[1].role).toBe("user");
    expect(result.messages[1].content).toContain("上下文交接");
    expect(result.messages[1].content).toContain("build a calculator");
    expect(result.messages[1].content).toContain("禁止删除自己");
    expect(result.messages[1].content).toContain("必须写测试");
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
    // 最后一条保留的是 assistant
    expect(result.messages[result.messages.length - 1].role).toBe("assistant");
  });

  it("交接文档包含最近进展摘要", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "do it" },
      { role: "assistant", content: "a".repeat(3000) },
      { role: "tool", content: "t".repeat(3000), tool_call_id: "x" },
      { role: "assistant", content: "b".repeat(3000) },
      { role: "user", content: "next" },
      { role: "assistant", content: "c".repeat(3000) },
    ];
    const result = resetContext(messages, {
      modelId: "test-model",
      systemPrompt: "sys",
      contextWindow: 5_000,
      thresholdRatio: 0.4,
      keepRecentTurns: 2,
    });
    expect(result.reset).toBe(true);
    expect(result.handoffDoc).toContain("最近进展");
    expect(result.handoffDoc).toContain("c".repeat(3000).slice(0, 100));
  });

  it("AGENT_CONTEXT_RESET_THRESHOLD 环境变量可被覆盖", () => {
    process.env.AGENT_CONTEXT_RESET_THRESHOLD = "0.2";
    const messages = makeMessages(20, 1000);
    const { reset, threshold } = shouldResetContext(messages, "test-model");
    // test-model 默认窗口 81920，0.2 阈值 = 16384 tokens；20*1000/3.5 ≈ 5714 tokens，不触发
    expect(reset).toBe(false);
    expect(threshold).toBe(16_384);
  });

  it("非法环境变量回退 0.4", () => {
    process.env.AGENT_CONTEXT_RESET_THRESHOLD = "abc";
    const messages = makeMessages(20, 1000);
    const { threshold } = shouldResetContext(messages, "test-model");
    expect(threshold).toBe(32_768);
  });
});
