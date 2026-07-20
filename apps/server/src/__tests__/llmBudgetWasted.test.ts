import { describe, it, expect, beforeEach } from "vitest";
import {
  resetLlmBudgetForTests,
  recordTokenUsage,
  markTokensWasted,
  getLlmBudgetStatus,
  WASTED_TOKEN_ALERT_RATIO,
} from "../infra/llmBudget.js";
import type { AppConfig } from "../infra/config.js";

function fakeConfig(root = "D:/tmp/knowpilot-budget-test"): AppConfig {
  return {
    projectRoot: root,
    llm: { dailyBudget: 10 },
  } as AppConfig;
}

describe("W5 llmBudget wastedTokens 分账", () => {
  beforeEach(() => {
    resetLlmBudgetForTests();
  });

  it("productive 路径只累加 totalTokens，不进 wasted", () => {
    const config = fakeConfig();
    recordTokenUsage(config, { total: 1000 });
    const s = getLlmBudgetStatus(config);
    expect(s.totalTokens).toBe(1000);
    expect(s.wastedTokens).toBe(0);
    expect(s.wasteRatio).toBe(0);
  });

  it("unproductive 经 markTokensWasted 累计且不改变 spentUsd 扣减语义", () => {
    const config = fakeConfig();
    recordTokenUsage(config, { total: 2000 });
    const spentAfter = getLlmBudgetStatus(config).spentUsd;
    markTokensWasted(config, 2000);
    const s = getLlmBudgetStatus(config);
    expect(s.spentUsd).toBe(spentAfter);
    expect(s.wastedTokens).toBe(2000);
    expect(s.totalTokens).toBe(2000);
    expect(s.wasteRatio).toBe(1);
    expect(s.wasteRatio).toBeGreaterThanOrEqual(WASTED_TOKEN_ALERT_RATIO);
  });

  it("混合同日：空转占比正确", () => {
    const config = fakeConfig();
    recordTokenUsage(config, { total: 3000 });
    recordTokenUsage(config, { total: 1000 });
    markTokensWasted(config, 1000);
    const s = getLlmBudgetStatus(config);
    expect(s.totalTokens).toBe(4000);
    expect(s.wastedTokens).toBe(1000);
    expect(s.wasteRatio).toBeCloseTo(0.25);
  });
});
