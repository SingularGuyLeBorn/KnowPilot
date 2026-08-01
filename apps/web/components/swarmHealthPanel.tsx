/**
 * Swarm 健康面板 — Agent 后台运行面快照（收件箱 / 上级队列 / 暂停会话 / 待答复）。
 * Chat 左栏 compact：窄栏用图标+数字，hover 看完整含义；/agents 编辑页用完整标签。
 */

"use client";

import Link from "next/link";
import {
  Activity,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  MessageCircleQuestion,
  PauseCircle,
  ArrowUpFromLine,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toPascalCaseId } from "@/lib/toolDisplayName";

export function SwarmHealthPanel({
  agentId,
  /** compact：Chat 运行页；健康且 hideWhenHealthy 时不占位 */
  compact,
  hideWhenHealthy,
}: {
  agentId: string;
  compact?: boolean;
  hideWhenHealthy?: boolean;
}) {
  const { data, isLoading, isError } = trpc.agent.swarmHealth.useQuery(
    { agentId },
    { enabled: !!agentId, staleTime: 15_000, refetchInterval: 15_000 },
  );

  if (isLoading) {
    if (compact && hideWhenHealthy) return null;
    return (
      <div
        data-testid="swarm-health-panel"
        className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-[11px] text-[var(--kp-text-3)]"
      >
        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
        加载运行健康…
      </div>
    );
  }

  if (isError || !data) {
    if (compact && hideWhenHealthy) return null;
    return (
      <div
        data-testid="swarm-health-panel"
        className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-[11px] text-[var(--kp-text-3)]"
      >
        无法加载运行健康快照。
      </div>
    );
  }

  if (hideWhenHealthy && !data.needsAttention) return null;

  const metrics: Array<{
    key: string;
    label: string;
    hint: string;
    value: number;
    warn: boolean;
    Icon: LucideIcon;
  }> = [
    {
      key: "inbox",
      label: "收件箱",
      hint: "待处理的 Agent 消息（InboxPending）",
      value: data.inbox.pending,
      warn: data.inbox.pending > 0,
      Icon: Inbox,
    },
    {
      key: "superior",
      label: "上级队",
      hint: "上级会话待 drain 的队列项",
      value: data.superiorQueue.pendingItems,
      warn: data.superiorQueue.pendingItems > 0,
      Icon: ArrowUpFromLine,
    },
    {
      key: "paused",
      label: "已暂停",
      hint: "Paused 会话（需手动恢复）",
      value: data.sessions.paused,
      warn: data.sessions.paused > 0,
      Icon: PauseCircle,
    },
    {
      key: "ask",
      label: "等人答",
      hint: "AskUser 待用户答复",
      value: data.askUserPending.length,
      warn: data.askUserPending.length > 0,
      Icon: MessageCircleQuestion,
    },
  ];

  return (
    <div
      data-testid="swarm-health-panel"
      className={cn(
        "space-y-2 rounded-xl border p-3",
        compact && "rounded-none border-x-0 border-t-0",
        data.needsAttention
          ? "border-amber-300/70 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-950/25"
          : "border-[var(--kp-divider)] bg-[var(--kp-bg)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Activity className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
        <span
          className="font-medium text-[var(--kp-text-1)]"
          title="Agent 后台运行面：收件箱、上级队列、暂停会话、待答复"
        >
          {compact ? "运行健康" : "Swarm 运行健康"}
        </span>
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
      <div
        className={cn(
          "grid gap-1.5 text-[10px] text-[var(--kp-text-2)]",
          compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4",
        )}
      >
        {metrics.map(({ key, ...rest }) => (
          <Metric key={key} {...rest} compact={compact} />
        ))}
      </div>
      {data.heartbeat.suspendedAt && (
        <p className="flex items-center gap-1 text-[10px] text-rose-700 dark:text-rose-300">
          <PauseCircle className="h-3 w-3 shrink-0" />
          心跳熔断于 {new Date(data.heartbeat.suspendedAt).toLocaleString("zh-CN", { hour12: false })}
          {data.heartbeat.terminalAt ? "（目标闭合）" : ""}
        </p>
      )}
      {data.heartbeat.lastMode && (
        <p className="text-[10px] text-[var(--kp-text-3)]" data-testid="swarm-heartbeat-decision">
          决策 {toPascalCaseId(data.heartbeat.lastMode)}
          {data.heartbeat.skipRemaining != null && data.heartbeat.skipRemaining > 0
            ? ` · 退避剩余 ${data.heartbeat.skipRemaining}`
            : ""}
          {data.heartbeat.quietStreak != null && data.heartbeat.quietStreak > 0
            ? ` · Quiet×${data.heartbeat.quietStreak}`
            : ""}
        </p>
      )}
      {data.inbox.preview.length > 0 && (
        <ul className="max-h-24 space-y-1 overflow-y-auto text-[10px] text-[var(--kp-text-2)]">
          {data.inbox.preview.slice(0, 3).map((m) => (
            <li key={m.id} className="truncate rounded bg-[var(--kp-bg-mute)] px-2 py-1" title={m.content}>
              <span className="text-[var(--kp-text-3)]">[{toPascalCaseId(m.messageType)}] </span>
              {m.content}
            </li>
          ))}
        </ul>
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

function Metric(props: {
  label: string;
  hint: string;
  value: number;
  warn?: boolean;
  Icon: LucideIcon;
  compact?: boolean;
}) {
  const title = `${props.label}：${props.value}（${props.hint}）`;
  return (
    <div
      title={title}
      className={cn(
        "min-w-0 rounded-lg px-1.5 py-1.5",
        props.warn ? "bg-amber-100/80 dark:bg-amber-900/30" : "bg-[var(--kp-bg-mute)]",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <props.Icon
          className={cn(
            "h-3 w-3 shrink-0",
            props.warn ? "text-amber-800 dark:text-amber-200" : "text-[var(--kp-text-3)]",
          )}
          aria-hidden
        />
        <div
          className={cn(
            "text-sm font-semibold tabular-nums",
            props.warn && "text-amber-900 dark:text-amber-200",
          )}
        >
          {props.value}
        </div>
      </div>
      {!props.compact && (
        <div className="mt-0.5 truncate text-[9px] text-[var(--kp-text-3)]">{props.label}</div>
      )}
      {props.compact && (
        <div className="mt-0.5 truncate text-center text-[9px] leading-tight text-[var(--kp-text-3)]">
          {props.label}
        </div>
      )}
    </div>
  );
}
