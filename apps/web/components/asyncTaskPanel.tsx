"use client";

/**
 * 异步任务面板 — 左侧栏显示当前会话派生的异步任务（Task 实体）
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, ChevronRight, Clock, ExternalLink, MessageSquare, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared";

interface AsyncTaskBrief {
  id: string;
  name: string;
  status: string;
  input?: { subagentSessionId?: string; isSubagent?: boolean } | null;
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

function formatTime(date?: string | Date | null): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AsyncTaskCard({ task, onRefresh }: { task: AsyncTaskBrief; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMut = trpc.task.delete.useMutation({ onSuccess: onRefresh });
  const utils = trpc.useUtils();

  const statusColor = STATUS_COLOR[task.status] ?? "bg-gray-400";
  const subagentSessionId = task.input?.subagentSessionId;
  const isSubagent = task.input?.isSubagent === true;

  return (
    <div
      data-testid="async-task-card"
      className="rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-2 text-xs shadow-sm transition-colors hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        aria-label={`异步任务 ${task.name}`}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor)} title={STATUS_LABEL[task.status] ?? task.status} />
        <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--kp-text-1)]">{task.name}</span>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform", open && "rotate-90")} />
      </button>
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
                    href={`/chat?sessionId=${subagentSessionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <ExternalLink className="h-3 w-3" /> 查看详情
                  </a>
                )}
                {isSubagent && subagentSessionId && (
                  <a
                    href={`/chat?sessionId=${subagentSessionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <MessageSquare className="h-3 w-3" /> 与之对话
                  </a>
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

export function AsyncTaskPanel({ parentSessionId }: { parentSessionId?: string }) {
  const utils = trpc.useUtils();
  const query = trpc.task.list.useQuery(
    { page: 1, pageSize: 50, sessionId: parentSessionId },
    { enabled: !!parentSessionId },
  );

  const items = useMemo(() => (query.data?.items as AsyncTaskBrief[] | undefined) ?? [], [query.data?.items]);
  const runningCount = useMemo(() => items.filter((t) => t.status === "running" || t.status === "queued" || t.status === "pending").length, [items]);

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
      {items.map((task) => (
        <AsyncTaskCard key={task.id} task={task} onRefresh={refresh} />
      ))}
    </div>
  );
}
