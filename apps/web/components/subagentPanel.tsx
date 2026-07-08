"use client";

/**
 * Subagent 面板 — 左侧栏显示当前会话的子代理任务卡片（Kimi Code 风格）
 * 卡片可展开：查看详情（跳转子会话）/ 停止 / 删除
 */

import { useState } from "react";
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

function SubagentCard({ sub, onRefresh }: { sub: SubagentBrief; onRefresh: () => void }) {
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
}: {
  parentSessionId?: string;
  onCreate?: () => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.session.listChildren.useQuery(
    { parentSessionId: parentSessionId ?? "", pageSize: 20 },
    {
      enabled: !!parentSessionId,
      refetchInterval: (q) => {
        const data = q.state.data as { items?: SubagentBrief[] } | undefined;
        const items = data?.items ?? [];
        return items.some((s) => s.status === "running" || s.status === "queued") ? 3000 : false;
      },
    },
  );

  const items = (query.data?.items as SubagentBrief[] | undefined) ?? [];
  const refresh = () => {
    void query.refetch();
    void utils.session.list.invalidate();
  };

  if (!parentSessionId) return null;

  return (
    <div className="w-64 shrink-0 border-b border-[var(--kp-divider)] p-2" data-testid="subagent-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--kp-text-2)]">子代理任务</span>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-6 w-6")}
            aria-label="新建子代理"
            title="新建子代理"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="max-h-[320px] space-y-2 overflow-y-auto pr-0.5">
        {items.length === 0 ? (
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
                <SubagentCard sub={s} onRefresh={refresh} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
