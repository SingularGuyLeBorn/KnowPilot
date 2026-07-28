"use client";

/**
 * Chat 发送队列组件
 *
 * 不变量：
 * - 队列预览统一截断至 120 字符（previewText）。
 * - 运行栏一级：异步队列 / 同步任务 / 旁路复盘。
 * - 异步队列二级子 Tab：进行中 / 待消费（含钉住子组）/ 已消费（TP-3）。
 */

import { useCallback, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GripVertical,
  Loader2,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Square,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatQueuedHint, type ChatQueueItem } from "@/lib/chatQueueTypes";

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
  /** Cursor 式：把待发消息拉进主输入框编辑 */
  isEditing?: boolean;
  onEdit?: () => void;
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
  isEditing = false,
  onEdit,
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
  /** 有 onEdit 时走主输入框（Cursor 式），卡片内不再内联改正文 */
  const editInComposer = canEditMain && !!onEdit;
  const canEditAppend = isAsyncResult;

  return (
    <div
      className={cn(
        "rounded-xl border bg-[var(--kp-bg-alt)] transition-shadow",
        item.pinned ? "border-[var(--kp-brand)]/40 shadow-sm" : isChildNotify ? "border-emerald-300/60" : "border-[var(--kp-divider-light)]",
        isEditing && "border-[var(--kp-brand)]/50 ring-1 ring-[var(--kp-brand)]/30",
        isChildNotify && "border-l-4 border-l-emerald-400",
        expanded ? "p-3" : "px-3 py-2",
      )}
      data-testid={`chat-queue-item-${item.kind}`}
      data-editing={isEditing ? "true" : undefined}
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
            {isEditing && (
              <span className="text-[10px] font-medium text-[var(--kp-text-3)]" data-testid="chat-queue-editing-badge">
                Editing
              </span>
            )}
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

              {editInComposer && (
                <p
                  className="whitespace-pre-wrap rounded-lg bg-[var(--kp-bg-mute)] px-2 py-1.5 text-xs text-[var(--kp-text-1)]"
                  data-testid="chat-queue-item-body"
                >
                  {item.text.trim() || "（空消息）"}
                </p>
              )}

              {!editInComposer && (canEditMain || (isAsyncResult && item.text)) && onUpdate && (
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
                      {a.type === "post" ? `文 ${a.title}` : `图 ${a.name}`}
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
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className={cn(
                    "rounded p-1 hover:bg-[var(--kp-bg-mute)]",
                    isEditing ? "text-[var(--kp-brand-deep)]" : "text-[var(--kp-text-3)]",
                  )}
                  title="在输入框中编辑"
                  data-testid="chat-queue-edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
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
  editingId?: string | null;
  onEdit?: (id: string) => void;
}

function InlineQueueList({ items, onChange, onRemove, editingId, onEdit }: InlineQueueListProps) {
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
            isEditing={editingId === item.id}
            onEdit={item.kind === "user" && onEdit ? () => onEdit(item.id) : undefined}
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
  editingId?: string | null;
  onEdit?: (id: string) => void;
  asyncStats?: { queued: number; runningGlobal: number };
}

export function UserSendQueuePanel({
  items,
  onChange,
  onRemove,
  editingId = null,
  onEdit,
  asyncStats,
}: UserSendQueuePanelProps) {
  const [userExpanded, setUserExpanded] = useState(false);
  // 编辑中强制展开，结束后回到用户自己的展开/收起偏好
  const expanded = userExpanded || !!editingId;
  if (items.length === 0) return null;
  // superior 队首由服务端 drain；前端不越过，需明示以免用户以为待发卡住
  const superiorHeadBlocks = items[0]?.kind === "superior";

  return (
    <div className="mb-2" data-testid="chat-queue-panel">
      {!expanded ? (
        <button
          type="button"
          onClick={() => setUserExpanded(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/95 px-3 py-2 text-left text-xs shadow-sm transition hover:bg-[var(--kp-bg-mute)]"
        >
          <MessageSquare className="h-4 w-4 text-[var(--kp-brand)]" />
          <span className="font-medium text-[var(--kp-text-2)]">
            待发消息 {items.length}
          </span>
          {superiorHeadBlocks && (
            <span className="text-[var(--kp-text-3)]">· 等待上级消息送达</span>
          )}
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
              onClick={() => setUserExpanded(false)}
              className="rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              title="收起"
              disabled={!!editingId}
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          {superiorHeadBlocks && (
            <p className="mb-2 text-[11px] leading-snug text-[var(--kp-text-3)]">
              队首为上级 Agent 消息，服务端送达后才会继续发送后续待发项。
            </p>
          )}
          <InlineQueueList
            items={items}
            onChange={onChange}
            onRemove={onRemove}
            editingId={editingId}
            onEdit={onEdit}
          />
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

