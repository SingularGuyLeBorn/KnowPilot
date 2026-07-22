/**
 * 系统看板页面 (L5 Analytics)
 */

"use client";

import React from "react";
import { motion } from "framer-motion";
import { BarChart3, Bot, Crown, FileText, ShieldCheck, Sparkles, Wand2, MessageSquare, CalendarClock, AlertTriangle, Activity, TrendingUp, type LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useNativeCapabilities } from "@/lib/hooks";
import { AdminPage, LoadingState, NativeCapabilitiesPanel, PageHeader } from "@/components/shared";
import { AsyncPoolPanel } from "@/components/asyncPoolPanel";
import { FreeModelsSummaryCard } from "@/components/freeModelsPanel";
import { cn } from "@/lib/utils";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  trend?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneStyles = {
    default: "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    danger: "bg-red-500/10 text-red-700 dark:text-red-400",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kp-card-premium kp-lift rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", toneStyles[tone])}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-xs font-medium text-[var(--kp-text-3)]">{label}</span>
        </div>
        {trend && (
          <span className="kp-badge kp-badge-success">
            <TrendingUp className="h-3 w-3" />
            {trend}
          </span>
        )}
      </div>
      <p className="kp-stat-number mt-4">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[var(--kp-text-3)]">{sub}</p>}
    </motion.div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = trpc.analytics.dashboard.useQuery({});
  const { data: caps } = useNativeCapabilities();
  const { data: swarmStats } = trpc.analytics.swarmStats.useQuery({ days: 30 });
  const { data: llmBudget } = trpc.agent.llmBudgetStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const workspacesQuery = trpc.workspace.list.useQuery({ page: 1, pageSize: 100, status: "active" });
  const workspaceNames = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspacesQuery.data?.items ?? []) m.set(w.id, w.name);
    return m;
  }, [workspacesQuery.data?.items]);

  const tierIcon = (tier: string) => (tier === "super" ? Crown : tier === "manager" ? ShieldCheck : Bot);

  const budgetRatio = llmBudget?.ratio ?? 0;
  const budgetTone = budgetRatio > 0.9 ? "danger" : budgetRatio > 0.7 ? "warning" : "success";

  return (
    <AdminPage>
      <PageHeader
        title="Analytics 概览"
        description="并发池、文章、Agent 运行、Token 与日志错误趋势一览。"
      />

      <AsyncPoolPanel workspaceNames={workspaceNames} />

      <FreeModelsSummaryCard />

      {llmBudget && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="kp-card-premium rounded-2xl p-4 md:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl",
                budgetTone === "danger" ? "bg-red-500/10 text-red-600" :
                budgetTone === "warning" ? "bg-amber-500/10 text-amber-600" :
                "bg-emerald-500/10 text-emerald-600"
              )}>
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--kp-text-1)]">今日 LLM 预算</span>
                  <span className={cn(
                    "kp-badge",
                    budgetTone === "danger" ? "kp-badge-danger" :
                    budgetTone === "warning" ? "kp-badge-warning" :
                    "kp-badge-success"
                  )}>
                    {(llmBudget.ratio * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--kp-text-3)]">30s 自动刷新</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-[var(--kp-text-1)]">
                ${llmBudget.spentUsd.toFixed(4)} <span className="text-sm font-normal text-[var(--kp-text-3)]">/ ${llmBudget.limitUsd.toFixed(2)}</span>
              </p>
              <div className="kp-progress mt-2 w-40">
                <div
                  className={cn(
                    "kp-progress-bar",
                    budgetTone === "danger" ? "!bg-red-500" :
                    budgetTone === "warning" ? "!bg-amber-500" : ""
                  )}
                  style={{ width: `${Math.min(100, llmBudget.ratio * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {caps && (
        <NativeCapabilitiesPanel
          data={caps}
          compact
          className="border-[var(--kp-divider)]"
          detailHref="/tools"
        />
      )}

      {isLoading || !data ? (
        <LoadingState count={6} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <StatCard
            icon={FileText}
            label="文章"
            value={data.posts.total}
            sub={`已发布 ${data.posts.published}`}
          />
          <StatCard icon={Bot} label="Agent" value={data.agents.total} />
          <StatCard
            icon={Wand2}
            label="Skill"
            value={data.skills.total}
            sub={`启用 ${data.skills.enabled}`}
          />
          <StatCard icon={MessageSquare} label="会话" value={data.sessions.total} />
          <StatCard
            icon={BarChart3}
            label="Agent 运行"
            value={data.runs.total}
            sub={`成功 ${data.runs.success} · 失败 ${data.runs.failed}`}
            tone={data.runs.failed > data.runs.success ? "warning" : "default"}
          />
          <StatCard
            icon={CalendarClock}
            label="定时任务"
            value={data.tasks.total}
            sub={`Cron ${data.tasks.cron}`}
          />
          <StatCard
            icon={AlertTriangle}
            label="24h 错误日志"
            value={data.logs.errors24h}
            tone={data.logs.errors24h > 0 ? "danger" : "success"}
          />
          <StatCard
            icon={Sparkles}
            label="Token（近 500 次 Run）"
            value={data.tokens.estimatedTotal.toLocaleString()}
          />
        </div>
      )}

      {/* Swarm Agent 运行统计（#25/#46） */}
      {swarmStats && swarmStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="kp-card-premium rounded-2xl p-6"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--kp-text-1)]">Swarm Agent 运行统计</h2>
              <p className="text-xs text-[var(--kp-text-3)]">近 30 天</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="kp-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="text-right">对话轮数</th>
                  <th className="text-right">工具调用</th>
                  <th className="text-right">成功率</th>
                  <th className="text-right">平均耗时</th>
                  <th className="text-right">Token 消耗</th>
                </tr>
              </thead>
              <tbody>
                {swarmStats.map((stat: { agentId: string; agentName: string; agentTier: string; conversationRounds: number; toolCallCount: number; successRate: number; avgDurationMs: number; totalTokens: number }) => {
                  const TierIcon = tierIcon(stat.agentTier);
                  return (
                    <tr key={stat.agentId}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--kp-bg-mute)]">
                            <TierIcon className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
                          </div>
                          <span className="font-medium text-[var(--kp-text-1)]">{stat.agentName}</span>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{stat.conversationRounds}</td>
                      <td className="text-right tabular-nums">{stat.toolCallCount}</td>
                      <td className="text-right tabular-nums">
                        <span className={cn(
                          "kp-badge",
                          stat.successRate >= 80 ? "kp-badge-success" :
                          stat.successRate >= 50 ? "kp-badge-warning" : "kp-badge-danger"
                        )}>
                          {stat.successRate}%
                        </span>
                      </td>
                      <td className="text-right tabular-nums">
                        {stat.avgDurationMs > 1000 ? `${(stat.avgDurationMs / 1000).toFixed(1)}s` : `${stat.avgDurationMs}ms`}
                      </td>
                      <td className="text-right tabular-nums">{stat.totalTokens.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </AdminPage>
  );
}
