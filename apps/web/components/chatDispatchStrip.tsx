"use client";

/**
 * 派工可见性完整条：进行中 / 排队 / 待消费的子 Agent 与异步任务一眼可见。
 * 挂在中栏消息区上方；不新建第二套右栏面板。
 */

import {
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PauseCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ChatQueueItem,
  type SyncTaskItem,
  formatQueuedHint,
} from "@/lib/chatQueueTypes";
import { asyncResultLabel, formatSubagentDisplayName } from "@/components/chatMessageBits";
import { catchUnlessCancelled, trpc } from "@/lib/trpc";

type StripStatus = "pending" | "queued" | "running" | "done" | "failed";

function statusIcon(status?: StripStatus) {
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === "queued" || status === "pending")
    return <PauseCircle className="h-3.5 w-3.5 text-amber-500" />;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--kp-brand)]" />;
}

function statusText(item: ChatQueueItem): string {
  if (item.status === "queued") return formatQueuedHint(item) || "排队中";
  if (item.status === "failed") return "失败";
  if (item.status === "done") return "已完成·待消费";
  if (item.status === "running") return "运行中";
  return item.status || "进行中";
}

export function ChatDispatchStrip({
  activeItems,
  toConsumeItems,
  syncTasks,
  onSelectSession,
  onOpenRuntimePanel,
  onCancelJob,
  className,
}: {
  activeItems: ChatQueueItem[];
  toConsumeItems: ChatQueueItem[];
  syncTasks?: SyncTaskItem[];
  onSelectSession?: (sessionId: string) => void;
  onOpenRuntimePanel?: () => void;
  onCancelJob?: (jobId: string) => void;
  className?: string;
}) {
  const cancelMut = trpc.agent.cancelAsyncJob.useMutation();

  const syncRunning =
    syncTasks?.filter((t) => t.status === "running" || t.status === "queued") ?? [];

  const rows: Array<{
    key: string;
    kind: "async" | "sync" | "ready";
    title: string;
    subtitle: string;
    status?: StripStatus;
    jobId?: string;
    subSessionId?: string;
  }> = [];

  for (const item of activeItems) {
    const name =
      formatSubagentDisplayName(item.subagentName) ||
      item.taskLabel ||
      asyncResultLabel(item.sourceType, item.taskLabel, item.subagentName);
    rows.push({
      key: item.id,
      kind: "async",
      title: name,
      subtitle: statusText(item),
      status: item.status,
      jobId: item.jobId,
      subSessionId: item.subagentSessionId,
    });
  }

  for (const item of toConsumeItems.slice(0, 6)) {
    const name =
      formatSubagentDisplayName(item.subagentName) ||
      item.taskLabel ||
      "异步结果";
    rows.push({
      key: `ready-${item.id}`,
      kind: "ready",
      title: name,
      subtitle: item.status === "failed" ? "失败·待查看" : "待消费·结果已到",
      status: item.status === "failed" ? "failed" : "done",
      jobId: item.jobId,
      subSessionId: item.subagentSessionId,
    });
  }

  for (const t of syncRunning) {
    rows.push({
      key: `sync-${t.jobId}`,
      kind: "sync",
      title: t.taskLabel || "同步子任务",
      subtitle:
        t.status === "queued"
          ? "同步排队"
          : t.status === "failed"
            ? t.error || "同步失败"
            : "同步等待中（waitForResult）",
      status:
        t.status === "queued"
          ? "queued"
          : t.status === "failed"
            ? "failed"
            : "running",
      jobId: t.jobId,
      subSessionId: t.subagentSessionId,
    });
  }

  if (rows.length === 0) return null;

  const handleCancel = (jobId: string) => {
    if (onCancelJob) {
      onCancelJob(jobId);
      return;
    }
    cancelMut.mutateAsync({ jobId }).catch(catchUnlessCancelled("asyncJob.cancel"));
  };

  return (
    <div
      className={cn(
        "border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 px-3 py-2",
        className,
      )}
      data-testid="chat-dispatch-strip"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--kp-text-2)]">
          <Bot className="h-3.5 w-3.5 text-[var(--kp-brand)]" />
          派工进行中
          <span className="rounded-full bg-[var(--kp-brand-soft)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--kp-brand-deep)]">
            {rows.length}
          </span>
        </div>
        {onOpenRuntimePanel && (
          <button
            type="button"
            onClick={onOpenRuntimePanel}
            className="text-[10px] text-[var(--kp-text-3)] underline-offset-2 hover:text-[var(--kp-text-1)] hover:underline"
          >
            打开运行栏
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center gap-2 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5"
            data-testid="chat-dispatch-row"
            data-kind={row.kind}
          >
            {statusIcon(row.status)}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-[var(--kp-text-1)]">{row.title}</div>
              <div className="truncate text-[10px] text-[var(--kp-text-3)]">
                {row.kind === "sync" ? "同步 · " : row.kind === "ready" ? "待消费 · " : ""}
                {row.subtitle}
              </div>
            </div>
            {row.subSessionId && onSelectSession && (
              <button
                type="button"
                title="打开子会话"
                onClick={() => onSelectSession(row.subSessionId!)}
                className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            {row.jobId && (row.status === "running" || row.status === "queued") && (
              <button
                type="button"
                title="取消任务"
                disabled={cancelMut.isPending}
                onClick={() => handleCancel(row.jobId!)}
                className="rounded-md px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                取消
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
