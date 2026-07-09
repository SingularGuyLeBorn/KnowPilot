"use client";

/**
 * Subagent 面板 — 左侧栏显示当前会话的子代理任务卡片（Kimi Code 风格）
 * 卡片可展开：查看详情（跳转子会话）/ 停止 / 删除
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, ChevronRight, Plus, Square, Trash2, ExternalLink, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared";

interface SubagentBrief {
  id: string;
  title: string;
  status: string;
  taskDescription?: string | null;
  model?: string | null;
  updatedAt: string | Date;
  createdAt?: string | Date;
}

/** 真实已运行时长文本（替代此前的假进度条估算） */
function formatElapsed(createdAt?: string | Date | null): string | null {
  if (!createdAt) return null;
  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start)) return null;
  const elapsed = Math.max(0, Date.now() - start);
  const totalSec = Math.floor(elapsed / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
  }
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

const STATUS_COLOR: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  queued: "bg-amber-500 animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
  paused: "bg-gray-400",
  active: "bg-green-500",
};

const STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  queued: "排队中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  active: "活跃",
};

function SubagentCard({ sub, onRefresh, onOpenSubagent }: { sub: SubagentBrief; onRefresh: () => void; onOpenSubagent?: (sessionId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stopMut = trpc.session.stop.useMutation({ onSuccess: onRefresh });
  const deleteMut = trpc.session.delete.useMutation({ onSuccess: onRefresh });
  const rerunMut = trpc.session.rerun.useMutation({ onSuccess: onRefresh });
  const utils = trpc.useUtils();

  const statusColor = STATUS_COLOR[sub.status] ?? "bg-gray-400";
  const isRunning = sub.status === "running" || sub.status === "queued";

  return (
    <div
      data-testid="subagent-card"
      className="rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-2 text-xs shadow-sm transition-colors hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        aria-label={`子代理 ${sub.title}`}
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor)} title={STATUS_LABEL[sub.status] ?? sub.status} />
        <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--kp-text-1)]">{sub.title}</span>
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
              <div className="flex items-center gap-2 text-[10px] text-[var(--kp-text-3)]">
                <span className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5">{STATUS_LABEL[sub.status] ?? sub.status}</span>
                {sub.model && <span className="truncate">{sub.model}</span>}
              </div>
              {isRunning && (() => {
                const elapsed = formatElapsed(sub.createdAt);
                return elapsed ? (
                  <div data-testid="subagent-progress" className="flex items-center gap-1.5 text-[10px] tabular-nums text-[var(--kp-text-3)]">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--kp-brand)]" />
                    已运行 {elapsed}
                  </div>
                ) : null;
              })()}
              {sub.taskDescription && (
                <p className="line-clamp-3 text-[11px] leading-relaxed text-[var(--kp-text-3)]">{sub.taskDescription}</p>
              )}
              <div className="flex flex-wrap gap-1">
                <Link
                  href={`/chat?sessionId=${sub.id}`}
                  onClick={(e) => {
                    if (onOpenSubagent) {
                      e.preventDefault();
                      onOpenSubagent(sub.id);
                    }
                  }}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                >
                  <ExternalLink className="h-3 w-3" /> 查看详情
                </Link>
                {isRunning && (
                  <button
                    type="button"
                    onClick={() => stopMut.mutate({ id: sub.id })}
                    disabled={stopMut.isPending}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                  >
                    <Square className="h-3 w-3" /> 停止
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => rerunMut.mutate({ id: sub.id })}
                  disabled={rerunMut.isPending}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-6 gap-1 px-2 text-[10px]")}
                >
                  <RotateCcw className="h-3 w-3" /> 重跑
                </button>
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
        title="删除子代理"
        description={`确定删除「${sub.title}」？删除后无法恢复。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => {
          deleteMut.mutate({ id: sub.id });
          void utils.session.list.invalidate();
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function SubagentPanel({
  parentSessionId,
  onCreate,
  onOpenSubagent,
}: {
  parentSessionId?: string;
  onCreate?: () => void;
  onOpenSubagent?: (sessionId: string) => void;
}) {
  const utils = trpc.useUtils();
  // 连续轮询计数器：子代理持续 running/queued 时逐步拉长轮询间隔，降低后台压力
  const runningPollsRef = useRef(0);
  const query = trpc.session.listChildren.useQuery(
    { parentSessionId: parentSessionId ?? "", pageSize: 20 },
    {
      enabled: !!parentSessionId,
      // React Query 默认 refetchIntervalInBackground=false，标签页隐藏时轮询自动暂停。
      // 此处显式声明意图，并在前台可见时按指数退避拉长间隔（1500ms → 上限 5000ms）。
      refetchIntervalInBackground: false,
      refetchInterval: (q) => {
        const data = q.state.data as { items?: SubagentBrief[] } | undefined;
        const polled = data?.items ?? [];
        const hasRunning = polled.some((s) => s.status === "running" || s.status === "queued");
        if (!hasRunning) {
          runningPollsRef.current = 0;
          return false;
        }
        runningPollsRef.current += 1;
        // 1500, 2000, 2500, … 上限 5000
        return Math.min(1500 + runningPollsRef.current * 500, 5000);
      },
    },
  );

  const items = useMemo(() => (query.data?.items as SubagentBrief[] | undefined) ?? [], [query.data?.items]);
  const activeCount = useMemo(
    () => items.filter((s) => s.status === "running" || s.status === "queued").length,
    [items],
  );

  // UX #1：默认折叠，节省左栏空间；存在活跃任务（running/queued）时自动展开。
  // 用户手动折叠后不再被自动展开打扰（userToggledRef 记忆手动操作）。
  const [expanded, setExpanded] = useState(false);
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (activeCount > 0 && !userToggledRef.current) {
      setExpanded(true);
    }
  }, [activeCount]);

  // 切换会话时重置手动折叠记忆
  useEffect(() => {
    userToggledRef.current = false;
  }, [parentSessionId]);

  const refresh = () => {
    void query.refetch();
    void utils.session.list.invalidate();
  };

  if (!parentSessionId) return null;
  // 无任何子代理任务时只显示一行极简 header（不占空间）
  const hasItems = items.length > 0;

  return (
    <div className="w-64 shrink-0 border-b border-[var(--kp-divider)]" data-testid="subagent-panel">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => {
            userToggledRef.current = true;
            setExpanded((v) => !v);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-[var(--kp-bg-mute)]"
          aria-expanded={expanded}
          aria-label={expanded ? "折叠子代理任务" : "展开子代理任务"}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200",
              expanded && "rotate-90",
            )}
          />
          <span className="text-xs font-medium text-[var(--kp-text-2)]">子代理任务</span>
          {activeCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand-soft)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--kp-brand-dark)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--kp-brand)]" />
              {activeCount} 运行中
            </span>
          ) : hasItems ? (
            <span className="rounded-full bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[9px] tabular-nums text-[var(--kp-text-3)]">
              {items.length}
            </span>
          ) : null}
        </button>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-6 w-6 shrink-0")}
            aria-label="新建子代理"
            title="新建子代理"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="max-h-[280px] space-y-2 overflow-y-auto px-2 pb-2 pr-2.5">
          {!hasItems ? (
            <p className="px-1 py-2 text-center text-[10px] text-[var(--kp-text-3)]">暂无子代理任务</p>
          ) : (
            <AnimatePresence initial={false}>
              {items.map((s) => (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: "spring", stiffness: 300, damping: 26 }}
                >
                  <SubagentCard sub={s} onRefresh={refresh} onOpenSubagent={onOpenSubagent} />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}
    </div>
  );
}
