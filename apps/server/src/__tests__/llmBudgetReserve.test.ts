/**
 * llmBudget 最小硬预留：spent+reserved 合计超限则拒。
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  assertLlmBudget,
  getLlmBudgetStatus,
  recordTokenUsage,
  releaseLlmBudgetReservation,
  resetLlmBudgetForTests,
  tryReserveLlmBudget,
} from "../infra/llmBudget.js";
import type { AppConfig } from "../infra/config.js";

function fakeConfig(dailyBudget = 0.01): AppConfig {
  return {
    projectRoot: "D:/tmp/knowpilot-budget-reserve",
    llm: { dailyBudget, blendedUsdPer1k: 0.001 },
  } as AppConfig;
}

describe("llmBudget 硬预留", () => {
  beforeEach(() => {
    resetLlmBudgetForTests();
  });

  it("预留占用后 assert 视同超限", () => {
    const config = fakeConfig(0.01);
    expect(tryReserveLlmBudget(config, 0.01)).toBe(true);
    expect(getLlmBudgetStatus(config).reservedUsd).toBeCloseTo(0.01);
    expect(tryReserveLlmBudget(config, 0.001)).toBe(false);
    expect(() => assertLlmBudget(config)).toThrow(/预留|用尽/);
    releaseLlmBudgetReservation(0.01);
    expect(getLlmBudgetStatus(config).reservedUsd).toBe(0);
    expect(() => assertLlmBudget(config)).not.toThrow();
  });

  it("record 与预留并存：释放预留后 spent 仍计入", () => {
    const config = fakeConfig(1);
    expect(tryReserveLlmBudget(config, 0.1)).toBe(true);
    recordTokenUsage(config, { total: 1000 }, "deepseek-v4-flash");
    const after = getLlmBudgetStatus(config);
    expect(after.spentUsd).toBeCloseTo(0.001);
    expect(after.reservedUsd).toBeCloseTo(0.1);
    releaseLlmBudgetReservation(0.1);
    expect(getLlmBudgetStatus(config).reservedUsd).toBe(0);
    expect(getLlmBudgetStatus(config).spentUsd).toBeCloseTo(0.001);
  });
});
