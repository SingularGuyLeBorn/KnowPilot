/**
 * C5：llmBudget hydrate 竞态 + 合并语义
 *
 * 负向断言（旧实现「dirty 则丢弃磁盘」红 → 合并 max 后绿）：
 * 磁盘已有消耗，hydrate 未完成窗口内发生新消耗 → 合并后不丢额度。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  hydrateLlmBudget,
  recordTokenUsage,
  getLlmBudgetStatus,
  resetLlmBudgetForTests,
  flushLlmBudgetForTests,
} from "../infra/llmBudget.js";
import type { AppConfig } from "../infra/config.js";

function makeConfig(projectRoot: string): AppConfig {
  return {
    projectRoot,
    llm: { dailyBudget: 10 },
  } as unknown as AppConfig;
}

describe("C5 llmBudget hydrate 合并", () => {
  let tmpRoot: string;

  beforeEach(() => {
    resetLlmBudgetForTests();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kp-budget-"));
    fs.mkdirSync(path.join(tmpRoot, ".dev-log"), { recursive: true });
  });

  afterEach(async () => {
    await flushLlmBudgetForTests(tmpRoot).catch(() => undefined);
    resetLlmBudgetForTests();
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("磁盘有消耗、hydrate 窗口内新消耗 → 合并后不丢额度", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpRoot, ".dev-log", "llm-budget.json");
    fs.writeFileSync(file, JSON.stringify({ date: today, spentUsd: 5 }, null, 2), "utf8");

    let releaseRead!: () => void;
    const readGate = new Promise<void>((r) => {
      releaseRead = r;
    });
    const realRead = fs.promises.readFile.bind(fs.promises);
    vi.spyOn(fs.promises, "readFile").mockImplementation(async (p, enc) => {
      if (String(p).includes("llm-budget.json")) {
        await readGate;
        return realRead(p, enc as BufferEncoding);
      }
      return realRead(p, enc as BufferEncoding);
    });

    const config = makeConfig(tmpRoot);
    const hydrateP = hydrateLlmBudget(tmpRoot);

    // hydrate 读盘未完成时先记一笔新消耗（旧实现 dirty=true 后整份磁盘被丢弃）
    recordTokenUsage(config, { total: 2000 }); // ≈ $0.001
    const mid = getLlmBudgetStatus(config).spentUsd;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);

    releaseRead();
    await hydrateP;

    const after = getLlmBudgetStatus(config).spentUsd;
    expect(after).toBeGreaterThanOrEqual(5);
  });

  it("启动 hydrate 幂等：二次调用不覆盖已合并状态", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(tmpRoot, ".dev-log", "llm-budget.json");
    fs.writeFileSync(file, JSON.stringify({ date: today, spentUsd: 3 }, null, 2), "utf8");

    const config = makeConfig(tmpRoot);
    await hydrateLlmBudget(tmpRoot);
    expect(getLlmBudgetStatus(config).spentUsd).toBe(3);

    recordTokenUsage(config, { total: 2000 });
    const spent = getLlmBudgetStatus(config).spentUsd;
    await hydrateLlmBudget(tmpRoot);
    expect(getLlmBudgetStatus(config).spentUsd).toBe(spent);
  });
});
