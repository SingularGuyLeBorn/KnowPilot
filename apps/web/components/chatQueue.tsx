"use client";

/**
 * Chat 发送队列组件
 *
 * 不变量：
 * - 队列预览统一截断至 120 字符（previewText）。
 * - 右栏「状态」两级分组：异步队列可消费（钉住/待消费/已消费）/ 同步任务只展示。
 * - RuntimeStatusPanel 按 TP-3 执行×消费维度分组：进行中 / 待消费（含钉住子组）/ 已消费。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  GripVertical,
  Loader2,
  MessageSquare,
  Pin,
  PinOff,
  Trash2,
  Square,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatQueuedHint, type ChatQueueItem, type SyncTaskItem } from "@/lib/chatQueueTypes";

export function kindLabel(item: ChatQueueItem): string {
  if (item.kind === "async-running") {
    if (item.sourceType === "sleep" || /^sleep\b/i.test(item.taskLabel ?? "")) {
      return item.status === "queued" ? "async sleep · 排队" : "async sleep · 执行中";
    }
    if (item.status === "queued") return "异步任务 · 排队中";
    return "异步任务 · 执行中";
  }
  if (item.kind === "async-result") {
    if (item.sourceType === "sleep" || /^sleep\b/i.test(item.taskLabel ?? "")) return "async sleep";
    if (item.sourceType === "subagent") return "async subagent";
    if (item.sourceType === "async_task_tool") return "async tool";
    return "async task";
  }
  if (item.kind === "superior") return item.sourceName ? `上级 · ${item.sourceName}` : "上级 Agent";
  if (item.kind === "child_notify") return item.sourceName ? `来自子 Agent · ${item.sourceName}` : "来自子 Agent";
  return "待发消息";
}

/** 队列预览统一截断至 120 字符：超过部分不展示，保持卡片高度一致。 */
export function previewText(item: ChatQueueItem): string {
  if (item.kind === "async-running") {
    const hint = item.status === "queued" ? formatQueuedHint(item) : "";
    const suffix = item.status === "queued" && (hint || item.text) ? ` · ${hint || item.text}` : "";
    return (item.taskLabel || "后台任务…") + suffix;
  }
  if (item.kind === "async-result") {
    return item.asyncResult?.slice(0, 120) || item.text || "（空结果）";
  }
  return item.text.slice(0, 120) || "（附件）";
}

interface QueueCardProps {
  item: ChatQueueItem;
  expanded?: boolean;
  onUpdate?: (patch: Partial<ChatQueueItem>) => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onTogglePin?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function QueueCard({
  item,
  expanded = true,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onTogglePin,
  onCancel,
  onRetry,
}: QueueCardProps) {
  const isAsyncResult = item.kind === "async-result";
  const isRunning = item.kind === "async-running";
  const isChildNotify = item.kind === "child_notify";
  const canEditMain = item.kind === "user";
  const canEditAppend = isAsyncResult;

  return (
    <div
      className={cn(
        "rounded-xl border bg-[var(--kp-bg-alt)] transition-shadow",
        item.pinned ? "border-[var(--kp-brand)]/40 shadow-sm" : isChildNotify ? "border-emerald-300/60" : "border-[var(--kp-divider-light)]",
        isChildNotify && "border-l-4 border-l-emerald-400",
        expanded ? "p-3" : "px-3 py-2",
      )}
      data-testid={`chat-queue-item-${item.kind}`}
    >
      <div className="flex items-start gap-2">
        {!isRunning && (
          <span className="mt-1 cursor-grab text-[var(--kp-text-3)]" title="拖动排序（或使用箭头）">
            <GripVertical className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                isRunning
                  ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                  : isAsyncResult
                    ? "bg-amber-500/10 text-amber-700"
                    : isChildNotify
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)]",
              )}
            >
              {kindLabel(item)}
            </span>
            {isRunning && <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-brand)]" />}
            {item.pinned && <span className="text-[10px] text-[var(--kp-brand-deep)]">已置顶</span>}
            {(isRunning || isAsyncResult) && item.subagentSessionId && (
              <a
                href={`/chat?sessionId=${item.subagentSessionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                title="在新标签页中与子 Agent 对话"
              >
                <MessageSquare className="h-3 w-3" />
                与之对话
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {!expanded ? (
            <p className="line-clamp-2 text-xs text-[var(--kp-text-2)]">{previewText(item)}</p>
          ) : (
            <>
              {isAsyncResult && item.asyncResult && (
                <div>
                  <p className="mb-1 text-[10px] font-medium text-[var(--kp-text-3)]">系统结果（不可修改）</p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] p-2 text-xs text-[var(--kp-text-2)]">
                    {item.asyncResult}
                  </pre>
                </div>
              )}

              {canEditAppend && onUpdate && (
                <div>
                  <p className="mb-1 text-[10px] font-medium text-[var(--kp-text-3)]">你的补充说明（LLM 会区分）</p>
                  <textarea
                    value={item.userAppend ?? ""}
                    onChange={(e) => onUpdate({ userAppend: e.target.value })}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2 py-1.5 text-xs outline-none focus:border-[var(--kp-brand)]"
                    placeholder="可选：对异步结果追加说明…"
                  />
                </div>
              )}

              {/* superior / child_notify：只读正文（旧实现展开后既无 preview 也无 textarea，内容空白） */}
              {(item.kind === "superior" || item.kind === "child_notify") && (
                <p
                  className="whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] px-2 py-1.5 text-xs text-[var(--kp-text-1)]"
                  data-testid="chat-queue-item-body"
                >
                  {item.text.trim() || "（空消息）"}
                </p>
              )}

              {(canEditMain || (isAsyncResult && item.text)) && onUpdate && (
                <div>
                  <p className="mb-1 text-[10px] font-medium text-[var(--kp-text-3)]">
                    {canEditMain ? "消息内容" : "附加上下文"}
                  </p>
                  <textarea
                    value={item.text}
                    onChange={(e) => canEditMain && onUpdate({ text: e.target.value })}
                    readOnly={!canEditMain}
                    rows={expanded ? 3 : 2}
                    className={cn(
                      "w-full resize-none rounded-lg border px-2 py-1.5 text-xs outline-none",
                      canEditMain
                        ? "border-[var(--kp-divider)] bg-[var(--kp-bg)] focus:border-[var(--kp-brand)]"
                        : "border-transparent bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
                    )}
                  />
                </div>
              )}

              {item.attachments?.length ? (
                <div className="flex flex-wrap gap-1">
                  {item.attachments.map((a) => (
                    <span
                      key={a.id}
                      className="rounded bg-[var(--kp-bg-soft)] px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]"
                    >
                      📎 {a.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-0.5">
          {!isRunning && (
            <>
              {onTogglePin && (
                <button
                  type="button"
                  onClick={onTogglePin}
                  className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
                  title={item.pinned ? "取消置顶" : "置顶"}
                >
                  {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
              )}
              {onMoveUp && (
                <button
                  type="button"
                  onClick={onMoveUp}
                  className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
                  title="上移"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
              {onMoveDown && (
                <button
                  type="button"
                  onClick={onMoveDown}
                  className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
                  title="下移"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
          {isRunning && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded p-1 text-amber-600 hover:bg-amber-50"
              title="取消任务"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="rounded p-1 text-red-500 hover:bg-red-50"
                title="移除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )
          )}
          {item.kind === "async-result" && item.status === "failed" && onRetry && item.jobId && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded p-1 text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
              title="重试"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface InlineQueueListProps {
  items: ChatQueueItem[];
  onChange: (items: ChatQueueItem[]) => void;
  onRemove: (id: string) => void;
}

function InlineQueueList({ items, onChange, onRemove }: InlineQueueListProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const moveItem = (id: string, dir: -1 | 1) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    reorder(idx, idx + dir);
  };

  const updateItem = (id: string, patch: Partial<ChatQueueItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  return (
    <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
      {items.map((item, idx) => (
        <div
          key={item.id}
          draggable={item.kind !== "async-running"}
          onDragStart={() => setDragIdx(idx)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIdx !== null) reorder(dragIdx, idx);
            setDragIdx(null);
          }}
        >
          <QueueCard
            item={item}
            expanded
            onUpdate={(patch) => updateItem(item.id, patch)}
            onRemove={() => onRemove(item.id)}
            onMoveUp={() => moveItem(item.id, -1)}
            onMoveDown={() => moveItem(item.id, 1)}
            onTogglePin={() => updateItem(item.id, { pinned: !item.pinned })}
          />
        </div>
      ))}
    </div>
  );
}

interface UserSendQueuePanelProps {
  items: ChatQueueItem[];
  onChange: (items: ChatQueueItem[]) => void;
  onRemove: (id: string) => void;
  asyncStats?: { queued: number; runningGlobal: number };
}

export function UserSendQueuePanel({ items, onChange, onRemove, asyncStats }: UserSendQueuePanelProps) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="mb-2" data-testid="chat-queue-panel">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/95 px-3 py-2 text-left text-xs shadow-sm transition hover:bg-[var(--kp-bg-mute)]"
        >
          <MessageSquare className="h-4 w-4 text-[var(--kp-brand)]" />
          <span className="font-medium text-[var(--kp-text-2)]">
            待发消息 {items.length}
          </span>
          {asyncStats && asyncStats.runningGlobal > 0 && (
            <span className="text-[var(--kp-brand)]">· 运行 {asyncStats.runningGlobal}</span>
          )}
          {asyncStats && asyncStats.queued > 0 && (
            <span className="text-[var(--kp-text-3)]">· 排队 {asyncStats.queued}</span>
          )}
          <span className="ml-auto text-[var(--kp-text-3)]">点击展开</span>
          <ChevronDown className="h-4 w-4 text-[var(--kp-text-3)]" />
        </button>
      ) : (
        <div className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/95 p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--kp-text-2)]">
              待发消息 {items.length}
              {asyncStats && asyncStats.runningGlobal > 0 && (
                <span className="ml-1.5 text-[var(--kp-brand)]">· 运行 {asyncStats.runningGlobal}</span>
              )}
              {asyncStats && asyncStats.queued > 0 && (
                <span className="ml-1.5 text-[var(--kp-text-3)]">· 排队 {asyncStats.queued}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              title="收起"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          <InlineQueueList items={items} onChange={onChange} onRemove={onRemove} />
        </div>
      )}
    </div>
  );
}

interface QueuePanelListProps {
  items: ChatQueueItem[];
  onChange: (items: ChatQueueItem[]) => void;
  onRemove: (id: string) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  emptyText?: string;
}

export function QueuePanelList({ items, onChange, onRemove, onCancel, onRetry, emptyText }: QueuePanelListProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const paginatedItems = items.slice(start, start + pageSize);

  const reorder = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(next);
    },
    [items, onChange],
  );

  const moveItem = (id: string, dir: -1 | 1) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    reorder(idx, idx + dir);
  };

  const updateItem = (id: string, patch: Partial<ChatQueueItem>) => {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--kp-text-3)]">
        <MessageSquare className="h-6 w-6 opacity-40" />
        <p className="text-xs">{emptyText ?? "队列为空"}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {paginatedItems.map((item, localIdx) => {
          const globalIdx = start + localIdx;
          return (
            <div
              key={item.id}
              draggable={item.kind !== "async-running"}
              onDragStart={() => setDragIdx(globalIdx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null) reorder(dragIdx, globalIdx);
                setDragIdx(null);
              }}
            >
              <QueueCard
                item={item}
                expanded
                onUpdate={(patch) => updateItem(item.id, patch)}
                onRemove={() => onRemove(item.id)}
                onMoveUp={() => moveItem(item.id, -1)}
                onMoveDown={() => moveItem(item.id, 1)}
                onTogglePin={() => updateItem(item.id, { pinned: !item.pinned })}
                onCancel={item.kind === "async-running" && item.jobId && onCancel ? () => onCancel(item.jobId!) : undefined}
                onRetry={item.kind === "async-result" && item.jobId && onRetry ? () => onRetry(item.jobId!) : undefined}
              />
            </div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="border-t border-[var(--kp-divider)] px-3 py-2">
          <SimplePagination page={safePage} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

function SimplePagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-[var(--kp-text-2)]">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded px-2 py-1 hover:bg-[var(--kp-bg-mute)] disabled:opacity-40"
      >
        上一页
      </button>
      <span>
        {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="rounded px-2 py-1 hover:bg-[var(--kp-bg-mute)] disabled:opacity-40"
      >
        下一页
      </button>
    </div>
  );
}

const STATUS_SPRING = { type: "spring" as const, stiffness: 320, damping: 28 };

function statusKindLabel(item: ChatQueueItem): string {
  if (item.sourceType === "sleep" || /^sleep\b/i.test(item.taskLabel ?? "")) return "async sleep";
  if (item.sourceType === "subagent") return "async subagent";
  if (item.sourceType === "async_task_tool") return "async tool";
  return "async task";
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
  onTogglePin,
  fresh,
}: {
  item: ChatQueueItem;
  tone: "queued" | "running" | "ready" | "consumed" | "held";
  onCancel?: () => void;
  onTogglePin?: () => void;
  fresh?: boolean;
}) {
  const label = statusKindLabel(item);
  const title = item.taskLabel || previewText(item);
  const lastLog = item.logs?.length ? item.logs[item.logs.length - 1]?.message : "";
  const preview =
    tone === "consumed" || tone === "held" || tone === "ready"
      ? (item.asyncResult ?? item.text).slice(0, 220)
      : tone === "queued"
        ? formatQueuedHint(item) || item.text || lastLog
        : item.text || lastLog;
  const latestLog = item.logs?.length ? item.logs[item.logs.length - 1]?.message : undefined;
  const toneLabel =
    tone === "queued"
      ? "排队中"
      : tone === "running"
        ? "运行中"
        : tone === "ready"
          ? "待消费"
          : tone === "held"
            ? "钉住"
            : "已消费";

  return (
    <motion.div
      layout
      layoutId={item.jobId ? `runtime-job-${item.jobId}` : item.id}
      initial={fresh ? { opacity: 0, x: -28, scale: 0.96 } : false}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.98, transition: { duration: 0.18 } }}
      transition={STATUS_SPRING}
      className={cn(
        "group relative overflow-hidden rounded-xl border px-3 py-2.5 transition-colors",
        tone === "running" && "border-[var(--kp-brand)]/25 bg-[var(--kp-brand-soft)]/40",
        tone === "queued" && "border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)]",
        tone === "ready" && "border-amber-500/20 bg-[var(--kp-bg-alt)]",
        tone === "consumed" && "border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)]",
        tone === "held" && "border-amber-500/30 bg-amber-500/5",
        fresh && "ring-1 ring-[var(--kp-brand)]/40",
      )}
      data-testid={`runtime-status-${tone}`}
    >
      {tone === "running" && (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-[var(--kp-brand)]" />
      )}
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            tone === "running" && "text-[var(--kp-brand)]",
            tone === "queued" && "text-[var(--kp-text-3)]",
            tone === "ready" && "text-amber-600",
            tone === "consumed" && "text-emerald-600",
            tone === "held" && "text-amber-600",
          )}
        >
          {tone === "running" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : tone === "queued" ? (
            <Clock className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-[var(--kp-text-2)]">
              {label}
            </span>
            <span className="text-[11px] font-medium text-[var(--kp-text-3)]">{toneLabel}</span>
            {tone === "held" && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                未喂入
              </span>
            )}
            {item.status === "failed" && (
              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-600">失败</span>
            )}
          </div>
          <p className="truncate text-[13px] font-semibold text-[var(--kp-text-1)]" title={title}>
            {title}
          </p>
          {preview ? (
            <p className="line-clamp-4 text-xs leading-relaxed text-[var(--kp-text-2)]">{preview}</p>
          ) : null}
          {latestLog && tone === "running" && latestLog !== preview ? (
            <p className="line-clamp-2 text-[11px] text-[var(--kp-text-3)]">日志 · {latestLog}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--kp-text-3)]">
            {item.createdAt ? <span>已过 {formatElapsed(item.createdAt)}</span> : null}
            {item.jobId ? (
              <span className="text-[var(--kp-text-3)]" title={`任务 ${item.jobId}`}>
                任务
              </span>
            ) : null}
            {item.subagentName ? <span>{item.subagentName}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 opacity-70 transition group-hover:opacity-100">
          {item.subagentSessionId && (
            <a
              href={`/chat?sessionId=${item.subagentSessionId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-brand-deep)]"
              title="与之对话"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              title={item.pinned ? "取消置顶" : "置顶"}
            >
              {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded p-1 text-amber-600 hover:bg-amber-50"
              title="取消"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatusSection({
  title,
  count,
  children,
  emptyHint,
}: {
  title: string;
  count: number;
  children: ReactNode;
  emptyHint?: string;
}) {
  return (
    <section className="space-y-2">
      <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-[var(--kp-bg)]/90 px-0.5 py-1 backdrop-blur-sm">
        <h4 className="text-xs font-semibold tracking-wide text-[var(--kp-text-2)]">{title}</h4>
        <span className="tabular-nums text-xs text-[var(--kp-text-3)]">{count}</span>
      </div>
      {count === 0 ? (
        emptyHint ? <p className="px-0.5 pb-1 text-xs text-[var(--kp-text-3)]/70">{emptyHint}</p> : null
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

export interface RuntimeStatusPanelProps {
  /** 一级分组：异步队列 / 同步任务（W-A） */
  groupTab: "async" | "sync";
  onGroupTabChange: (tab: "async" | "sync") => void;
  /** 进行中：async-running（queued 排队 + running 执行） */
  activeItems: ChatQueueItem[];
  /** 待消费：终态（success/failed）且 delivered=false；pinned 为子组「钉住·未喂入」 */
  toConsumeItems: ChatQueueItem[];
  /** 已消费：delivered=true（success/failed badge） */
  consumedItems: ChatQueueItem[];
  /** 同步任务（deliverToQueue=false）：只展示，无 pin/消费/气泡发送 */
  syncTaskItems?: SyncTaskItem[];
  onCancel?: (jobId: string) => void;
  onTogglePin?: (jobId: string, pinned: boolean) => void;
}

/** 同步任务行（W-A 局部组件，不导出）：结果走 tool return 的任务只展示——无 pin、无消费、无气泡发送 */
function SyncTaskRow({
  item,
  onCancel,
}: {
  item: SyncTaskItem;
  onCancel?: (jobId: string) => void;
}) {
  const active = item.status === "queued" || item.status === "running";
  const [logsOpen, setLogsOpen] = useState(false);
  const statusLabel =
    item.status === "queued" ? "排队中" : item.status === "running" ? "运行中" : item.status === "completed" ? "已完成" : "失败";
  const preview = active
    ? undefined
    : (item.status === "failed" ? item.error : item.asyncResult)?.slice(0, 120);
  const elapsed = active && item.elapsedMs != null ? formatElapsedMs(item.elapsedMs) : formatElapsed(item.createdAt);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border px-3 py-2.5 transition-colors",
        item.status === "running" && "border-[var(--kp-brand)]/25 bg-[var(--kp-brand-soft)]/40",
        item.status === "queued" && "border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)]",
        item.status === "completed" && "border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)]",
        item.status === "failed" && "border-red-500/25 bg-red-500/5",
      )}
      data-testid="sync-task-card"
    >
      {item.status === "running" && (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-[var(--kp-brand)]" />
      )}
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            item.status === "running" && "text-[var(--kp-brand)]",
            item.status === "queued" && "text-[var(--kp-text-3)]",
            item.status === "completed" && "text-emerald-600",
            item.status === "failed" && "text-red-600",
          )}
        >
          {item.status === "running" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : item.status === "queued" ? (
            <Clock className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
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
                item.status === "failed" ? "text-red-600" : item.status === "completed" ? "text-emerald-600" : "text-[var(--kp-text-3)]",
              )}
            >
              {statusLabel}
            </span>
          </div>
          <p className="truncate text-[13px] font-semibold text-[var(--kp-text-1)]" title={item.taskLabel}>
            {item.taskLabel}
          </p>
          {preview ? <p className="line-clamp-4 text-xs leading-relaxed text-[var(--kp-text-2)]">{preview}</p> : null}
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--kp-text-3)]">
            <span>已过 {elapsed}</span>
            <span className="text-[var(--kp-text-3)]" title={`任务 ${item.jobId}`}>
              任务
            </span>
          </div>
        </div>
        {active && onCancel ? (
          <div className="flex shrink-0 flex-col gap-0.5 opacity-70 transition group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onCancel(item.jobId)}
              className="rounded p-1 text-amber-600 hover:bg-amber-50"
              title="取消任务"
              aria-label="取消任务"
              data-testid="runtime-cancel-job"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
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
  onCancel,
  onTogglePin,
}: RuntimeStatusPanelProps) {
  // 进行中：running 在前（执行体），queued 在后按池位置升序（position 缺失的排末尾，保持稳定 createdAt）
  const queued = useMemo(
    () =>
      activeItems
        .filter((i) => i.status === "queued")
        .sort((a, b) => (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER)),
    [activeItems],
  );
  const running = useMemo(
    () => activeItems.filter((i) => i.status !== "queued"),
    [activeItems],
  );
  // 待消费：pinned 为子组「钉住·未喂入」，主列表为未钉住的待喂入结果
  const toConsume = useMemo(() => toConsumeItems.filter((i) => !i.pinned), [toConsumeItems]);
  const held = useMemo(() => toConsumeItems.filter((i) => i.pinned), [toConsumeItems]);

  const seenConsumedRef = useRef<Set<string>>(new Set());
  const recentActiveRef = useRef<Set<string>>(new Set());
  const freshTimersRef = useRef<Set<number>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  // 跟踪近期出现在「进行中」的 job，用于判断是否从运行中滑入已消费
  useEffect(() => {
    for (const item of activeItems) {
      if (item.jobId) recentActiveRef.current.add(item.jobId);
    }
  }, [activeItems]);

  // 组件卸载时清除所有 fresh 高亮定时器，防止 setState on unmounted + 定时器泄漏
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

    // 仅当该任务曾出现在「进行中」（queued/running）时，才做滑入高亮
    const fromActive = newcomers.filter((id) => recentActiveRef.current.has(id));
    if (fromActive.length === 0) return;

    for (const id of fromActive) recentActiveRef.current.delete(id);
    setFreshIds((prev) => {
      const next = new Set(prev);
      for (const id of fromActive) next.add(id);
      return next;
    });
    // 每批 fromActive 独立定时器，不随 effect 重跑被清除，否则快速连续完成时首批高亮永不消失
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

  // 同步任务（W-A）：进行中 = queued/running；已结束 = completed/failed
  const syncActiveItems = useMemo(
    () => syncTaskItems.filter((t) => t.status === "queued" || t.status === "running"),
    [syncTaskItems],
  );
  const syncFinishedItems = useMemo(
    () => syncTaskItems.filter((t) => t.status !== "queued" && t.status !== "running"),
    [syncTaskItems],
  );

  // 进行中耗时每秒刷新（formatElapsed 依赖 Date.now，无 tick 则 UI 冻结）
  const hasActiveClock = activeCount > 0 || syncActiveItems.length > 0;
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!hasActiveClock) return;
    const timer = window.setInterval(() => setElapsedTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveClock]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-runtime-queue">
      {/* 一级分组：异步队列 / 同步任务 */}
      <div className="px-2.5 py-2">
        <div className="flex gap-1 rounded-xl bg-[var(--kp-bg-mute)] p-0.5">
          <button
            type="button"
            data-testid="runtime-group-async"
            onClick={() => onGroupTabChange("async")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition",
              groupTab === "async"
                ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
            )}
          >
            异步队列
            <span className="inline-flex min-w-[1.1rem] justify-center rounded-full bg-[var(--kp-brand-soft)] px-1.5 text-[10px] font-semibold text-[var(--kp-brand-deep)]">
              {activeCount + toConsumeCount}
            </span>
          </button>
          <button
            type="button"
            data-testid="runtime-group-sync"
            onClick={() => onGroupTabChange("sync")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition",
              groupTab === "sync"
                ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
            )}
          >
            同步任务
            {syncActiveItems.length > 0 && (
              <span className="inline-flex min-w-[1.1rem] justify-center rounded-full bg-[var(--kp-brand-soft)] px-1.5 text-[10px] font-semibold text-[var(--kp-brand-deep)]">
                {syncActiveItems.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {groupTab === "sync" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2" data-testid="sync-task-list">
          {syncTaskItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--kp-text-3)]">
              <Clock className="h-5 w-5 opacity-40" />
              <p className="text-xs">暂无同步任务</p>
            </div>
          ) : (
            <div className="space-y-3">
              <StatusSection title="进行中" count={syncActiveItems.length} emptyHint="无进行中任务">
                {syncActiveItems.map((item) => (
                  <SyncTaskRow key={item.jobId} item={item} onCancel={onCancel} />
                ))}
              </StatusSection>
              <StatusSection title="已结束" count={syncFinishedItems.length} emptyHint="无已结束任务">
                {syncFinishedItems.map((item) => (
                  <SyncTaskRow key={item.jobId} item={item} />
                ))}
              </StatusSection>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          <div className="space-y-3">
            {/* 进行中：跟踪 Task 的 queued/running（过程细节在子会话对话区，不在此展示全文） */}
            <StatusSection title="进行中" count={activeCount} emptyHint="无进行中的异步任务">
              <AnimatePresence initial={false}>
                {running.map((item) => (
                  <StatusRow
                    key={item.jobId ?? item.id}
                    item={item}
                    tone="running"
                    onCancel={item.jobId && onCancel ? () => onCancel(item.jobId!) : undefined}
                  />
                ))}
                {queued.map((item) => (
                  <StatusRow
                    key={item.jobId ?? item.id}
                    item={item}
                    tone="queued"
                    onCancel={item.jobId && onCancel ? () => onCancel(item.jobId!) : undefined}
                  />
                ))}
              </AnimatePresence>
            </StatusSection>

            {/* 待消费：仅终态未 delivered 的结果（非子 Agent 运行过程） */}
            <StatusSection title="待消费" count={toConsumeCount} emptyHint="无待喂入的终态结果">
              <AnimatePresence initial={false}>
                {toConsume.map((item) => (
                  <StatusRow
                    key={item.jobId ?? item.id}
                    item={item}
                    tone="ready"
                    onTogglePin={
                      item.jobId && onTogglePin
                        ? () => onTogglePin(item.jobId!, !item.pinned)
                        : undefined
                    }
                  />
                ))}
              </AnimatePresence>
              {held.length > 0 && (
                <div className="mt-2 space-y-2" data-testid="runtime-held-group">
                  <div className="flex items-center gap-1.5 px-0.5">
                    <Pin className="h-3 w-3 text-amber-600" />
                    <span className="text-[11px] font-medium text-amber-700">钉住·未喂入</span>
                    <span className="tabular-nums text-[11px] text-[var(--kp-text-3)]">{held.length}</span>
                  </div>
                  <AnimatePresence initial={false}>
                    {held.map((item) => (
                      <StatusRow
                        key={item.jobId ?? item.id}
                        item={item}
                        tone="held"
                        onTogglePin={
                          item.jobId && onTogglePin
                            ? () => onTogglePin(item.jobId!, !item.pinned)
                            : undefined
                        }
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </StatusSection>

            {/* 已消费：delivered=true（success/failed badge），fresh 滑入 */}
            <StatusSection title="已消费" count={consumedItems.length} emptyHint="尚无消费记录">
              <AnimatePresence initial={false}>
                {consumedItems.map((item) => {
                  const id = item.jobId ?? item.id;
                  return (
                    <StatusRow
                      key={id}
                      item={item}
                      tone="consumed"
                      fresh={freshIds.has(id)}
                    />
                  );
                })}
              </AnimatePresence>
            </StatusSection>
          </div>
        </div>
      )}
    </div>
  );
}
