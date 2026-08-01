"use client";

/**
 * Chat 运行状态面板组件（从 chatQueue.tsx 拆出，P3-02 续拆）
 *
 * 含：StatusRow / SyncTaskRow / RuntimeStatusPanel + 辅助
 * 一级分组：异步任务 / 同步任务 / 旁路复盘。
 * 异步/同步均为扁平任务列表，状态打在卡片上（执行中 / 等待中 / 待投递 / 已投递 / 失败 / 已中断），不再分子 Tab。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  Layers,
  Loader2,
  MessageSquare,
  Pause,
  Pin,
  PinOff,
  Play,
  ScanSearch,
  Square,
  Timer,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatQueuedHint, type ChatQueueItem, type SyncTaskItem } from "@/lib/chatQueueTypes";
import { formatSubagentDisplayName } from "@/components/chatMessageBits";
import { requestLocateDelivery } from "@/lib/deliveryLocate";
import { humanizeDeliveryPreview, previewText } from "@/components/chatQueue";

const STATUS_SPRING = { type: "spring" as const, stiffness: 320, damping: 28 };
/** 左栏任务卡片每页条数——窄栏不宜一次铺太长 */
const RUNTIME_PAGE_SIZE = 8;

function RuntimeListPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--kp-divider-light)] px-2.5 py-1.5"
      data-testid="runtime-list-pager"
    >
      <span className="text-[10px] text-[var(--kp-text-3)]">
        {total} 条 · {page}/{totalPages}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-md p-1 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:opacity-30"
          aria-label="上一页"
          data-testid="runtime-list-pager-prev"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-md p-1 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:opacity-30"
          aria-label="下一页"
          data-testid="runtime-list-pager-next"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function slicePage<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function statusKindLabel(item: ChatQueueItem): string {
  if (item.sourceType === "sleep" || /^sleep\b/i.test(item.taskLabel ?? "")) return "AsyncSleep";
  if (item.sourceType === "subagent") {
    const name = formatSubagentDisplayName(item.subagentName);
    return name ? `Async · ${name}` : "AsyncSubagent";
  }
  if (item.sourceType === "async_task_tool") return "AsyncTool";
  return "AsyncTask";
}

function formatElapsedMs(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatElapsed(createdAt: number): string {
  return formatElapsedMs(Date.now() - createdAt);
}

function StatusRow({
  item,
  tone,
  onCancel,
  onResume,
  onTogglePin,
  fresh,
}: {
  item: ChatQueueItem;
  tone: "queued" | "running" | "ready" | "consumed" | "held";
  onCancel?: () => void;
  onResume?: () => void;
  onTogglePin?: () => void;
  fresh?: boolean;
}) {
  const label = statusKindLabel(item);
  const title = item.taskLabel || previewText(item);
  const lastLog = item.logs?.length ? item.logs[item.logs.length - 1]?.message : "";
  const isFailed = item.status === "failed";
  const isInterrupted = item.status === "interrupted";
  // 终态摘要：可读化，禁止裸 JSON 前缀
  const preview =
    tone === "consumed" || tone === "held" || tone === "ready"
      ? humanizeDeliveryPreview(item.asyncResult ?? item.text, 80)
      : tone === "queued"
        ? formatQueuedHint(item) || item.text || lastLog
        : item.text || lastLog;
  const latestLog = item.logs?.length ? item.logs[item.logs.length - 1]?.message : undefined;
  /**
   * 队列态 ≠ 执行成败：
   * - 「已投递」= 结果已进对话（delivered CLAIM），不是「成功」
   * - 失败/中断只显示成败，不再叠「已消费」造成绿勾+失败双标
   */
  const toneLabel =
    isInterrupted
      ? "已中断"
      : isFailed
        ? "失败"
        : tone === "queued"
          ? "等待中"
          : tone === "running"
            ? "执行中"
            : tone === "ready" || tone === "held"
              ? "待投递"
              : "已投递";
  const showElapsed = (tone === "queued" || tone === "running") && !!item.createdAt;
  const canLocate = (tone === "consumed" || tone === "ready") && !!item.jobId;
  const displaySubName = formatSubagentDisplayName(item.subagentName);
  const hasSideActions = !!(item.subagentSessionId || onTogglePin || onResume || onCancel || canLocate);

  const locateBubble = () => {
    if (!item.jobId) return;
    const ok = requestLocateDelivery(item.jobId);
    if (!ok) {
      console.warn(`[runtime] 未找到投递气泡 jobId=${item.jobId}`);
    }
  };

  return (
    <motion.div
      layout
      layoutId={item.jobId ? `runtime-job-${item.jobId}` : item.id}
      initial={fresh ? { opacity: 0, x: -28, scale: 0.96 } : false}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.98, transition: { duration: 0.18 } }}
      transition={STATUS_SPRING}
      role={canLocate ? "button" : undefined}
      tabIndex={canLocate ? 0 : undefined}
      onClick={canLocate ? locateBubble : undefined}
      onKeyDown={
        canLocate
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                locateBubble();
              }
            }
          : undefined
      }
      title={canLocate ? "点击跳转到对话中的投递气泡" : undefined}
      className={cn(
        "group relative overflow-hidden rounded-xl border px-2.5 py-2 transition-colors",
        canLocate && "cursor-pointer hover:border-[var(--kp-brand)]/40 hover:bg-[var(--kp-brand-soft)]/15",
        tone === "running" && "border-[var(--kp-brand)]/30 bg-[var(--kp-brand-soft)]/35",
        tone === "queued" && "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
        tone === "ready" && "border-amber-500/25 bg-amber-500/[0.04]",
        tone === "held" && "border-amber-500/35 bg-amber-500/[0.06]",
        tone === "consumed" &&
          !isFailed &&
          !isInterrupted &&
          "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
        tone === "consumed" && isFailed && "border-red-500/25 bg-red-500/[0.04]",
        tone === "consumed" && isInterrupted && "border-amber-500/25 bg-amber-500/[0.04]",
        fresh && "ring-1 ring-[var(--kp-brand)]/35",
      )}
      data-testid={`runtime-status-${tone}`}
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-0.5",
          tone === "running" && "bg-[var(--kp-brand)]",
          tone === "queued" && "bg-[var(--kp-text-3)]/35",
          (tone === "ready" || tone === "held") && "bg-amber-500",
          tone === "consumed" && !isFailed && !isInterrupted && "bg-emerald-500/70",
          isFailed && "bg-red-500",
          isInterrupted && "bg-amber-600",
        )}
      />
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
            tone === "running" && "text-[var(--kp-brand)]",
            tone === "queued" && "text-[var(--kp-text-3)]",
            (tone === "ready" || tone === "held") && "text-amber-700",
            tone === "consumed" && !isFailed && !isInterrupted && "text-emerald-600",
            isFailed && "text-red-600",
            isInterrupted && "text-amber-700",
          )}
        >
          {tone === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : tone === "queued" ? (
            <Clock className="h-3.5 w-3.5" />
          ) : isFailed ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : isInterrupted ? (
            <Pause className="h-3.5 w-3.5" />
          ) : tone === "ready" || tone === "held" ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
            <span className="shrink-0 rounded bg-[var(--kp-bg-mute)] px-1.5 py-px text-[10px] font-semibold text-[var(--kp-text-2)]">
              {label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-px text-[10px] font-semibold",
                isFailed && "bg-red-500/10 text-red-600",
                isInterrupted && "bg-amber-500/15 text-amber-800",
                !isFailed &&
                  !isInterrupted &&
                  tone === "consumed" &&
                  "bg-emerald-500/10 text-emerald-700",
                !isFailed &&
                  !isInterrupted &&
                  (tone === "ready" || tone === "held") &&
                  "bg-amber-500/15 text-amber-800",
                !isFailed &&
                  !isInterrupted &&
                  (tone === "running" || tone === "queued") &&
                  "text-[var(--kp-text-3)]",
              )}
            >
              {toneLabel}
            </span>
            {tone === "held" && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700">
                未喂入
              </span>
            )}
            {showElapsed ? (
              <span className="truncate text-[10px] text-[var(--kp-text-3)]">
                已过 {formatElapsed(item.createdAt)}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs font-semibold leading-snug text-[var(--kp-text-1)]" title={title}>
            {title}
          </p>
          {preview ? (
            <p className="truncate text-[11px] leading-snug text-[var(--kp-text-2)]">{preview}</p>
          ) : null}
          {latestLog && tone === "running" && latestLog !== preview ? (
            <p className="truncate text-[10px] text-[var(--kp-text-3)]">日志 · {latestLog}</p>
          ) : null}
          {displaySubName ? (
            <p className="truncate text-[10px] text-[var(--kp-text-3)]">{displaySubName}</p>
          ) : null}
        </div>
        {hasSideActions && (
          <div
            className="flex shrink-0 flex-col gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {canLocate && (
              <button
                type="button"
                onClick={locateBubble}
                className="rounded-md p-1 text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                title="跳转对话原文"
                aria-label="跳转对话原文"
                data-testid="runtime-locate-delivery"
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
            )}
            {item.subagentSessionId && (
              <a
                href={`/chat?sessionId=${item.subagentSessionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-brand-deep)]"
                title="与之对话"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {onTogglePin && (
              <button
                type="button"
                onClick={onTogglePin}
                className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
                title={item.pinned ? "取消置顶" : "置顶"}
              >
                {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
            )}
            {onResume && (
              <button
                type="button"
                onClick={onResume}
                className="rounded-md p-1 text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                title="恢复"
                data-testid="runtime-resume-job"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md p-1 text-amber-600 hover:bg-amber-50"
                title="中断"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export type RuntimeGroupTab = "async" | "sync" | "side";

export interface RuntimeStatusPanelProps {
  /** 一级分组：异步任务 / 同步任务 / 旁路复盘 */
  groupTab: RuntimeGroupTab;
  onGroupTabChange: (tab: RuntimeGroupTab) => void;
  /** 执行中 + 等待中（queued / running） */
  activeItems: ChatQueueItem[];
  /** 待消费：终态且未 delivered；含钉住 */
  toConsumeItems: ChatQueueItem[];
  /** 已消费：delivered=true */
  consumedItems: ChatQueueItem[];
  /** 同步任务（deliverToQueue=false）：只展示，无 pin/消费/气泡发送 */
  syncTaskItems?: SyncTaskItem[];
  /** 旁路复盘面板 */
  sidePanel?: ReactNode;
  onCancel?: (jobId: string) => void;
  onResume?: (jobId: string) => void;
  onTogglePin?: (jobId: string, pinned: boolean) => void;
}

/** 同步任务行（W-A 局部组件，不导出）：结果走 tool return 的任务只展示——无 pin、无消费、无气泡发送 */
function SyncTaskRow({
  item,
  onCancel,
  onResume,
}: {
  item: SyncTaskItem;
  onCancel?: (jobId: string) => void;
  onResume?: (jobId: string) => void;
}) {
  const active = item.status === "queued" || item.status === "running";
  const [logsOpen, setLogsOpen] = useState(false);
  const statusLabel =
    item.status === "queued"
      ? "等待中"
      : item.status === "running"
        ? "执行中"
        : item.status === "completed"
          ? "已完成"
          : item.status === "interrupted"
            ? "已中断"
            : "失败";
  const preview = active
    ? undefined
    : humanizeDeliveryPreview(
        item.status === "failed" || item.status === "interrupted"
          ? item.error
          : item.asyncResult,
        120,
      );
  const elapsed =
    active
      ? item.elapsedMs != null
        ? formatElapsedMs(item.elapsedMs)
        : formatElapsed(item.createdAt)
      : null;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border px-3 py-2.5 transition-colors",
        item.status === "running" && "border-[var(--kp-brand)]/30 bg-[var(--kp-brand-soft)]/35",
        item.status === "queued" && "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
        item.status === "completed" && "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
        item.status === "interrupted" && "border-amber-500/25 bg-amber-500/[0.04]",
        item.status === "failed" && "border-red-500/25 bg-red-500/[0.04]",
      )}
      data-testid="sync-task-card"
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-[3px]",
          item.status === "running" && "bg-[var(--kp-brand)]",
          item.status === "queued" && "bg-[var(--kp-text-3)]/35",
          item.status === "completed" && "bg-emerald-500/70",
          item.status === "interrupted" && "bg-amber-600",
          item.status === "failed" && "bg-red-500",
        )}
      />
      <div className="flex items-start gap-2.5 pl-0.5">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            item.status === "running" && "bg-[var(--kp-brand-soft)] text-[var(--kp-brand)]",
            item.status === "queued" && "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
            item.status === "completed" && "bg-emerald-500/12 text-emerald-600",
            item.status === "interrupted" && "bg-amber-500/15 text-amber-700",
            item.status === "failed" && "bg-red-500/12 text-red-600",
          )}
        >
          {item.status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : item.status === "queued" ? (
            <Clock className="h-3.5 w-3.5" />
          ) : item.status === "failed" ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : item.status === "interrupted" ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-[var(--kp-text-2)]">
              同步任务
            </span>
            <span
              className={cn(
                "text-[11px] font-medium",
                item.status === "failed"
                  ? "text-red-600"
                  : item.status === "interrupted"
                    ? "text-amber-700"
                    : item.status === "completed"
                      ? "text-emerald-600"
                      : "text-[var(--kp-text-3)]",
              )}
            >
              {statusLabel}
            </span>
          </div>
          <p className="truncate text-[13px] font-semibold text-[var(--kp-text-1)]" title={item.taskLabel}>
            {item.taskLabel}
          </p>
          {preview ? <p className="truncate text-[11px] leading-snug text-[var(--kp-text-2)]">{preview}</p> : null}
          {active && item.logs?.length ? (
            <div>
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                className="inline-flex items-center gap-0.5 text-[11px] text-[var(--kp-text-3)] transition hover:text-[var(--kp-text-2)]"
              >
                日志 {item.logs.length}
                {logsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {logsOpen && (
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] p-2 text-[11px] text-[var(--kp-text-2)]">
                  {item.logs.map((l) => l.message).join("\n")}
                </pre>
              )}
            </div>
          ) : null}
          {elapsed ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--kp-text-3)]">
              <span>已过 {elapsed}</span>
            </div>
          ) : null}
        </div>
        {(active && onCancel) || (item.status === "interrupted" && onResume) ? (
          <div className="flex shrink-0 flex-col gap-0.5 opacity-70 transition group-hover:opacity-100">
            {item.status === "interrupted" && onResume ? (
              <button
                type="button"
                onClick={() => onResume(item.jobId)}
                className="rounded p-1 text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                title="恢复任务"
                aria-label="恢复任务"
                data-testid="runtime-resume-job"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {active && onCancel ? (
              <button
                type="button"
                onClick={() => onCancel(item.jobId)}
                className="rounded p-1 text-amber-600 hover:bg-amber-50"
                title="中断任务"
                aria-label="中断任务"
                data-testid="runtime-cancel-job"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RuntimeStatusPanel({
  groupTab,
  onGroupTabChange,
  activeItems,
  toConsumeItems,
  consumedItems,
  syncTaskItems = [],
  sidePanel,
  onCancel,
  onResume,
  onTogglePin,
}: RuntimeStatusPanelProps) {
  // 执行中在前，等待中按池位置升序
  const queued = useMemo(
    () =>
      activeItems
        .filter((i) => i.status === "queued")
        .sort(
          (a, b) =>
            (a.queuePosition ?? Number.MAX_SAFE_INTEGER) -
            (b.queuePosition ?? Number.MAX_SAFE_INTEGER),
        ),
    [activeItems],
  );
  const running = useMemo(
    () => activeItems.filter((i) => i.status !== "queued"),
    [activeItems],
  );
  const toConsume = useMemo(() => toConsumeItems.filter((i) => !i.pinned), [toConsumeItems]);
  const held = useMemo(() => toConsumeItems.filter((i) => i.pinned), [toConsumeItems]);

  const seenConsumedRef = useRef<Set<string>>(new Set());
  const recentActiveRef = useRef<Set<string>>(new Set());
  const freshTimersRef = useRef<Set<number>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    for (const item of activeItems) {
      if (item.jobId) recentActiveRef.current.add(item.jobId);
    }
  }, [activeItems]);

  useEffect(() => {
    const timers = freshTimersRef.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const ids = consumedItems.map((i) => i.jobId ?? i.id);
    const newcomers = ids.filter((id) => !seenConsumedRef.current.has(id));
    for (const id of ids) seenConsumedRef.current.add(id);
    if (newcomers.length === 0) return;

    const fromActive = newcomers.filter((id) => recentActiveRef.current.has(id));
    if (fromActive.length === 0) return;

    for (const id of fromActive) recentActiveRef.current.delete(id);
    setFreshIds((prev) => {
      const next = new Set(prev);
      for (const id of fromActive) next.add(id);
      return next;
    });
    const timer = window.setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const id of fromActive) next.delete(id);
        return next;
      });
      freshTimersRef.current.delete(timer);
    }, 2200);
    freshTimersRef.current.add(timer);
  }, [consumedItems]);

  const activeCount = activeItems.length;
  const toConsumeCount = toConsumeItems.length;
  const asyncTotal = activeCount + toConsumeCount + consumedItems.length;

  const syncActiveCount = useMemo(
    () => syncTaskItems.filter((t) => t.status === "queued" || t.status === "running").length,
    [syncTaskItems],
  );
  const syncSorted = useMemo(() => {
    const rank = (s: SyncTaskItem["status"]) =>
      s === "running" ? 0 : s === "queued" ? 1 : s === "interrupted" ? 2 : s === "failed" ? 3 : 4;
    return [...syncTaskItems].sort((a, b) => rank(a.status) - rank(b.status));
  }, [syncTaskItems]);

  type AsyncFlatRow = {
    key: string;
    item: ChatQueueItem;
    tone: "queued" | "running" | "ready" | "consumed" | "held";
  };
  const asyncFlat = useMemo((): AsyncFlatRow[] => {
    const rows: AsyncFlatRow[] = [];
    for (const item of running) {
      rows.push({ key: item.jobId ?? item.id, item, tone: "running" });
    }
    for (const item of queued) {
      rows.push({ key: item.jobId ?? item.id, item, tone: "queued" });
    }
    for (const item of toConsume) {
      rows.push({ key: item.jobId ?? item.id, item, tone: "ready" });
    }
    for (const item of held) {
      rows.push({ key: item.jobId ?? item.id, item, tone: "held" });
    }
    for (const item of consumedItems) {
      rows.push({ key: item.jobId ?? item.id, item, tone: "consumed" });
    }
    return rows;
  }, [running, queued, toConsume, held, consumedItems]);

  const [asyncPage, setAsyncPage] = useState(1);
  const [syncPage, setSyncPage] = useState(1);
  // 列表变短时夹紧页码（派生，禁止 effect 里 setState）
  const asyncPageSafe = Math.min(
    asyncPage,
    Math.max(1, Math.ceil(asyncFlat.length / RUNTIME_PAGE_SIZE) || 1),
  );
  const syncPageSafe = Math.min(
    syncPage,
    Math.max(1, Math.ceil(syncSorted.length / RUNTIME_PAGE_SIZE) || 1),
  );

  const asyncPageRows = useMemo(
    () => slicePage(asyncFlat, asyncPageSafe, RUNTIME_PAGE_SIZE),
    [asyncFlat, asyncPageSafe],
  );
  const syncPageRows = useMemo(
    () => slicePage(syncSorted, syncPageSafe, RUNTIME_PAGE_SIZE),
    [syncSorted, syncPageSafe],
  );

  const switchGroupTab = (tab: RuntimeGroupTab) => {
    onGroupTabChange(tab);
    setAsyncPage(1);
    setSyncPage(1);
  };

  const hasActiveClock = activeCount > 0 || syncActiveCount > 0;
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!hasActiveClock) return;
    const timer = window.setInterval(() => setElapsedTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveClock]);

  const groupTabBtn = (
    tab: RuntimeGroupTab,
    label: string,
    testId: string,
    Icon: LucideIcon,
    badge?: number,
    showZeroBadge?: boolean,
  ) => (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      onClick={() => switchGroupTab(tab)}
      className={cn(
        "relative flex flex-1 items-center justify-center rounded-lg px-2 py-2 transition",
        groupTab === tab
          ? "bg-[var(--kp-bg)] text-[var(--kp-brand-deep)] shadow-sm"
          : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {badge != null && (showZeroBadge || badge > 0) && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.05rem] justify-center rounded-full bg-[var(--kp-brand-soft)] px-1 text-[9px] font-semibold leading-4 text-[var(--kp-brand-deep)]">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-runtime-queue">
      <div className="px-2.5 py-2">
        <div className="flex gap-1 rounded-xl bg-[var(--kp-bg-mute)] p-0.5">
          {groupTabBtn(
            "async",
            "异步任务",
            "runtime-group-async",
            Layers,
            activeCount + toConsumeCount,
            true,
          )}
          {groupTabBtn("sync", "同步任务", "runtime-group-sync", Timer, syncActiveCount)}
          {groupTabBtn("side", "旁路复盘", "runtime-group-side", ScanSearch)}
        </div>
      </div>

      {groupTab === "side" ? (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="runtime-side-panel">
          {sidePanel}
        </div>
      ) : groupTab === "sync" ? (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="sync-task-list">
          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
            {syncSorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--kp-text-3)]">
                <Clock className="h-5 w-5 opacity-40" />
                <p className="text-xs">暂无同步任务</p>
              </div>
            ) : (
              <div className="space-y-2">
                {syncPageRows.map((item) => (
                  <SyncTaskRow
                    key={item.jobId}
                    item={item}
                    onCancel={
                      item.status === "queued" || item.status === "running" ? onCancel : undefined
                    }
                    onResume={item.status === "interrupted" ? onResume : undefined}
                  />
                ))}
              </div>
            )}
          </div>
          <RuntimeListPager
            page={syncPageSafe}
            pageSize={RUNTIME_PAGE_SIZE}
            total={syncSorted.length}
            onPageChange={setSyncPage}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="runtime-async-panel">
          <div
            className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2"
            data-testid="runtime-async-task-list"
          >
            {asyncTotal === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--kp-text-3)]">
                <Clock className="h-5 w-5 opacity-40" />
                <p className="text-xs">暂无异步任务</p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {asyncPageRows.map(({ key, item, tone }) => (
                    <StatusRow
                      key={key}
                      item={item}
                      tone={tone}
                      fresh={tone === "consumed" ? freshIds.has(key) : undefined}
                      onCancel={
                        (tone === "running" || tone === "queued") && item.jobId && onCancel
                          ? () => onCancel(item.jobId!)
                          : undefined
                      }
                      onTogglePin={
                        (tone === "ready" || tone === "held") && item.jobId && onTogglePin
                          ? () => onTogglePin(item.jobId!, !item.pinned)
                          : undefined
                      }
                      onResume={
                        tone === "consumed" &&
                        item.status === "interrupted" &&
                        item.jobId &&
                        onResume
                          ? () => onResume(item.jobId!)
                          : undefined
                      }
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
          <RuntimeListPager
            page={asyncPageSafe}
            pageSize={RUNTIME_PAGE_SIZE}
            total={asyncFlat.length}
            onPageChange={setAsyncPage}
          />
        </div>
      )}
    </div>
  );
}
