"use client";

/**
 * 异步任务面板 — 左侧栏显示当前会话派生的异步任务（Task 实体）
 *
 * 按 sourceType 分组：LLM 异步任务 / 纯工具异步任务 / 子 Agent / 休眠任务。
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, ChevronRight, Clock, ExternalLink, MessageSquare, RotateCcw, Square, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared";

type AsyncTaskSourceType = "async_task_llm" | "async_task_tool" | "subagent" | "sleep" | string | undefined;

interface AsyncTaskBrief {
  id: string;
  name: string;
  status: string;
  input?: {
    subagentSessionId?: string;
    sourceType?: AsyncTaskSourceType;
    isSubagent?: boolean;
  } | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

const STATUS_COLOR: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  queued: "bg-amber-500 animate-pulse",
  pending: "bg-amber-500 animate-pulse",
  success: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-gray-400",
};

const STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  queued: "排队中",
  pending: "排队中",
  success: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const SOURCE_LABEL: Record<string, string> = {
  async_task_llm: "LLM 异步任务",
  async_task_tool: "工具异步任务",
  subagent: "子 Agent",
  sleep: "休眠任务",
};

const SOURCE_SHORT_LABEL: Record<string, string> = {
  async_task_llm: "LLM",
  async_task_tool: "Tool",
  subagent: "Sub",
  sleep: "Sleep",
};

function formatTime(date?: string | Date | null): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getSourceType(task: AsyncTaskBrief): string {
  return task.input?.sourceType || "async_task_llm";
}

function AsyncTaskCard({
  task,
  onRefresh,
  onCancelJob,
  onRetryJob,
}: {
  task: AsyncTaskBrief;
  onRefresh: () => void;
  onCancelJob?: (jobId: string) => void;
  onRetryJob?: (jobId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMut = trpc.task.delete.useMutation({ onSuccess: onRefresh });
  const utils = trpc.useUtils();

  const statusColor = STATUS_COLOR[task.status] ?? "bg-gray-400";
  const subagentSessionId = task.input?.subagentSessionId;
  const sourceType = getSourceType(task);
  const sourceLabel = SOURCE_LABEL[sourceType] ?? "异步任务";
  const sourceShort = SOURCE_SHORT_LABEL[sourceType] ?? sourceType;
  const isActive = task.status === "running" || task.status === "queued" || task.status === "pending";
  const canRetry = task.status === "failed" || task.status === "cancelled";

  return (
    <div
      data-testid="async-task-card"
      className="rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-2 text-xs shadow-sm transition-colors hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          aria-label={`异步任务 ${task.name}`}
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor)} title={STATUS_LABEL[task.status] ?? task.status} />
          <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
          <span className="min-w-0 flex-1 truncate font-medium text-[var(--kp-text-1)]">{task.name}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
              sourceType === "subagent"
                ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                : sourceType === "async_task_tool"
                  ? "bg-blue-500/10 text-blue-600"
                  : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
            )}
            title={sourceLabel}
          >
            {sourceShort}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--kp-text-3)]">{STATUS_LABEL[task.status] ?? task.status}</span>
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform", open && "rotate-90")} />
        </button>
        {isActive && onCancelJob && (
          <button
            type="button"
            onClick={() => onCancelJob(task.id)}
            className="shrink-0 rounded p-1 text-amber-600 hover:bg-amber-50"
            title="停止任务"
            aria-label="停止任务"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 border-t border-[var(--kp-divider-light)] pt-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--kp-text-3)]">
                <span className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5">{STATUS_LABEL[task.status] ?? task.status}</span>
                <span className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5">{sourceLabel}</span>
                {formatTime(task.createdAt) && (
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {formatTime(task.createdAt)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {subagentSessionId && (
                  <a
                    href={`/chat?sessionId=${subagentSessionId}&view=sub`}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <ExternalLink className="h-3 w-3" /> 查看详情
                  </a>
                )}
                {sourceType === "subagent" && subagentSessionId && (
                  <a
                    href={`/chat?sessionId=${subagentSessionId}&view=sub`}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <MessageSquare className="h-3 w-3" /> 与之对话
                  </a>
                )}
                {canRetry && onRetryJob && (
                  <button
                    type="button"
                    onClick={() => onRetryJob(task.id)}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <RotateCcw className="h-3 w-3" /> 重试
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px] text-red-500 hover:text-red-600")}
                >
                  <Trash2 className="h-3 w-3" /> 删除
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        isOpen={confirmDelete}
        title="删除异步任务"
        description={`确定删除「${task.name}」？删除后无法恢复。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => {
          deleteMut.mutate({ id: task.id });
          void utils.task.list.invalidate();
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function AsyncTaskPanel({
  parentSessionId,
  onCancelJob,
  onRetryJob,
}: {
  parentSessionId?: string;
  onCancelJob?: (jobId: string) => void;
  onRetryJob?: (jobId: string) => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.task.list.useQuery(
    { page: 1, pageSize: 50, sessionId: parentSessionId },
    { enabled: !!parentSessionId },
  );

  const items = useMemo(() => (query.data?.items as AsyncTaskBrief[] | undefined) ?? [], [query.data?.items]);
  const runningCount = useMemo(
    () => items.filter((t) => t.status === "running" || t.status === "queued" || t.status === "pending").length,
    [items],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, AsyncTaskBrief[]>();
    for (const task of items) {
      const key = getSourceType(task);
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    // 固定顺序
    const order = ["subagent", "async_task_llm", "async_task_tool", "sleep"];
    return order
      .filter((k) => map.has(k))
      .map((key) => ({ key, label: SOURCE_LABEL[key] ?? key, tasks: map.get(key)! }));
  }, [items]);

  const refresh = () => {
    void query.refetch();
    void utils.task.list.invalidate();
  };

  if (!parentSessionId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-[var(--kp-text-3)]">
        当前没有父会话，<br />无法查看异步任务。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--kp-text-2)]">
          异步任务 · {items.length}
          {runningCount > 0 && <span className="ml-1 text-[var(--kp-brand)]">· 运行 {runningCount}</span>}
        </span>
      </div>
      {items.length === 0 && !query.isLoading && (
        <div className="rounded-lg border border-dashed border-[var(--kp-divider)] p-4 text-center text-xs text-[var(--kp-text-3)]">
          暂无异步任务
        </div>
      )}
      {grouped.map((group) => (
        <div key={group.key} className="space-y-1.5">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">{group.label}</p>
          {group.tasks.map((task) => (
            <AsyncTaskCard
              key={task.id}
              task={task}
              onRefresh={refresh}
              onCancelJob={onCancelJob}
              onRetryJob={onRetryJob}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
