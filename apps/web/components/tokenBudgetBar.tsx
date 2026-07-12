"use client";

import { Gauge } from "lucide-react";
import {
  buildTokenBudget,
  formatTokenCount,
  type TokenBudgetSnapshot,
} from "@/lib/tokenBudget";
import { cn } from "@/lib/utils";

export function TokenBudgetBar({
  snapshot,
  dailyBudget,
  compact = false,
  embedded = false,
  className,
}: {
  snapshot: TokenBudgetSnapshot;
  dailyBudget?: {
    limitUsd: number;
    spentUsd: number;
    ratio: number;
    warn: boolean;
    exceeded: boolean;
  };
  /** 隐藏底部说明文案 */
  compact?: boolean;
  /** 嵌入设置面板：无外框/无重复标题（由外层 Section 提供） */
  embedded?: boolean;
  className?: string;
}) {
  const pct = Math.round(snapshot.compactRatio * 100);
  const warn = snapshot.compactRatio >= 0.75;
  const critical = snapshot.compactRatio >= 0.92;

  return (
    <div
      className={cn(
        embedded ? "min-w-0" : "rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3",
        className,
      )}
      data-testid="token-budget-bar"
    >
      {!embedded && (
        <div className="mb-2 flex min-w-0 items-center gap-2 text-xs">
          <Gauge className={cn("h-3.5 w-3.5 shrink-0", critical ? "text-red-600" : warn ? "text-amber-600" : "text-[var(--kp-brand)]")} />
          <span className="font-semibold text-[var(--kp-text-1)]">Token 预算</span>
          {!compact && (
            <span className="ml-auto truncate text-[10px] text-[var(--kp-text-3)]">对标 Codex 上下文条</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-[10px] text-[var(--kp-text-2)]">
        <div>
          <span className="text-[var(--kp-text-3)]">会话累计</span>
          <div className="font-semibold tabular-nums text-[var(--kp-text-1)]">
            {formatTokenCount(snapshot.sessionTokens)}
            {snapshot.lastRoundTokens > 0 && (
              <span className="ml-1 font-normal text-[var(--kp-brand-deep)]">
                +{formatTokenCount(snapshot.lastRoundTokens)}
              </span>
            )}
          </div>
        </div>
        <div>
          <span className="text-[var(--kp-text-3)]">输出上限</span>
          <div className="font-semibold tabular-nums text-[var(--kp-text-1)]">
            {formatTokenCount(snapshot.maxOutputTokens)}
          </div>
        </div>
      </div>

      <div className="mt-2.5 space-y-1">
        <div className="flex justify-between text-[10px] text-[var(--kp-text-3)]">
          <span>上下文体积（auto-compact）</span>
          <span className={cn(critical && "text-red-600", warn && !critical && "text-amber-700")}>{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kp-bg-mute)]">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              critical ? "bg-red-500" : warn ? "bg-amber-500" : "bg-[var(--kp-brand)]",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {!compact && (
          <p className="text-[10px] leading-relaxed text-[var(--kp-text-3)]">
            约 {formatTokenCount(snapshot.estimatedContextChars)} 字符 · 达模型窗口{" "}
            {Math.round(snapshot.compactTriggerRatio * 100)}%（≈{formatTokenCount(snapshot.compactCharThreshold)} 字符）时自动摘要
          </p>
        )}
      </div>

      {dailyBudget && dailyBudget.limitUsd > 0 && (
        <div className="mt-2.5 space-y-1 border-t border-[var(--kp-divider)] pt-2">
          <div className="flex justify-between text-[10px] text-[var(--kp-text-3)]">
            <span>今日 LLM 预算</span>
            <span
              className={cn(
                dailyBudget.exceeded && "text-red-600 font-semibold",
                dailyBudget.warn && !dailyBudget.exceeded && "text-amber-700 font-semibold",
              )}
            >
              ${dailyBudget.spentUsd.toFixed(2)} / ${dailyBudget.limitUsd.toFixed(0)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kp-bg-mute)]">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                dailyBudget.exceeded ? "bg-red-500" : dailyBudget.warn ? "bg-amber-500" : "bg-[var(--kp-brand)]",
              )}
              style={{ width: `${Math.round(Math.min(1, dailyBudget.ratio) * 100)}%` }}
            />
          </div>
          {dailyBudget.warn && !dailyBudget.exceeded && (
            <p className="text-[10px] text-amber-700">接近今日预算上限，后续请求可能被拒绝。</p>
          )}
          {dailyBudget.exceeded && (
            <p className="text-[10px] text-red-600">今日预算已用尽，请明日再试或提高 LLM_DAILY_BUDGET。</p>
          )}
        </div>
      )}
    </div>
  );
}

export { buildTokenBudget, type TokenBudgetSnapshot };
