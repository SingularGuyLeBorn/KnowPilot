/**
 * 系统看板页面 (L5 Analytics)
 */

"use client";

import React from "react";
import { motion } from "framer-motion";
import { BarChart3, Bot, FileText, Sparkles, Wand2, MessageSquare, CalendarClock, AlertTriangle, type LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { LoadingState } from "@/components/shared";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/50 p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]">
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-medium text-[var(--vp-c-text-3)]">{label}</span>
      </div>
      <p className="text-2xl font-bold text-[var(--vp-c-text-1)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--vp-c-text-3)] mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = trpc.analytics.dashboard.useQuery({});

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-[var(--vp-c-divider)] bg-gradient-to-br from-[var(--vp-c-bg-alt)] to-[var(--vp-c-bg-soft)] p-8"
      >
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--vp-c-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--vp-c-brand)] mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          L5 · 系统看板
        </div>
        <h1 className="text-3xl font-extrabold text-[var(--vp-c-text-1)]">Analytics 概览</h1>
        <p className="text-sm text-[var(--vp-c-text-3)] mt-2">文章、Agent 运行、Token 与日志错误趋势一览。</p>
      </motion.div>

      {isLoading || !data ? (
        <LoadingState count={6} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
          />
          <StatCard
            icon={Sparkles}
            label="Token（近 500 次 Run）"
            value={data.tokens.estimatedTotal.toLocaleString()}
          />
        </div>
      )}
    </div>
  );
}
