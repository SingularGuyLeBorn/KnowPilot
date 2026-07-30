"use client";

/**
 * Chat 消息辅助组件——从 chat.tsx 拆出。
 * 包含消息来源角标、版本切换、消息操作按钮（复制/编辑/重试/分享等）。
 */

import { memo } from "react";
import {
  AlarmClock,
  BookPlus,
  Bookmark,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SOURCE_LABEL_STYLES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  super: { label: "子 Agent 任务", bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200" },
  manager: { label: "管理 Agent", bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  sub: { label: "子 Agent 发送", bg: "bg-green-100", text: "text-green-700", border: "border-green-200" },
  system: { label: "心跳触发", bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  cron: { label: "定时节律", bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-200" },
  childNotify: { label: "来自子 Agent", bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200" },
};

/** 占位默认名「子 Agent xxxx」（时间戳/id 片段）→ 展示时去掉后缀，避免角标像 uuid */
const PLACEHOLDER_SUBAGENT_NAME = /^子\s*Agent\s+[a-z0-9]+$/i;

export function formatSubagentDisplayName(name?: string | null): string | undefined {
  const t = name?.trim();
  if (!t) return undefined;
  if (PLACEHOLDER_SUBAGENT_NAME.test(t)) return "子 Agent";
  return t;
}

export function asyncResultLabel(sourceType?: string, taskLabel?: string, subagentName?: string): string {
  if (sourceType === "sleep" || /^sleep\b/i.test(taskLabel ?? "")) return "async sleep";
  if (sourceType === "subagent") {
    const display = formatSubagentDisplayName(subagentName);
    return display ? `async · ${display}` : "async subagent";
  }
  if (sourceType === "async_task_tool") return "async tool";
  const labelDisplay = formatSubagentDisplayName(taskLabel) ?? taskLabel?.trim();
  if (labelDisplay) return `async · ${labelDisplay.slice(0, 24)}`;
  return "async task";
}

export const MessageSourceLabel = memo(function MessageSourceLabel({
  source,
  isSubagentSession,
  align = "left",
  subagentName,
  asyncKind,
  taskLabel,
  childNotify,
  cronName,
}: {
  source?: string;
  isSubagentSession?: boolean;
  align?: "left" | "right";
  subagentName?: string;
  /** 异步投递角标：sleep / async_task_llm / ... */
  asyncKind?: string;
  taskLabel?: string;
  /** 子 Agent 主动通知（agent_notify_parent）元信息 */
  childNotify?: { sourceName?: string; source?: string };
  /** Agent Cron 任务名（与用户消息区分） */
  cronName?: string;
}) {
  if (!source || source === "user") return null;
  if (source === "cron") {
    const label = cronName?.trim()
      ? `定时节律 · ${cronName.trim().slice(0, 28)}`
      : "定时节律";
    return (
      <span
        className={cn(
          "pointer-events-none absolute -top-2.5 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow-sm",
          align === "right" ? "right-3" : "left-3",
          "border-amber-200 bg-amber-100 text-amber-800",
        )}
      >
        <AlarmClock className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  if (childNotify) {
    const notifyName = formatSubagentDisplayName(childNotify.sourceName);
    const label = notifyName ? `来自子 Agent · ${notifyName}` : "来自子 Agent";
    return (
      <span
        className={cn(
          "pointer-events-none absolute -top-2.5 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow-sm",
          align === "right" ? "right-3" : "left-3",
          "border-emerald-200 bg-emerald-100 text-emerald-700",
        )}
      >
        <Bot className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  if (asyncKind || (source === "sub" && taskLabel)) {
    const label = asyncResultLabel(asyncKind, taskLabel, subagentName);
    return (
      <span
        className={cn(
          "pointer-events-none absolute -top-2.5 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow-sm",
          align === "right" ? "right-3" : "left-3",
          "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
        )}
      >
        <Bot className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  const base = SOURCE_LABEL_STYLES[source] ?? { label: source, bg: "bg-gray-100", text: "text-gray-600", border: "border-gray-200" };
  const isParent = (source === "super" || source === "manager") && isSubagentSession;
  const displaySubName = formatSubagentDisplayName(subagentName);
  const label = isParent ? "父 Agent" : displaySubName && source === "sub" ? `${base.label} · ${displaySubName}` : base.label;
  // 父 Agent 角标用浅底深字，与统一白色气泡搭配
  const bg = isParent ? "bg-[var(--kp-brand-soft)]" : base.bg;
  const text = isParent ? "text-[var(--kp-brand-deep)]" : base.text;
  const border = isParent ? "border-[var(--kp-brand-light)]" : base.border;
  return (
    <span
      className={cn(
        "pointer-events-none absolute -top-2.5 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold shadow-sm",
        align === "right" ? "right-3" : "left-3",
        bg,
        text,
        border,
      )}
    >
      <Bot className="h-3.5 w-3.5" />
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

/** AI Studio 式 Markdown 源码编辑器（确认保存，不重跑） */
export function MessageMarkdownSourceEditor({
  value,
  onChange,
  onSave,
  onCancel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="message-markdown-source-editor">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
          Markdown
        </span>
        <span className="text-[10px] text-[var(--kp-text-3)]">Ctrl/⌘+Enter 保存 · Esc 取消</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(3, Math.min(24, value.split("\n").length + 1))}
        disabled={disabled}
        autoFocus
        spellCheck={false}
        className={cn(
          "block w-full resize-y rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)]",
          "px-3 py-2 font-mono text-[13px] leading-relaxed text-[var(--kp-text-1)] outline-none",
          "focus:border-[var(--kp-accent)] focus:ring-2 focus:ring-[var(--kp-accent-soft)]",
          "disabled:opacity-60",
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave();
          }
        }}
      />
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
  onSpeak,
  onSaveAsPost,
  onToggleBookmark,
  bookmarked = false,
  showEdit = true,
  showRetry = true,
  showRegenerate = false,
  showShare = true,
  showSpeak = true,
  showBookmark = false,
  showSaveAsPost = false,
  isEditing = false,
  isSpeaking = false,
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
  onSpeak?: () => void;
  onSaveAsPost?: () => void;
  onToggleBookmark?: () => void;
  bookmarked?: boolean;
  showEdit?: boolean;
  showRetry?: boolean;
  showRegenerate?: boolean;
  showShare?: boolean;
  showSpeak?: boolean;
  showBookmark?: boolean;
  showSaveAsPost?: boolean;
  isEditing?: boolean;
  isSpeaking?: boolean;
  disabled?: boolean;
  versionNav?: React.ReactNode;
  copied?: boolean;
}) {
  const btnClass =
    "rounded-lg p-1.5 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 transition-opacity duration-200",
        isEditing
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100",
      )}
    >
      {versionNav}
      {showBookmark && onToggleBookmark && (
        <button
          type="button"
          onClick={onToggleBookmark}
          disabled={disabled}
          className={cn(btnClass, bookmarked && "text-[var(--kp-brand)]")}
          title={bookmarked ? "去书签" : "加书签"}
          aria-label={bookmarked ? "去书签" : "加书签"}
          data-testid="message-bookmark-btn"
        >
          <Bookmark className={cn("h-3.5 w-3.5", bookmarked && "fill-current")} />
        </button>
      )}
      <button type="button" onClick={onCopy} disabled={disabled} className={btnClass} title="复制" aria-label="复制">
        <Copy className="h-3.5 w-3.5" />
      </button>
      {showSpeak && onSpeak && (
        <button
          type="button"
          onClick={onSpeak}
          disabled={disabled}
          className={cn(btnClass, isSpeaking && "text-[var(--kp-brand)]")}
          title={isSpeaking ? "停止朗读" : "朗读"}
          aria-label={isSpeaking ? "停止朗读" : "朗读"}
          data-testid="message-speak-btn"
        >
          <Volume2 className={cn("h-3.5 w-3.5", isSpeaking && "animate-pulse")} />
        </button>
      )}
      {showShare && onShare && (
        <button type="button" onClick={onShare} disabled={disabled} className={btnClass} title="分享" aria-label="分享">
          <Share2 className="h-3.5 w-3.5" />
        </button>
      )}
      {showSaveAsPost && onSaveAsPost && (
        <button
          type="button"
          onClick={onSaveAsPost}
          disabled={disabled}
          className={btnClass}
          title="写入知识库"
          aria-label="写入知识库"
          data-testid="message-save-as-post-btn"
        >
          <BookPlus className="h-3.5 w-3.5" />
        </button>
      )}
      {showRegenerate && onRegenerate && (
        <button type="button" onClick={onRegenerate} disabled={disabled} className={btnClass} title="重新生成" aria-label="重新生成">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      {isEditing && onEditSave && (
        <button
          type="button"
          onClick={onEditSave}
          disabled={disabled}
          className={btnClass}
          title="保存"
          aria-label="保存"
          data-testid="message-edit-save"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
      {isEditing && onEditCancel && (
        <button
          type="button"
          onClick={onEditCancel}
          disabled={disabled}
          className={btnClass}
          title="取消编辑"
          aria-label="取消"
          data-testid="message-edit-cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {!isEditing && showEdit && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className={btnClass}
          title="编辑 Markdown 源码"
          aria-label="编辑"
          data-testid="message-edit-btn"
        >
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
