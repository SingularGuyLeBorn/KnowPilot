"use client";

/**
 * Chat 发送队列 — 紧凑条 + 右侧展开 Panel（MetaBlog 风格）
 */

import { useCallback, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Trash2,
  X,
  Square,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatQueueItem } from "@/lib/chatQueueTypes";

interface MessageQueueProps {
  items: ChatQueueItem[];
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  onChange: (items: ChatQueueItem[]) => void;
  onRemove: (id: string) => void;
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  /** 右侧设置 Panel 打开时向左偏移，避免重叠 */
  settingsPanelOpen?: boolean;
  settingsPanelWidth?: number;
}

function kindLabel(item: ChatQueueItem): string {
  if (item.kind === "async-running") return "异步任务 · 执行中";
  if (item.kind === "async-result") return "异步结果";
  return "待发消息";
}

function previewText(item: ChatQueueItem): string {
  if (item.kind === "async-running") return item.taskLabel || item.text || "后台任务…";
  if (item.kind === "async-result") {
    return item.asyncResult?.slice(0, 120) || item.text || "（空结果）";
  }
  return item.text.slice(0, 120) || "（附件）";
}

function QueueCard({
  item,
  expanded,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onTogglePin,
  onCancel,
  onRetry,
}: {
  item: ChatQueueItem;
  expanded: boolean;
  onUpdate: (patch: Partial<ChatQueueItem>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onTogglePin: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const isAsyncResult = item.kind === "async-result";
  const isRunning = item.kind === "async-running";
  const canEditMain = item.kind === "user";
  const canEditAppend = isAsyncResult;

  return (
    <div
      className={cn(
        "rounded-xl border bg-[var(--kp-bg-alt)] transition-shadow",
        item.pinned ? "border-[var(--kp-brand)]/40 shadow-sm" : "border-[var(--kp-divider-light)]",
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
                  ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                  : isAsyncResult
                    ? "bg-amber-500/10 text-amber-700"
                    : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)]",
              )}
            >
              {kindLabel(item)}
            </span>
            {isRunning && <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-brand)]" />}
            {item.pinned && (
              <span className="text-[10px] text-[var(--kp-brand-dark)]">已置顶</span>
            )}
          </div>

          {!expanded ? (
            <p className="line-clamp-2 text-xs text-[var(--kp-text-2)]">{previewText(item)}</p>
          ) : (
            <>
              {isAsyncResult && item.asyncResult && (
                <div>
                  <p className="mb-1 text-[10px] font-medium text-[var(--kp-text-3)]">
                    系统结果（不可修改）
                  </p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] p-2 text-xs text-[var(--kp-text-2)]">
                    {item.asyncResult}
                  </pre>
                </div>
              )}

              {canEditAppend && (
                <div>
                  <p className="mb-1 text-[10px] font-medium text-[var(--kp-text-3)]">
                    你的补充说明（LLM 会区分）
                  </p>
                  <textarea
                    value={item.userAppend ?? ""}
                    onChange={(e) => onUpdate({ userAppend: e.target.value })}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2 py-1.5 text-xs outline-none focus:border-[var(--kp-brand)]"
                    placeholder="可选：对异步结果追加说明…"
                  />
                </div>
              )}

              {(canEditMain || (isAsyncResult && item.text)) && (
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
              <button type="button" onClick={onTogglePin} className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]" title={item.pinned ? "取消置顶" : "置顶"}>
                {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={onMoveUp} className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]" title="上移">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={onMoveDown} className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]" title="下移">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded p-1 text-amber-600 hover:bg-amber-50"
              title="取消任务"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button type="button" onClick={onRemove} className="rounded p-1 text-red-500 hover:bg-red-50" title="移除">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {item.kind === "async-result" && item.status === "failed" && onRetry && item.jobId && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded p-1 text-[var(--kp-brand-dark)] hover:bg-[var(--kp-brand-soft)]"
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

export function MessageQueue({
  items,
  panelOpen,
  onPanelOpenChange,
  onChange,
  onRemove,
  onCancel,
  onRetry,
  settingsPanelOpen = false,
  settingsPanelWidth = 360,
}: MessageQueueProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [barExpanded, setBarExpanded] = useState(false);

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

  if (items.length === 0) return null;

  return (
    <>
      {/* 紧凑条 — 点击列表区域展开/收起高度 */}
      <div className="relative mx-auto mb-2 max-w-3xl" data-testid="chat-queue-bar">
        <div className="flex items-stretch overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/95 shadow-sm backdrop-blur-sm">
          <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <button
                type="button"
                onClick={() => setBarExpanded((v) => !v)}
                className="min-w-0 flex-1 text-left"
                title={barExpanded ? "收起队列高度" : "展开队列高度"}
                aria-expanded={barExpanded}
              >
                <span className="text-[11px] font-semibold text-[var(--kp-text-2)]">
                  发送队列 · {items.length}
                </span>
                <span className="ml-2 text-[10px] text-[var(--kp-text-3)]">
                  {barExpanded ? "点击收起" : "点击展开"}
                </span>
              </button>
              <button
                type="button"
                data-testid="chat-queue-toggle"
                onClick={() => onPanelOpenChange(!panelOpen)}
                className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-brand-dark)]"
                title={panelOpen ? "收起面板" : "展开队列面板"}
              >
                {panelOpen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setBarExpanded((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setBarExpanded((v) => !v);
                }
              }}
              className={cn(
                "cursor-pointer space-y-1 overflow-y-auto px-0.5 transition-[max-height] duration-200",
                barExpanded ? "max-h-[min(40vh,280px)]" : "max-h-[72px]",
              )}
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg bg-[var(--kp-bg-mute)]/60 px-2 py-1"
                >
                  {item.kind === "async-running" ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--kp-brand)]" />
                  ) : (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kp-brand)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--kp-text-2)]">
                    {previewText(item)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 右侧 Panel */}
      {panelOpen && (
        <aside
          data-testid="chat-queue-panel"
          style={{ right: settingsPanelOpen ? settingsPanelWidth : 0 }}
          className="fixed inset-y-0 z-30 flex w-full max-w-md flex-col border-l border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/98 shadow-2xl backdrop-blur-md md:top-[var(--kp-header-offset,0px)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">发送队列</h2>
              <p className="text-[11px] text-[var(--kp-text-3)]">拖动/箭头调序 · 异步结果仅可追加说明</p>
            </div>
            <button
              type="button"
              onClick={() => onPanelOpenChange(false)}
              className="rounded-lg p-1.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
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
                  onCancel={item.kind === "async-running" && item.jobId && onCancel ? () => onCancel(item.jobId!) : undefined}
                  onRetry={item.kind === "async-result" && item.jobId && onRetry ? () => onRetry(item.jobId!) : undefined}
                />
              </div>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
