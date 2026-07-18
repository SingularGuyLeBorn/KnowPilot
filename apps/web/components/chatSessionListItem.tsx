"use client";

/**
 * Chat 会话列表项——从 chat.tsx 拆出。
 * 支持重命名（编辑态）与删除，纯展示型。
 */

import { memo } from "react";
import { Check, Columns2, Pencil, Trash2, X } from "lucide-react";
import type { ChatSession } from "@knowpilot/shared";
import { cn, formatRelativeTime } from "@/lib/utils";

export const SessionListItem = memo(function SessionListItem({
  session,
  active,
  isOpenTab,
  editing,
  renameDraft,
  onSelect,
  onOpenInOtherPane,
  onHover,
  onHoverEnd,
  onStartRename,
  onRenameDraftChange,
  onConfirmRename,
  onCancelRename,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  /** 已在标签栏打开（非焦点也标记） */
  isOpenTab?: boolean;
  editing: boolean;
  renameDraft: string;
  onSelect: (id: string) => void;
  onOpenInOtherPane?: (id: string) => void;
  onHover?: (id: string) => void;
  onHoverEnd?: (id: string) => void;
  onStartRename: (id: string) => void;
  onRenameDraftChange: (v: string) => void;
  onConfirmRename: (id: string) => void;
  onCancelRename: () => void;
  onDelete: (id: string) => void;
}) {
  if (editing) {
    return (
      <div className="mb-1 flex items-center gap-1 rounded-lg border border-[var(--kp-brand-light)] bg-[var(--kp-bg)] px-2 py-1.5">
        <input
          value={renameDraft}
          onChange={(e) => onRenameDraftChange(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-2 py-1 text-xs outline-none focus:border-[var(--kp-brand)]"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onConfirmRename(session.id); }
            if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
          }}
        />
        <button
          type="button"
          onClick={() => onConfirmRename(session.id)}
          className="rounded-md p-1 text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
          aria-label="确认重命名"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancelRename}
          className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
          aria-label="取消"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="session-list-item"
      className={cn(
        "group/sess mb-1 flex items-stretch overflow-hidden rounded-lg border transition-colors",
        active
          ? "border-[var(--kp-brand-light)] bg-[var(--kp-brand)]/10"
          : "border-transparent hover:border-[var(--kp-divider)] hover:bg-[var(--kp-bg-mute)]/50",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        onMouseEnter={() => onHover?.(session.id)}
        onMouseLeave={() => onHoverEnd?.(session.id)}
        className={cn(
          "min-w-0 flex-1 px-3 py-2 text-left text-sm transition",
          active ? "text-[var(--kp-brand-deep)]" : "text-[var(--kp-text-2)]",
        )}
      >
        <div className="truncate font-medium">
          {isOpenTab && !active && (
            <span
              className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--kp-brand)]/60"
              title="已在标签页打开"
              aria-hidden
            />
          )}
          {session.autoName || session.title || "新对话"}
          {session.kind === "heartbeat" && (
            <span className="ml-1.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-normal text-orange-700">
              心跳
            </span>
          )}
          {session.status === "archived" && (
            <span className="ml-1.5 rounded bg-[var(--kp-bg-mute)] px-1 py-0.5 text-[10px] font-normal text-[var(--kp-text-3)]">
              已归档
            </span>
          )}
        </div>
        <div className="truncate text-xs text-[var(--kp-text-3)]">
          {session.model} · {formatRelativeTime(session.updatedAt)}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--kp-divider-light)] px-1 opacity-70 transition-opacity group-hover/sess:opacity-100">
        {onOpenInOtherPane && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onOpenInOtherPane(session.id)}
            className="rounded-md p-1.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
            aria-label="在另一侧打开"
            title="在另一侧打开"
            data-testid="session-open-other-pane"
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onStartRename(session.id)}
          className="rounded-md p-1.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
          aria-label="重命名"
          title="重命名"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onDelete(session.id)}
          className="rounded-md p-1.5 text-[var(--kp-text-3)] hover:bg-red-50 hover:text-red-600"
          aria-label="删除"
          title="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
