"use client";

/**
 * Chat 消息辅助组件——从 chat.tsx 拆出。
 * 包含消息来源角标、版本切换、消息操作按钮（复制/编辑/重试/分享等）。
 */

import { memo, useState } from "react";
import {
  AlarmClock,
  BookPlus,
  Bookmark,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  FileText,
  Gauge,
  Globe,
  Info,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Terminal,
  Volume2,
  X,
  Zap, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PostContent } from "@/components/post/PostContent";
import { formatTokenCount } from "@/lib/tokenBudget";
import { formatToolDisplayName } from "@/lib/toolDisplayName";
import type { ChatMessage } from "@knowpilot/shared";

const SOURCE_LABEL_STYLES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  super: { label: "子 Agent 任务", bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200" },
  manager: { label: "管理 Agent", bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  sub: { label: "子 Agent 发送", bg: "bg-green-100", text: "text-green-700", border: "border-green-200" },
  // system = 熔断注入 / resume / 轮换摘要等；心跳会话另有 cron/kind 区分，勿一律标「心跳」
  system: { label: "系统", bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
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

export function asyncResultLabel(
  sourceType?: string,
  taskLabel?: string,
  subagentName?: string,
  toolName?: string,
): string {
  if (sourceType === "sleep" || /^sleep\b/i.test(taskLabel ?? "")) return "AsyncSleep";
  if (sourceType === "subagent") {
    const display = formatSubagentDisplayName(subagentName);
    return display ? `Async · ${display}` : "AsyncSubagent";
  }
  if (sourceType === "async_task_tool") {
    const tool = toolName?.trim() ? formatToolDisplayName(toolName) : "";
    return tool ? `AsyncTool · ${tool}` : "AsyncTool";
  }
  if (sourceType === "async_task_llm") return "AsyncTask";
  const labelDisplay = formatSubagentDisplayName(taskLabel) ?? taskLabel?.trim();
  if (labelDisplay) return `Async · ${labelDisplay.slice(0, 24)}`;
  return "AsyncTask";
}

/** 异步工具投递结构化卡片（与服务端 asyncToolDeliveryFormat.structured 对齐） */
export type AsyncDeliveryStructured = {
  tool?: string;
  kind?: "read_article" | "generic" | string;
  title?: string;
  author?: string;
  platform?: string;
  url?: string;
  content?: string;
  contentChars?: number;
  totalChars?: number;
  method?: string;
  elapsedMs?: number;
  truncated?: boolean;
  previewFields?: Array<{ key: string; value: string }>;
};

export interface AsyncToolResultCardProps {
  structured?: AsyncDeliveryStructured | null;
  /** 无 structured 时降级：Markdown 渲染投递正文（信封文本，不是裸 JSON） */
  fallbackMarkdown: string;
  toolName?: string;
  taskLabel?: string;
  subagentName?: string;
  sourceType?: string;
  jobId?: string;
  onSaveEditedContent?: (newContent: string) => void;
}

export const AsyncToolResultCard = memo(function AsyncToolResultCard({
  structured,
  fallbackMarkdown,
  toolName,
  taskLabel,
  subagentName,
  sourceType,
  jobId,
  onSaveEditedContent,
}: AsyncToolResultCardProps) {
  const initialContent = structured?.content || fallbackMarkdown || "";
  const [content, setContent] = useState(initialContent);
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // 1. 提取正文与字数
  const totalChars = structured?.totalChars ?? structured?.contentChars ?? content.length;
  const isLong = totalChars > 320 || content.split("\n").length > 8;

  // 2. 格式化工具名与任务描述
  const resolvedTool = structured?.tool || toolName || sourceType;
  const displayToolName = formatToolDisplayName(resolvedTool || "异步工具");

  const rawTaskTitle = structured?.title || taskLabel || subagentName || "后台任务处理";
  const displayTaskTitle = rawTaskTitle.length > 50 ? `${rawTaskTitle.slice(0, 50)}...` : rawTaskTitle;

  // 3. 图标类型推导
  const getToolIcon = () => {
    const t = (resolvedTool || "").toLowerCase();
    const s = (sourceType || "").toLowerCase();
    if (t.includes("read") || t.includes("article") || s.includes("read")) {
      return <FileText className="h-4 w-4 text-[var(--kp-brand)]" />;
    }
    if (t.includes("search") || s.includes("search")) {
      return <Search className="h-4 w-4 text-emerald-600" />;
    }
    if (t.includes("cmd") || t.includes("command") || t.includes("exec") || t.includes("bash")) {
      return <Terminal className="h-4 w-4 text-amber-600" />;
    }
    if (s.includes("subagent") || subagentName) {
      return <Cpu className="h-4 w-4 text-purple-600" />;
    }
    if (s.includes("sleep")) {
      return <Clock className="h-4 w-4 text-blue-600" />;
    }
    return <Sparkles className="h-4 w-4 text-[var(--kp-brand)]" />;
  };

  // 4. 复制正文
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 5. 元数据面板
  const metaBits = [
    structured?.author ? `作者: ${structured.author}` : null,
    structured?.platform ? `平台: ${structured.platform}` : null,
    structured?.method ? `方式: ${structured.method}` : null,
    structured?.elapsedMs != null ? `耗时: ${Math.round(structured.elapsedMs)}ms` : null,
    jobId ? `Job: ${jobId.slice(0, 8)}` : null,
  ].filter(Boolean);

  const previewFields = structured?.previewFields?.slice(0, 6) ?? [];

  const handleContentChange = (newVal: string) => {
    setContent(newVal);
    if (onSaveEditedContent) onSaveEditedContent(newVal);
  };

  return (
    <div
      className="group/card my-1 overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-bg)] to-[var(--kp-bg-alt)] shadow-xs transition-all hover:border-[var(--kp-brand)]/40 hover:shadow-sm"
      data-testid="async-tool-result-card"
    >
      {/* 顶栏 Header: 工具名、任务名、模式切换与状态 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--kp-divider-light)] bg-[var(--kp-bg-mute)]/50 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] shadow-2xs">
            {getToolIcon()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-[var(--kp-text-1)]">
                {displayToolName}
              </span>
              <span className="rounded-full bg-[var(--kp-brand-soft)] px-2 py-0.2 text-[10px] font-semibold text-[var(--kp-brand-deep)]">
                异步工具
              </span>
            </div>
            <p className="truncate text-[11px] text-[var(--kp-text-2)]" title={rawTaskTitle}>
              {displayTaskTitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 渲染 / 源码(可编辑) 分段切换按钮 */}
          <div className="flex items-center gap-0.5 rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode("rendered")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-0.5 font-medium transition",
                viewMode === "rendered"
                  ? "bg-[var(--kp-brand-soft)] font-semibold text-[var(--kp-brand-deep)] shadow-2xs"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]",
              )}
              title="富文本 / Markdown 渲染视图"
            >
              <Eye className="h-3 w-3" />
              <span>渲染</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("source")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-0.5 font-medium transition",
                viewMode === "source"
                  ? "bg-zinc-800 font-semibold text-zinc-100 shadow-2xs dark:bg-zinc-700"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]",
              )}
              title="查看原始源码文本，并可直接在框内编辑修改"
            >
              <Code2 className="h-3 w-3" />
              <span>源码 (可编辑)</span>
            </button>
          </div>

          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            已完成
          </span>
          <span className="text-[10px] font-medium text-[var(--kp-text-3)]">
            {totalChars > 1000 ? `${(totalChars / 1000).toFixed(1)}k 字` : `${totalChars} 字`}
          </span>
        </div>
      </div>

      {/* 详细元信息 / 动作参数区域 */}
      {(structured?.url || metaBits.length > 0 || previewFields.length > 0) && (
        <div className="space-y-1.5 border-b border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/40 px-3.5 py-2 text-[11px]">
          {structured?.url && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
              <a
                href={structured.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[var(--kp-brand-deep)] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate">{structured.url}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}

          {metaBits.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--kp-text-3)]">
              {metaBits.map((bit, idx) => (
                <span key={idx} className="inline-flex items-center">
                  {idx > 0 && <span className="mr-2 text-[var(--kp-divider)]">•</span>}
                  {bit}
                </span>
              ))}
            </div>
          )}

          {previewFields.length > 0 && (
            <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-1 rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg-mute)]/60 px-2.5 py-1.5 text-[11px] sm:grid-cols-2">
              {previewFields.map((f) => (
                <div key={f.key} className="flex min-w-0 gap-1.5">
                  <dt className="shrink-0 font-medium text-[var(--kp-text-3)]">{f.key}:</dt>
                  <dd className="min-w-0 truncate text-[var(--kp-text-1)]">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* 投递说明与正文展示控制 */}
      <div className="p-3.5">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium text-[var(--kp-text-2)]">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            已将以下工具返回结果注入给大模型:
          </span>
          <div className="flex items-center gap-2">
            {content !== initialContent && (
              <button
                type="button"
                onClick={() => handleContentChange(initialContent)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline transition"
                title="恢复为工具原始返回结果"
              >
                <RotateCcw className="h-3 w-3" />
                <span>重置为默认</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-[11px] text-[var(--kp-text-3)] transition hover:text-[var(--kp-text-1)]"
              title="复制完整投递内容"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "已复制" : "复制"}</span>
            </button>
          </div>
        </div>

        {/* 1. 源码模式（直接在代码框内编辑） */}
        {viewMode === "source" ? (
          <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 shadow-inner">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 text-[10px] text-zinc-400">
              <span className="font-semibold text-zinc-300">RAW SOURCE CODE (EDITABLE)</span>
              <span>{content.length} CHARS</span>
            </div>
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              rows={Math.min(18, Math.max(6, content.split("\n").length + 1))}
              className="w-full resize-y border-0 bg-transparent p-0 font-mono text-[11px] leading-relaxed text-zinc-100 shadow-none focus:outline-none focus:ring-0 selection:bg-zinc-700 selection:text-white"
              placeholder="输入或修改源码正文..."
            />
          </div>
        ) : (
          /* 2. 渲染模式 (Rendered Markdown) */
          isLong ? (
            <div className="space-y-2">
              {!open ? (
                /* 长文本默认摘要折叠态 */
                <div className="relative rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-mute)]/50 p-3">
                  <PostContent
                    content={content.slice(0, 240) + "..."}
                    className="prose-sm max-w-none text-left text-[var(--kp-text-2)] [&_table]:text-xs"
                  />
                  <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--kp-bg-alt)] to-transparent" />
                </div>
              ) : (
                /* 展开完整文本 */
                <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-mute)] p-3 text-[12px] shadow-inner">
                  <PostContent
                    content={content}
                    className="prose-sm max-w-none text-left text-[var(--kp-text-1)] [&_table]:text-xs [&_th]:px-2 [&_td]:px-2"
                  />
                </div>
              )}

              {/* 展开/收起切换按钮 */}
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] py-1.5 text-[11px] font-semibold text-[var(--kp-brand-deep)] shadow-2xs transition hover:border-[var(--kp-brand)]/30 hover:bg-[var(--kp-brand-soft)]/40"
                data-testid="async-tool-result-toggle"
              >
                {open ? (
                  <>
                    <span>收起完整返回结果</span>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    <span>展开完整返回结果 ({totalChars > 1000 ? `${(totalChars / 1000).toFixed(1)}k` : totalChars} 字)</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          ) : (
            /* 短文本直接展示 */
            <div className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-mute)]/60 p-3">
              <PostContent
                content={content}
                className="prose-sm max-w-none text-left text-[var(--kp-text-1)] [&_table]:text-xs [&_th]:px-2 [&_td]:px-2"
              />
            </div>
          )
        )}
      </div>
    </div>
  );
});

export const MessageSourceLabel = memo(function MessageSourceLabel({
  source,
  isSubagentSession,
  align = "left",
  subagentName,
  asyncKind,
  taskLabel,
  toolName,
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
  toolName?: string;
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
    const label = asyncResultLabel(asyncKind, taskLabel, subagentName, toolName);
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

/** 点击才展开：模型 + 输入/输出 token（不进气泡正文） */
export function MessageUsageDetails({
  open,
  tokenUsage,
  fallbackModel,
}: {
  open: boolean;
  tokenUsage?: ChatMessage["tokenUsage"] | null;
  fallbackModel?: string;
}) {
  if (!open) return null;
  const model = tokenUsage?.model?.trim() || fallbackModel?.trim() || "—";
  const prompt = tokenUsage?.prompt;
  const completion = tokenUsage?.completion;
  const total = tokenUsage?.total;
  const hasTokens = prompt != null || completion != null || total != null;
  return (
    <div
      className="mt-1 w-full max-w-[96%] rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] px-3 py-2 text-[11px] text-[var(--kp-text-2)]"
      data-testid="message-usage-details"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          <span className="text-[var(--kp-text-3)]">模型 </span>
          <span className="font-medium text-[var(--kp-text-1)]">{model}</span>
        </span>
        {hasTokens ? (
          <>
            <span>
              <span className="text-[var(--kp-text-3)]">输入 </span>
              <span className="tabular-nums text-[var(--kp-text-1)]">
                {prompt != null ? formatTokenCount(prompt) : "—"}
              </span>
            </span>
            <span>
              <span className="text-[var(--kp-text-3)]">输出 </span>
              <span className="tabular-nums text-[var(--kp-text-1)]">
                {completion != null ? formatTokenCount(completion) : "—"}
              </span>
            </span>
            <span>
              <span className="text-[var(--kp-text-3)]">合计 </span>
              <span className="tabular-nums font-medium text-[var(--kp-text-1)]">
                {total != null ? formatTokenCount(total) : "—"}
              </span>
            </span>
          </>
        ) : (
          <span className="text-[var(--kp-text-3)]">本条未记录 token 用量</span>
        )}
      </div>
    </div>
  );
}

/** 压缩边界：摘要不进正文，点击展开 session.contextSummary */
export function CompactBoundaryCard({
  message,
  contextSummary,
}: {
  message: ChatMessage;
  contextSummary?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const args =
    Array.isArray(message.toolCalls) && message.toolCalls[0] && typeof message.toolCalls[0] === "object"
      ? (message.toolCalls[0] as { args?: { messagesSummarized?: number; trigger?: string; generation?: number } }).args
      : undefined;
  const summarized = args?.messagesSummarized;
  const trigger =
    args?.trigger === "manual" ? "手动压缩" : args?.trigger === "auto" ? "自动压缩" : "上下文压缩";
  const summary = contextSummary?.trim() || "";

  return (
    <div className="my-3 flex w-full justify-center px-4" data-testid="compact-boundary-card">
      <div className="w-full max-w-xl rounded-xl border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-[12px] text-[var(--kp-text-2)] transition hover:text-[var(--kp-text-1)]"
          aria-expanded={open}
          data-testid="compact-boundary-toggle"
        >
          <Gauge className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
          <span className="min-w-0 flex-1 font-medium">
            {trigger}
            {summarized != null ? ` · ${summarized} 条旧消息已摘要` : ""}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--kp-text-3)]">
            {open ? "收起摘要" : "查看摘要"}
          </span>
          {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
        </button>
        {open ? (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] px-3 py-2 text-[12px] leading-relaxed text-[var(--kp-text-2)] whitespace-pre-wrap">
            {summary || "（暂无持久化摘要正文）"}
          </div>
        ) : null}
      </div>
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
  onToggleUsage,
  bookmarked = false,
  showEdit = true,
  showRetry = true,
  showRegenerate = false,
  showShare = true,
  showSpeak = true,
  showBookmark = false,
  showSaveAsPost = false,
  showUsage = false,
  usageOpen = false,
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
  onToggleUsage?: () => void;
  bookmarked?: boolean;
  showEdit?: boolean;
  showRetry?: boolean;
  showRegenerate?: boolean;
  showShare?: boolean;
  showSpeak?: boolean;
  showBookmark?: boolean;
  showSaveAsPost?: boolean;
  showUsage?: boolean;
  usageOpen?: boolean;
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
        isEditing || usageOpen
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100",
      )}
    >
      {versionNav}
      {showUsage && onToggleUsage && (
        <button
          type="button"
          onClick={onToggleUsage}
          disabled={disabled}
          className={cn(btnClass, usageOpen && "text-[var(--kp-brand)]")}
          title="用量与模型"
          aria-label="用量与模型"
          aria-pressed={usageOpen}
          data-testid="message-usage-btn"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      )}
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
