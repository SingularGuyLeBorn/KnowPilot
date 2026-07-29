import { describe, it, expect, beforeEach } from "vitest";
import {
  resetLlmBudgetForTests,
  recordTokenUsage,
  getLlmBudgetStatus,
  isZeroCostModel,
} from "../infra/llmBudget.js";
import type { AppConfig } from "../infra/config.js";

function fakeConfig(): AppConfig {
  return {
    projectRoot: "D:/tmp/knowpilot-budget-zerocost",
    llm: { dailyBudget: 10, blendedUsdPer1k: 0.0005 },
  } as AppConfig;
}

describe("llmBudget 免费模型不计美元", () => {
  beforeEach(() => {
    resetLlmBudgetForTests();
  });

  it("识别 :free / freellm / mock / 本地模型", () => {
    expect(isZeroCostModel("google/gemma-4-26b-a4b-it:free")).toBe(true);
    expect(isZeroCostModel("freellm/gpt-oss")).toBe(true);
    expect(isZeroCostModel("mock-scenario-a")).toBe(true);
    expect(isZeroCostModel("ollama/qwen2.5")).toBe(true);
    expect(isZeroCostModel("deepseek-v4-flash")).toBe(false);
  });

  it(":free 只记 token 不累加 spentUsd", () => {
    const config = fakeConfig();
    recordTokenUsage(config, { total: 1_000_000 }, "org/model:free");
    const s = getLlmBudgetStatus(config);
    expect(s.totalTokens).toBe(1_000_000);
    expect(s.spentUsd).toBe(0);
    expect(s.exceeded).toBe(false);
  });

  it("付费模型按 blended 单价计费", () => {
    const config = fakeConfig();
    recordTokenUsage(config, { total: 2000 }, "deepseek-v4-flash");
    expect(getLlmBudgetStatus(config).spentUsd).toBeCloseTo(0.001);
  });
});
