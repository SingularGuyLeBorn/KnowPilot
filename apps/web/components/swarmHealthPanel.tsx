/**
 * Swarm 健康面板 — /agents 编辑页；与 agent.swarmHealth 同源。
 * needsAttention=false 时仍展示一行「健康」摘要，便于确认可观测通道活着。
 */

"use client";

import Link from "next/link";
import { Activity, Loader2, Mail, MessageCircle, PauseCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function SwarmHealthPanel({ agentId }: { agentId: string }) {
  const { data, isLoading, isError } = trpc.agent.swarmHealth.useQuery(
    { agentId },
    { enabled: !!agentId, staleTime: 15_000, refetchInterval: 15_000 },
  );

  if (isLoading) {
    return (
      <div
        data-testid="swarm-health-panel"
        className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-[11px] text-[var(--kp-text-3)]"
      >
        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
        加载 Swarm 健康…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        data-testid="swarm-health-panel"
        className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-[11px] text-[var(--kp-text-3)]"
      >
        无法加载 Swarm 健康快照。
      </div>
    );
  }

  return (
    <div
      data-testid="swarm-health-panel"
      className={cn(
        "space-y-2 rounded-xl border p-3",
        data.needsAttention
          ? "border-sky-300/70 bg-sky-50/80 dark:border-sky-500/40 dark:bg-sky-950/30"
          : "border-[var(--kp-divider)] bg-[var(--kp-bg)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Activity className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
        <span className="font-medium text-[var(--kp-text-1)]">Swarm 健康</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[9px] font-semibold",
            data.needsAttention
              ? "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"
              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
          )}
        >
          {data.needsAttention ? "需关注" : "正常"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-[var(--kp-text-2)] sm:grid-cols-4">
        <Metric label="inbox pending" value={data.inbox.pending} warn={data.inbox.pending > 0} />
        <Metric label="superior 队列" value={data.superiorQueue.pendingItems} warn={data.superiorQueue.pendingItems > 0} />
        <Metric label="paused 会话" value={data.sessions.paused} warn={data.sessions.paused > 0} />
        <Metric label="ask_user" value={data.askUserPending.length} warn={data.askUserPending.length > 0} />
      </div>
      {data.heartbeat.suspendedAt && (
        <p className="flex items-center gap-1 text-[10px] text-rose-700 dark:text-rose-300">
          <PauseCircle className="h-3 w-3" />
          心跳熔断于 {new Date(data.heartbeat.suspendedAt).toLocaleString("zh-CN", { hour12: false })}
        </p>
      )}
      {data.askUserPending.length > 0 && (
        <ul className="max-h-28 space-y-1 overflow-y-auto text-[10px] text-[var(--kp-text-2)]">
          {data.askUserPending.slice(0, 5).map((a) => (
            <li key={a.askId} className="flex items-start gap-1.5 rounded bg-[var(--kp-bg-mute)] px-2 py-1">
              {a.channel === "email" ? (
                <Mail className="mt-0.5 h-3 w-3 shrink-0" />
              ) : (
                <MessageCircle className="mt-0.5 h-3 w-3 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/chat?sessionId=${a.sessionId}`}
                  className="font-medium text-[var(--kp-brand-deep)] underline-offset-2 hover:underline"
                >
                  打开会话
                </Link>
                <span className="ml-1 truncate text-[var(--kp-text-3)]">{a.question}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric(props: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg px-2 py-1.5",
        props.warn ? "bg-amber-100/80 dark:bg-amber-900/30" : "bg-[var(--kp-bg-mute)]",
      )}
    >
      <div className="text-[9px] text-[var(--kp-text-3)]">{props.label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", props.warn && "text-amber-900 dark:text-amber-200")}>
        {props.value}
      </div>
    </div>
  );
}
