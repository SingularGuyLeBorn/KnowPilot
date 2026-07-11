"use client";

/**
 * Chat 消息辅助组件——从 chat.tsx 拆出。
 * 包含消息来源角标、版本切换、消息操作按钮（复制/编辑/重试/分享等）。
 */

import { memo } from "react";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SOURCE_LABEL_STYLES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  super: { label: "子 Agent 任务", bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200" },
  manager: { label: "管理 Agent", bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  sub: { label: "子 Agent 发送", bg: "bg-green-100", text: "text-green-700", border: "border-green-200" },
  system: { label: "心跳触发", bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
};

export const MessageSourceLabel = memo(function MessageSourceLabel({
  source,
  isSubagentSession,
  align = "left",
  subagentName,
}: {
  source?: string;
  isSubagentSession?: boolean;
  align?: "left" | "right";
  subagentName?: string;
}) {
  if (!source || source === "user") return null;
  const base = SOURCE_LABEL_STYLES[source] ?? { label: source, bg: "bg-gray-100", text: "text-gray-600", border: "border-gray-200" };
  const isParent = (source === "super" || source === "manager") && isSubagentSession;
  const label = isParent ? "父 Agent" : subagentName && source === "sub" ? `${base.label} · ${subagentName}` : base.label;
  const bg = isParent ? "bg-[var(--kp-brand)]" : base.bg;
  const text = isParent ? "text-white" : base.text;
  const border = isParent ? "border-[var(--kp-brand-light)]" : base.border;
  return (
    <span
      className={cn(
        "pointer-events-none absolute -top-2 z-10 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-[1px] text-[9px] font-medium shadow-sm",
        align === "right" ? "right-3" : "left-3",
        bg,
        text,
        border,
      )}
    >
      <Bot className="h-2.5 w-2.5" />
      {label}
    </span>
  );
});

export function MessageVersions({
  current,
  total,
  onPrev,
  onNext,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-1 text-[11px] text-[var(--kp-text-3)]">
      <button type="button" onClick={onPrev} disabled={current <= 0} className="rounded-md p-1 hover:bg-[var(--kp-bg-mute)] disabled:opacity-30" aria-label="上一版本">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="tabular-nums">{current + 1}/{total}</span>
      <button type="button" onClick={onNext} disabled={current >= total - 1} className="rounded-md p-1 hover:bg-[var(--kp-bg-mute)] disabled:opacity-30" aria-label="下一版本">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function MessageActions({
  onCopy,
  onEdit,
  onEditSave,
  onEditCancel,
  onRetry,
  onRegenerate,
  onShare,
  showEdit = true,
  showRetry = true,
  showRegenerate = false,
  showShare = true,
  isEditing = false,
  disabled,
  versionNav,
  copied,
}: {
  onCopy: () => void;
  onEdit?: () => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
  onRetry?: () => void;
  onRegenerate?: () => void;
  onShare?: () => void;
  showEdit?: boolean;
  showRetry?: boolean;
  showRegenerate?: boolean;
  showShare?: boolean;
  isEditing?: boolean;
  disabled?: boolean;
  versionNav?: React.ReactNode;
  copied?: boolean;
}) {
  const btnClass =
    "rounded-lg p-1.5 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-200 group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto group-focus-within/msg:opacity-100 group-focus-within/msg:pointer-events-auto">
      {versionNav}
      <button type="button" onClick={onCopy} disabled={disabled} className={btnClass} title="复制" aria-label="复制">
        <Copy className="h-3.5 w-3.5" />
      </button>
      {showShare && onShare && (
        <button type="button" onClick={onShare} disabled={disabled} className={btnClass} title="分享" aria-label="分享">
          <Share2 className="h-3.5 w-3.5" />
        </button>
      )}
      {showRegenerate && onRegenerate && (
        <button type="button" onClick={onRegenerate} disabled={disabled} className={btnClass} title="重新生成" aria-label="重新生成">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      {isEditing && onEditSave && (
        <button type="button" onClick={onEditSave} disabled={disabled} className={btnClass} title="保存并重新生成" aria-label="保存">
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
      {isEditing && onEditCancel && (
        <button type="button" onClick={onEditCancel} disabled={disabled} className={btnClass} title="取消编辑" aria-label="取消">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {!isEditing && showEdit && onEdit && (
        <button type="button" onClick={onEdit} disabled={disabled} className={btnClass} title="编辑" aria-label="编辑">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {showRetry && onRetry && (
        <button type="button" onClick={onRetry} disabled={disabled} className={btnClass} title="重试" aria-label="重试">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
      {copied && <span className="ml-1 text-[10px] text-[var(--kp-text-3)]">已复制</span>}
    </div>
  );
}
