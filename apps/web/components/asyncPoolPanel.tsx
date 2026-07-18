"use client";

/**
 * 全局异步任务池实时面板 —— Dashboard / 运维页共用。
 * 数据源：agent.asyncQueueStats（与 Chat 右栏同源）。
 */

import { Activity, Gauge, Layers, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

export type AsyncPoolStats = {
  queued: number;
  runningGlobal: number;
  maxGlobal: number;
  maxPerSession: number;
  maxPerWorkspace: number;
  maxQueued: number;
  taskTimeoutMs: number;
  hubInteractiveRunning: number;
  runningByWorkspace: Record<string, number>;
  queuedByReason: Record<"global" | "session" | "workspace", number>;
};

function Bar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const hot = max > 0 && used >= max;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--kp-text-2)]">{label}</span>
        <span className={cn("font-mono font-medium", hot ? "text-red-600" : "text-[var(--kp-text-1)]")}>
          {used} / {max > 0 ? max : "∞"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--kp-bg-mute)]">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            hot ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-[var(--kp-brand-deep)]",
          )}
          style={{ width: max > 0 ? `${pct}%` : used > 0 ? "8%" : "0%" }}
        />
      </div>
    </div>
  );
}

export function AsyncPoolPanel({
  className,
  compact = false,
  workspaceNames,
}: {
  className?: string;
  compact?: boolean;
  /** workspaceId → 显示名（可选） */
  workspaceNames?: Map<string, string>;
}) {
  const { data, isLoading, isError } = trpc.agent.asyncQueueStats.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className={cn("rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5", className)}>
        <p className="text-xs text-[var(--kp-text-3)]">加载并发池状态…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={cn("rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5", className)}>
        <p className="text-xs text-red-600">无法读取并发池统计</p>
      </div>
    );
  }

  const stats = data as AsyncPoolStats;
  const poolOnly = Math.max(0, stats.runningGlobal - stats.hubInteractiveRunning);
  const reasonTotal =
    (stats.queuedByReason?.global ?? 0) +
    (stats.queuedByReason?.session ?? 0) +
    (stats.queuedByReason?.workspace ?? 0);
  const wsEntries = Object.entries(stats.runningByWorkspace ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]",
        compact ? "p-4" : "p-5 md:p-6",
        className,
      )}
      data-testid="async-pool-panel"
    >
      <div className="mb-4 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-[var(--kp-brand-deep)]" />
        <h2 className="text-sm font-bold text-[var(--kp-text-1)]">全局任务并发池</h2>
        <span className="ml-auto text-[10px] text-[var(--kp-text-3)]">每 5s 刷新 · 与 Chat 右栏同源</span>
      </div>

      <div className={cn("grid gap-4", compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
        <div className="space-y-3">
          <Bar used={stats.runningGlobal} max={stats.maxGlobal} label="全局占用（池 + 交互）" />
          <Bar used={stats.queued} max={stats.maxQueued} label="排队中" />
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-[var(--kp-bg)] px-2.5 py-2">
              <div className="text-[var(--kp-text-3)]">池内执行</div>
              <div className="font-semibold text-[var(--kp-text-1)]">{poolOnly}</div>
            </div>
            <div className="rounded-lg bg-[var(--kp-bg)] px-2.5 py-2">
              <div className="text-[var(--kp-text-3)]">交互流占用</div>
              <div className="font-semibold text-[var(--kp-text-1)]">{stats.hubInteractiveRunning}</div>
            </div>
            <div className="rounded-lg bg-[var(--kp-bg)] px-2.5 py-2">
              <div className="text-[var(--kp-text-3)]">每会话上限</div>
              <div className="font-semibold text-[var(--kp-text-1)]">
                {stats.maxPerSession || "不限"}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--kp-bg)] px-2.5 py-2">
              <div className="text-[var(--kp-text-3)]">每空间上限</div>
              <div className="font-semibold text-[var(--kp-text-1)]">
                {stats.maxPerWorkspace || "不限"}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--kp-text-2)]">
            <Activity className="h-3.5 w-3.5" />
            排队原因
            {reasonTotal === 0 && (
              <span className="font-normal text-[var(--kp-text-3)]">· 当前无排队</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {(
              [
                ["global", "全局满"],
                ["session", "会话满"],
                ["workspace", "空间满"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="rounded-lg bg-[var(--kp-bg)] px-2.5 py-2 text-center">
                <div className="text-[var(--kp-text-3)]">{label}</div>
                <div className="font-semibold text-[var(--kp-text-1)]">
                  {stats.queuedByReason?.[key] ?? 0}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--kp-text-2)]">
            <Layers className="h-3.5 w-3.5" />
            Workspace 占用
          </div>
          {wsEntries.length === 0 ? (
            <p className="text-[11px] text-[var(--kp-text-3)]">当前无按空间计费的池任务</p>
          ) : (
            <ul className="max-h-28 space-y-1 overflow-y-auto text-[11px]">
              {wsEntries.map(([wid, n]) => (
                <li
                  key={wid}
                  className="flex items-center justify-between rounded-lg bg-[var(--kp-bg)] px-2.5 py-1.5"
                >
                  <span className="truncate text-[var(--kp-text-2)]">
                    {workspaceNames?.get(wid) || wid.slice(0, 10)}
                  </span>
                  <span className="font-mono font-medium text-[var(--kp-text-1)]">{n}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-1.5 text-[10px] text-[var(--kp-text-3)]">
            <Timer className="h-3 w-3" />
            任务超时 {(stats.taskTimeoutMs / 60_000).toFixed(0)} 分钟 · 配置见 config.yaml asyncJobs
          </div>
        </div>
      </div>
    </div>
  );
}
