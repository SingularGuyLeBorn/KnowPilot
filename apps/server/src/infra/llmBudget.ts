/**
 * LLM 每日预算追踪（美元估算，OpenClaw 式网关预算）
 *
 * 状态管理：模块级内存为唯一运行时真相，LLM 调用路径上零同步 IO。
 * - 落盘：防抖异步写（fs.promises），进程崩溃最多丢失最近一个防抖窗口的消耗
 * - 恢复：首次访问时异步 hydrate（fire-and-forget）；若 hydrate 完成前已有新消耗（dirty），
 *   以内存为准，避免旧文件覆盖新状态
 */

import fs from "fs";
import path from "path";
import type { AppConfig } from "./config.js";

/** 混合 token 粗算单价（USD / 1K tokens） */
const BLENDED_USD_PER_1K = 0.0005;

/** 异步落盘防抖窗口（毫秒） */
const FLUSH_DEBOUNCE_MS = 250;

interface BudgetState {
  date: string;
  spentUsd: number;
}

/** 模块级内存状态（替代原 globalThis 隐式全局） */
let state: BudgetState = { date: todayKey(), spentUsd: 0 };
/** 内存状态是否已领先于磁盘（领先时 hydrate 不得覆盖） */
let dirty = false;
/** 单调递增版本号：用于识别异步落盘期间是否发生新消耗 */
let version = 0;
let hydrated = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function budgetFile(projectRoot: string) {
  return path.join(projectRoot, ".dev-log", "llm-budget.json");
}

/** 异步 hydrate：仅当磁盘文件属于今日且内存尚无新消耗时采用 */
function hydrateAsync(projectRoot: string): void {
  if (hydrated) return;
  hydrated = true;
  fs.promises
    .readFile(budgetFile(projectRoot), "utf8")
    .then((raw) => {
      if (dirty) return;
      try {
        const parsed = JSON.parse(raw) as BudgetState;
        if (parsed.date === todayKey()) {
          state = { date: parsed.date, spentUsd: Number(parsed.spentUsd) || 0 };
        }
      } catch {
        /* 文件损坏：忽略，从 0 开始 */
      }
    })
    .catch(() => {
      /* 文件不存在：正常路径 */
    });
}

async function flushAsync(projectRoot: string, snapshotVersion: number): Promise<void> {
  const file = budgetFile(projectRoot);
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(state, null, 2), "utf8");
    // 落盘期间若有新消耗（version 已前进），保持 dirty 让下一轮防抖再写
    if (version === snapshotVersion) dirty = false;
  } catch (err) {
    // 落盘失败不阻断 LLM 调用路径；内存状态仍是运行时真相
    console.warn("[llmBudget] 预算异步落盘失败:", err instanceof Error ? err.message : err);
  }
}

function scheduleFlush(projectRoot: string): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAsync(projectRoot, version);
  }, FLUSH_DEBOUNCE_MS);
  flushTimer.unref?.();
}

function getState(config: AppConfig): BudgetState {
  hydrateAsync(config.projectRoot);
  if (state.date !== todayKey()) {
    // 跨天 rollover：内存内重置并标记落盘
    state = { date: todayKey(), spentUsd: 0 };
    dirty = true;
    version += 1;
    scheduleFlush(config.projectRoot);
  }
  return state;
}

export interface LlmBudgetStatus {
  limitUsd: number;
  spentUsd: number;
  ratio: number;
  warn: boolean;
  exceeded: boolean;
  date: string;
}

export function getLlmBudgetStatus(config: AppConfig): LlmBudgetStatus {
  const s = getState(config);
  const limitUsd = config.llm.dailyBudget;
  const ratio = limitUsd > 0 ? s.spentUsd / limitUsd : 0;
  return {
    limitUsd,
    spentUsd: s.spentUsd,
    ratio: Math.min(1, ratio),
    warn: limitUsd > 0 && ratio >= 0.85 && ratio < 1,
    exceeded: limitUsd > 0 && s.spentUsd >= limitUsd,
    date: s.date,
  };
}

export function assertLlmBudget(config: AppConfig) {
  const status = getLlmBudgetStatus(config);
  if (status.exceeded) {
    throw new Error(
      `今日 LLM 预算已用尽（约 $${status.spentUsd.toFixed(2)} / $${status.limitUsd}）。` +
        "请明日再试，或在 .env 提高 LLM_DAILY_BUDGET。",
    );
  }
}

export function recordTokenUsage(
  config: AppConfig,
  usage?: { prompt?: number; completion?: number; total?: number },
) {
  const total = usage?.total ?? (usage?.prompt ?? 0) + (usage?.completion ?? 0);
  if (!total) return;
  const s = getState(config);
  s.spentUsd += (total / 1000) * BLENDED_USD_PER_1K;
  dirty = true;
  version += 1;
  scheduleFlush(config.projectRoot);
}

/** 测试隔离：重置预算内存状态与待落盘任务 */
export function resetLlmBudgetForTests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  state = { date: todayKey(), spentUsd: 0 };
  dirty = false;
  version = 0;
  hydrated = false;
}

/** 测试用：等待防抖落盘完成（生产代码请勿调用） */
export async function flushLlmBudgetForTests(projectRoot: string): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (dirty) await flushAsync(projectRoot, version);
}
