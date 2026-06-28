/**
 * LLM 每日预算追踪（美元估算，OpenClaw 式网关预算）
 */

import fs from "fs";
import path from "path";
import type { AppConfig } from "./config.js";

/** 混合 token 粗算单价（USD / 1K tokens） */
const BLENDED_USD_PER_1K = 0.0005;

interface BudgetState {
  date: string;
  spentUsd: number;
}

const globalBudget = globalThis as unknown as { __llmBudget?: BudgetState };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function budgetFile(projectRoot: string) {
  return path.join(projectRoot, ".dev-log", "llm-budget.json");
}

function loadState(projectRoot: string): BudgetState {
  const file = budgetFile(projectRoot);
  if (!fs.existsSync(file)) return { date: todayKey(), spentUsd: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as BudgetState;
    if (parsed.date !== todayKey()) return { date: todayKey(), spentUsd: 0 };
    return { date: parsed.date, spentUsd: Number(parsed.spentUsd) || 0 };
  } catch {
    return { date: todayKey(), spentUsd: 0 };
  }
}

function saveState(projectRoot: string, state: BudgetState) {
  const file = budgetFile(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

function getState(config: AppConfig): BudgetState {
  if (!globalBudget.__llmBudget || globalBudget.__llmBudget.date !== todayKey()) {
    globalBudget.__llmBudget = loadState(config.projectRoot);
  }
  return globalBudget.__llmBudget;
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
  const state = getState(config);
  const limitUsd = config.llm.dailyBudget;
  const ratio = limitUsd > 0 ? state.spentUsd / limitUsd : 0;
  return {
    limitUsd,
    spentUsd: state.spentUsd,
    ratio: Math.min(1, ratio),
    warn: limitUsd > 0 && ratio >= 0.85 && ratio < 1,
    exceeded: limitUsd > 0 && state.spentUsd >= limitUsd,
    date: state.date,
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
  const state = getState(config);
  state.spentUsd += (total / 1000) * BLENDED_USD_PER_1K;
  globalBudget.__llmBudget = state;
  saveState(config.projectRoot, state);
}
