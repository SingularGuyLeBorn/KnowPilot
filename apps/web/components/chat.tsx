"use client";

/**
 * Agent Chat — 三栏布局 · 多版本 · 消息编辑 · Skill / 触发
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ListChecks,
  Loader2,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAgent } from "@/lib/hooks";
import { streamAgentChat, copyToClipboard } from "@/lib/agentStream";
import {
  buildStreamConfig,
  DEFAULT_CHAT_CONFIG,
  getModelOption,
  loadDefaultChatConfig,
  loadSessionChatConfig,
  resolveNewChatConfig,
  saveDefaultChatConfig,
  saveSessionChatConfig,
} from "@/lib/chatConfig";
import {
  buildMessageGroups,
  buildTimelineFromStored,
  formatToolResultHint,
  getActiveVersion,
  type MessageGroup,
  type TimelineStep,
} from "@/lib/chatMessageUtils";
import { LucideIconByName } from "@/lib/icons";
import { cn, formatRelativeTime, groupBySessionDate } from "@/lib/utils";
import { type Agent, type ChatSession, type ChatSessionConfig, type ChatImageAttachment } from "@knowpilot/shared";
import { buttonVariants } from "@/components/ui/button";
import { PostContent } from "@/components/post/PostContent";
import { ConfirmDialog } from "@/components/shared";
import { SessionContextBar } from "@/components/sessionContextUsage";
import { ChatInputArea, type SelectedSkill } from "@/components/chatInput";
import { ChatSettingsPanel } from "@/components/chatSettingsPanel";
import { buildTokenBudget } from "@/components/tokenBudgetBar";
import {
  type ChatQueueItem,
  createUserQueueItem,
  formatQueueItemForLlm,
  mergeAsyncPollIntoQueue,
  splitQueueByKind,
  sortQueueItems,
} from "@/lib/chatQueueTypes";
import { MessageQueue } from "@/components/chatQueue";
import { SubagentPanel } from "@/components/subagentPanel";
import { SubagentCreateDialog } from "@/components/subagentCreateDialog";
import { WorkspaceTree } from "@/components/workspaceTree";
import { AgentTreeSelect } from "@/components/agentTreeSelect";
import { MessageNavRail, type NavItem } from "@/components/messageNavRail";

/* ─── Sub-components ─── */

function ThinkingStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "thinking" }>;
  isLive?: boolean;
}) {
  const content = step.content.trim();
  const isEmpty = !content;
  // 默认展开（不折叠）；流式中不允许折叠，避免漏看实时输出
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] shadow-sm">
      <button
        type="button"
        onClick={() => !isLive && setCollapsed((v) => !v)}
        disabled={isLive}
        className="flex w-full items-center gap-2 border-b border-[var(--kp-divider-light)] bg-[var(--kp-bg-soft)] px-3 py-2 text-left text-[11px] font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] disabled:cursor-default disabled:hover:bg-[var(--kp-bg-soft)]"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开思考" : "折叠思考"}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
        <span>Thinking</span>
        {isLive && <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-brand)]" />}
        {!isLive && (
          <ChevronRight
            className={cn(
              "ml-auto h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200",
              collapsed ? "" : "rotate-90",
            )}
          />
        )}
      </button>
      {!collapsed && (
        <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
          {isEmpty ? (
            isLive ? (
              <p className="text-xs text-[var(--kp-text-3)]">等待模型输出…</p>
            ) : null
          ) : (
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--kp-text-2)]">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** 中间正式回复（工具轮次中 probe 返回的 content，后续仍有工具调用）。进导轨，无圆点，无气泡包裹。 */
function ContentStep({
  step,
}: {
  step: Extract<TimelineStep, { type: "content" }>;
}) {
  const content = step.content.trim();
  if (!content) return null;
  return (
    <div data-testid="intermediate-content-step" className="px-1 py-1 text-sm text-[var(--kp-text-1)]">
      <PostContent content={content} className="prose-sm max-w-none" />
    </div>
  );
}

function ToolStep({
  step,
  isLive = false,
}: {
  step: Extract<TimelineStep, { type: "tool" }>;
  isLive?: boolean;
}) {
  const [open, setOpen] = useState(isLive && step.status === "running");
  const displayName = step.name.replace(/^skill__/, "Skill · ").replace(/^mcp__/, "MCP · ");
  const hasError =
    step.result &&
    typeof step.result === "object" &&
    step.result !== null &&
    "error" in (step.result as Record<string, unknown>);

  return (
    <div
      data-testid="tool-pill"
      className={cn(
        "overflow-hidden rounded-xl border shadow-sm transition-colors",
        step.status === "running"
          ? "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/30"
          : "border-[var(--kp-divider-light)] bg-[var(--kp-bg)]",
      )}
    >
      <details open={open} className="group/tool" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-[var(--kp-text-2)]">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              step.status === "running" ? "animate-pulse bg-[var(--kp-brand)]" : hasError ? "bg-red-500" : "bg-green-500",
            )}
          />
          <Wrench className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
          <span className="min-w-0 truncate">{displayName}</span>
          {step.status === "running" && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--kp-brand)]" />}
          {step.status === "done" && !isLive && (
            <span
              className={cn(
                "ml-auto text-[10px]",
                hasError ? "text-red-600" : "text-[var(--kp-text-3)]",
              )}
              data-testid="tool-timing-hint"
            >
              {step.hint || formatToolResultHint(step.result) || (hasError ? "失败" : "")}
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200 group-open/tool:rotate-90" />
        </summary>
        <div className="border-t border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/40 px-3 py-2">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--kp-text-3)]">
            {JSON.stringify(step.args, null, 2)}
          </pre>
          {step.result !== undefined && (
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap border-t border-[var(--kp-divider-light)] pt-2 text-[10px] text-[var(--kp-text-2)]">
              {JSON.stringify(step.result, null, 2)}
            </pre>
          )}
        </div>
      </details>
    </div>
  );
}

/** 消息来源角标（#21 + #24）：非 user 来源的消息在气泡角上显示微型来源徽章 */
const SOURCE_LABEL_STYLES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  super: { label: "子代理任务", bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-200" },
  manager: { label: "管理 Agent", bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  sub: { label: "子 Agent", bg: "bg-green-100", text: "text-green-700", border: "border-green-200" },
  system: { label: "心跳触发", bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
};

const MessageSourceLabel = memo(function MessageSourceLabel({
  source,
  isSubagentSession,
  align = "left",
}: {
  source?: string;
  isSubagentSession?: boolean;
  align?: "left" | "right";
}) {
  if (!source || source === "user") return null;
  const base = SOURCE_LABEL_STYLES[source] ?? { label: source, bg: "bg-gray-100", text: "text-gray-600", border: "border-gray-200" };
  const isParent = source === "super" && isSubagentSession;
  const label = isParent ? "父代理" : base.label;
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

function ThinkingTimeline({
  steps,
  isLive = false,
}: {
  steps: TimelineStep[];
  isLive?: boolean;
}) {
  if (!steps.length) return null;

  return (
    <div className="mb-2 flex max-w-[88%] gap-0" data-testid="thinking-timeline">
      <div className="relative flex w-6 shrink-0 justify-center pt-2">
        <div className="absolute top-2 bottom-2 w-0.5 bg-[var(--kp-brand-light)]/40" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {steps.map((step, i) => {
          const key =
            step.type === "tool"
              ? step.toolCallId
              : step.type === "content"
                ? `content-${step.round}-${i}`
                : `thinking-${step.round}-${i}`;
          // 圆点仅给 thinking；content / tool 共享竖线但不画圆点（对标 Kimi Code）
          return (
            <div key={key} className="relative">
              {step.type === "thinking" && (
                <span className="absolute -left-[17px] top-2 h-2.5 w-2.5 rounded-full bg-[var(--kp-brand)] ring-2 ring-[var(--kp-bg-alt)]" />
              )}
              {step.type === "thinking" ? (
                <ThinkingStep step={step} isLive={isLive && i === steps.length - 1} />
              ) : step.type === "content" ? (
                <ContentStep step={step} />
              ) : (
                <ToolStep step={step} isLive={isLive} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MessageVersions({
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

function MessageActions({
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

const SessionListItem = memo(function SessionListItem({
  session,
  active,
  editing,
  renameDraft,
  onSelect,
  onStartRename,
  onRenameDraftChange,
  onConfirmRename,
  onCancelRename,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  editing: boolean;
  renameDraft: string;
  onSelect: (id: string) => void;
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
          className="rounded-md p-1 text-[var(--kp-brand-dark)] hover:bg-[var(--kp-brand-soft)]"
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
        className={cn(
          "min-w-0 flex-1 px-3 py-2 text-left text-sm transition",
          active ? "text-[var(--kp-brand-dark)]" : "text-[var(--kp-text-2)]",
        )}
      >
        <div className="truncate font-medium">{session.title}</div>
        <div className="truncate text-xs text-[var(--kp-text-3)]">
          {session.model} · {formatRelativeTime(session.updatedAt)}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--kp-divider-light)] px-1 opacity-70 transition-opacity group-hover/sess:opacity-100">
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

/* ─── Main ─── */

export function ChatView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const agentFromUrl = searchParams.get("agentId");
  const sessionFromUrl = searchParams.get("sessionId");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{ id: string; content: string; attachments?: ChatImageAttachment[] }[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [liveTimeline, setLiveTimeline] = useState<TimelineStep[]>([]);
  // 当前流式目标所属的 user 消息 id（重试/重生成/编辑时定位到原 group 原位渲染，
  // 避免旧 assistant 气泡与新流式气泡并存）。新消息流式时为 null，流式气泡落列表底部。
  const [streamTargetUserId, setStreamTargetUserId] = useState<string | null>(null);
  const [lastRoundTokens, setLastRoundTokens] = useState(0);
  // 两个物理独立的队列：userQueue（用户主动消息）+ asyncOverlays（异步结果的用户追加编辑）
  // asyncResultQueue（运行中+已完成投递）由 poll 数据派生，不存入 session state
  const [userQueue, setUserQueue] = useState<ChatQueueItem[]>([]);
  const [asyncOverlays, setAsyncOverlays] = useState<ChatQueueItem[]>([]);
  const [consumedDeliveries, setConsumedDeliveries] = useState<Set<string>>(() => new Set());
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [chatConfig, setChatConfig] = useState<ChatSessionConfig>(DEFAULT_CHAT_CONFIG);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SelectedSkill | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<{ id: string; title: string } | null>(null);
  const [showCreateSubagent, setShowCreateSubagent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // #11 会话批量管理
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  // #12 Swarm 新手引导（可关闭，localStorage 记忆）
  // 避免 SSR/客户端 localStorage 不一致导致 hydration mismatch：
  // 首次渲染始终输出 DOM（带 hidden），hydration 后通过 ref 读取 localStorage 再显示/移除
  const onboardingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem("kp-swarm-onboarding-dismissed") === "1") {
        onboardingRef.current?.remove();
      } else {
        onboardingRef.current?.classList.remove("hidden");
      }
    } catch {
      onboardingRef.current?.classList.remove("hidden");
    }
  }, []);
  const dismissSwarmOnboarding = () => {
    onboardingRef.current?.remove();
    try {
      localStorage.setItem("kp-swarm-onboarding-dismissed", "1");
    } catch {
      // ignore
    }
  };

  const bottomRef = useRef<HTMLDivElement>(null);
  const consumeRef = useRef<() => void>(() => {});

  /* ─── 多 session 流式状态隔离 ───
   * 每个 session 拥有独立的流式状态(isStreaming/streamingContent/liveTimeline/optimistic/error/abort/...)，
   * 支持多 session 并发流式(为 agent swarm 铺路)：
   *   - 切换 session 只切视图，不 abort 旧 session 的流式
   *   - 切回原 session 时从 Map 取回其流式状态继续展示
   *   - 流式回调用闭包捕获的 originSid 只更新该 session 的状态，不污染当前视图
   * 视图 useState(isStreaming/streamingContent/...)作为"当前 effectiveSessionId 的镜像"，
   * 由 applyView() 在切换时同步；helper setter 同步写 ref Map + 视图(若是当前 session)。
   */
  type OptimisticMsg = { id: string; content: string; attachments?: ChatImageAttachment[] };
  interface SessionStreamState {
    isStreaming: boolean;
    streamingContent: string;
    liveTimeline: TimelineStep[];
    streamTargetUserId: string | null;
    optimistic: OptimisticMsg[];
    error: string | null;
    lastRoundTokens: number;
    abort: AbortController | null;
    // 按 session 隔离的两个物理独立队列 + 异步投递消费记录
    userQueue: ChatQueueItem[];
    asyncOverlays: ChatQueueItem[];
    consumedDeliveries: Set<string>;
    queueDraining: boolean;
    activeQueueTaskId: string | null;
  }
  const NEW_STREAM_KEY = "__new__"; // 新会话首条消息发起时尚无 sessionId 时的临时键
  const streamStatesRef = useRef<Map<string, SessionStreamState>>(new Map());
  const effectiveSessionIdRef = useRef<string | null>(null);

  const getStreamState = useCallback((sid: string): SessionStreamState => {
    let s = streamStatesRef.current.get(sid);
    if (!s) {
      s = {
        isStreaming: false,
        streamingContent: "",
        liveTimeline: [],
        streamTargetUserId: null,
        optimistic: [],
        error: null,
        lastRoundTokens: 0,
        abort: null,
        userQueue: [],
        asyncOverlays: [],
        consumedDeliveries: new Set<string>(),
        queueDraining: false,
        activeQueueTaskId: null,
      };
      streamStatesRef.current.set(sid, s);
    }
    return s;
  }, []);

  // 把指定 session 的后台状态镜像到视图 useState（切换 session 时调用）
  // sid 为 null 时镜像 NEW_STREAM_KEY，保证新会话首条消息期间用户也能看到乐观消息/流式状态
  const applyView = useCallback(
    (sid: string | null) => {
      const s = streamStatesRef.current.get(sid ?? NEW_STREAM_KEY);
      setIsStreaming(s?.isStreaming ?? false);
      setStreamingContent(s?.streamingContent ?? "");
      setLiveTimeline(s?.liveTimeline ?? []);
      setStreamTargetUserId(s?.streamTargetUserId ?? null);
      setOptimistic(s?.optimistic ?? []);
      setError(s?.error ?? null);
      setLastRoundTokens(s?.lastRoundTokens ?? 0);
      setUserQueue(s?.userQueue ?? []);
      setAsyncOverlays(s?.asyncOverlays ?? []);
      setConsumedDeliveries(s?.consumedDeliveries ?? new Set<string>());
    },
    [],
  );

  // session-aware setter：更新 ref Map[originSid]，若它是当前视图则同步 useState
  const ssSet = useCallback(
    <K extends keyof SessionStreamState>(
      originSid: string,
      key: K,
      value: SessionStreamState[K] | ((prev: SessionStreamState[K]) => SessionStreamState[K]),
    ) => {
      const s = getStreamState(originSid);
      const next = typeof value === "function" ? (value as (p: SessionStreamState[K]) => SessionStreamState[K])(s[key]) : value;
      (s as SessionStreamState)[key] = next;
      const isCurrentView =
        originSid === effectiveSessionIdRef.current ||
        (effectiveSessionIdRef.current === null && originSid === NEW_STREAM_KEY);
      if (isCurrentView) {
        switch (key) {
          case "isStreaming": setIsStreaming(next as boolean); break;
          case "streamingContent": setStreamingContent(next as string); break;
          case "liveTimeline": setLiveTimeline(next as TimelineStep[]); break;
          case "streamTargetUserId": setStreamTargetUserId(next as string | null); break;
          case "optimistic": setOptimistic(next as OptimisticMsg[]); break;
          case "error": setError(next as string | null); break;
          case "lastRoundTokens": setLastRoundTokens(next as number); break;
          case "userQueue": setUserQueue(next as ChatQueueItem[]); break;
          case "asyncOverlays": setAsyncOverlays(next as ChatQueueItem[]); break;
          case "consumedDeliveries": setConsumedDeliveries(next as Set<string>); break;
          default: break;
        }
      }
    },
    [getStreamState],
  );

  const isSessionStreaming = useCallback(
    (sid: string | null): boolean => (sid ? streamStatesRef.current.get(sid)?.isStreaming ?? false : false),
    [],
  );

  // 流式 token rAF 合并：onToken 每字符触发一次 setState 会让 ChatView 高频重渲染。
  // 将同帧内多个 delta 累积到 pendingStreamDeltaRef，由 requestAnimationFrame 在下一帧
  // 合并为单次 streamingContent 更新，显著降低流式吐字时的 setState 频率与重排开销。
  const pendingStreamDeltaRef = useRef<Map<string, string>>(new Map());
  const streamRafRef = useRef<Map<string, number>>(new Map());

  const scheduleStreamFlush = useCallback(
    (sid: string) => {
      if (streamRafRef.current.has(sid)) return;
      const id = requestAnimationFrame(() => {
        streamRafRef.current.delete(sid);
        const delta = pendingStreamDeltaRef.current.get(sid);
        if (delta) {
          pendingStreamDeltaRef.current.delete(sid);
          ssSet(sid, "streamingContent", (prev) => prev + delta);
        }
      });
      streamRafRef.current.set(sid, id);
    },
    [ssSet],
  );

  /** 立即冲刷并取消该 session 的待写 delta（用于 onDone 等需要同步落地的场景） */
  const flushStreamNow = useCallback(
    (sid: string) => {
      const rafId = streamRafRef.current.get(sid);
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        streamRafRef.current.delete(sid);
      }
      const delta = pendingStreamDeltaRef.current.get(sid);
      if (delta) {
        pendingStreamDeltaRef.current.delete(sid);
        ssSet(sid, "streamingContent", (prev) => prev + delta);
      }
    },
    [ssSet],
  );

  /** 取消该 session 的 rAF 并丢弃未写 delta（用于 onError/finally 等清理场景） */
  const discardStreamFlush = useCallback((sid: string) => {
    const rafId = streamRafRef.current.get(sid);
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      streamRafRef.current.delete(sid);
    }
    pendingStreamDeltaRef.current.delete(sid);
  }, []);

  const getAbort = useCallback(
    (sid: string | null): AbortController | null => (sid ? streamStatesRef.current.get(sid)?.abort ?? null : null),
    [],
  );

  const { useList: useAgentList } = useAgent();
  const agentsQuery = useAgentList({ page: 1, pageSize: 50 });
  const skillsQuery = trpc.skill.list.useQuery({ page: 1, pageSize: 100, enabled: true });
  const sessionsQuery = trpc.session.list.useQuery({ page: 1, pageSize: 40 });
  const providers = trpc.agent.llmProviders.useQuery();
  // Swarm：拉取 Workspace 列表判断是否显示 Workspace 树
  const workspacesQuery = trpc.workspace.list.useQuery({ page: 1, pageSize: 100, status: "active" });
  const hasWorkspaces = (workspacesQuery.data?.items ?? []).length > 0;
  const utils = trpc.useUtils();
  const updateSession = trpc.session.update.useMutation();
  const deleteSession = trpc.session.delete.useMutation();
  const bulkDeleteMutation = trpc.session.bulkDelete.useMutation();
  const switchVersion = trpc.message.switchVersion.useMutation();

  const defaultAgentId = useMemo(() => {
    const items = agentsQuery.data?.items;
    if (!items?.length) return "";
    const assistant = items.find((a: Agent) => a.name === "assistant");
    return assistant?.id ?? items[0].id;
  }, [agentsQuery.data?.items]);

  // sessionId state 与 URL param 保持同步：
  // 1. 从外部页面跳转（/subagents → /chat?sessionId=xxx）时 sessionId 为 null，URL param 生效
  // 2. 浏览器前进/后退改变 URL 时，把 URL 同步回 state
  // 3. selectSession 已主动更新 URL，所以日常侧边栏切换不会触发这里
  const effectiveSessionId = sessionId ?? sessionFromUrl;
  useEffect(() => {
    if (sessionFromUrl && sessionFromUrl !== sessionId) {
      // 同步 URL 到 state：用 queueMicrotask 避免在 effect 同步阶段触发级联渲染
      queueMicrotask(() => {
        setSessionId(sessionFromUrl);
        applyView(sessionFromUrl);
      });
    }
  }, [sessionFromUrl, sessionId, applyView]);
  // 同步当前视图 session 到 ref，供 runStream 回调判断"是否当前视图"
  useEffect(() => {
    effectiveSessionIdRef.current = effectiveSessionId;
  }, [effectiveSessionId]);

  const { data: sessionDetail, refetch: refetchSession } = trpc.session.getById.useQuery(
    { id: effectiveSessionId! },
    { enabled: !!effectiveSessionId },
  );
  // 当前会话是否为子代理任务会话；若是则查父会话标题用于返回提示
  const isSubagentSession = sessionDetail?.kind === "subagent";
  const parentSessionId = sessionDetail?.parentSessionId ?? null;
  const { data: parentSession } = trpc.session.getById.useQuery(
    { id: parentSessionId! },
    { enabled: !!parentSessionId },
  );

  // Agent 选择优先级：用户显式选择 > 当前会话关联 Agent > URL 参数 > 默认 assistant
  // 修复：之前 `agentFromUrl ?? ...` 导致 URL 中的 agentId 永远覆盖用户选择，
  //      表现为 Agent 选择器无法切换。
  const effectiveAgentId =
    agentId || sessionDetail?.agentId || agentFromUrl || defaultAgentId;

  const backendDown = agentsQuery.isError || sessionsQuery.isError || providers.isError;

  const asyncQueueQuery = trpc.agent.pullAsyncQueue.useQuery(
    { sessionId: effectiveSessionId! },
    {
      enabled: !!effectiveSessionId && !backendDown,
      refetchInterval: (query) => (query.state.error ? 10000 : 2500),
    },
  );

  const asyncQueueStatsQuery = trpc.agent.asyncQueueStats.useQuery(undefined, {
    enabled: !backendDown,
    refetchInterval: (query) => (query.state.error ? 30000 : 5000),
  });

  const cancelAsyncJobMutation = trpc.agent.cancelAsyncJob.useMutation({
    onSuccess: () => {
      void asyncQueueQuery.refetch();
    },
  });

  const retryAsyncJobMutation = trpc.agent.retryAsyncJob.useMutation({
    onSuccess: () => {
      void asyncQueueQuery.refetch();
    },
  });

  // 两个物理独立队列：
  // - asyncResultQueue: 从 poll 数据派生（async-running + async-result），合并 asyncOverlays（用户追加编辑）
  // - userQueue: 用户主动发送的消息（存入 session state）
  // 显示队列 = asyncResultQueue + userQueue（async 在前，符合优先级语义）
  const asyncResultQueue = useMemo(
    () =>
      mergeAsyncPollIntoQueue(asyncOverlays, asyncQueueQuery.data, {
        skipDeliveryJobIds: consumedDeliveries,
      }),
    [asyncOverlays, asyncQueueQuery.data, consumedDeliveries],
  );

  const queue = useMemo(
    () => [...sortQueueItems(asyncResultQueue), ...sortQueueItems(userQueue)],
    [asyncResultQueue, userQueue],
  );

  // localQueueRef / consumedDeliveriesRef 已由按 session 的 streamStatesRef 取代

  // 按会话持久化已消费的异步投递，刷新页面后不再显示旧结果
  useEffect(() => {
    if (!effectiveSessionId) return;
    const key = `kp:consumed-deliveries:${effectiveSessionId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        // 从外部存储恢复已消费的异步投递；写到该 session 的后台状态
        // eslint-disable-next-line react-hooks/set-state-in-effect
        ssSet(effectiveSessionId, "consumedDeliveries", new Set<string>(JSON.parse(saved)));
      }
    } catch {
      // ignore
    }
  }, [effectiveSessionId, ssSet]);

  useEffect(() => {
    if (!effectiveSessionId) return;
    const key = `kp:consumed-deliveries:${effectiveSessionId}`;
    try {
      localStorage.setItem(key, JSON.stringify([...consumedDeliveries]));
    } catch {
      // ignore
    }
  }, [effectiveSessionId, consumedDeliveries]);

  // 流式状态已按 session 隔离（streamStatesRef），不再需要全局 isStreamingRef 同步

  const selectedAgent = agentsQuery.data?.items.find((a: Agent) => a.id === effectiveAgentId);
  const modelOpt = getModelOption(chatConfig.model);

  const messageGroups = useMemo(
    () => buildMessageGroups(sessionDetail?.messages ?? []),
    [sessionDetail?.messages],
  );

  // 右侧导航条：每条 assistant 回复一个横杠，hover 放大 + 预览，点击滚动定位
  const navItems = useMemo<NavItem[]>(() => {
    return messageGroups
      .map((g) => {
        if (!g.assistantMessage) return null;
        const active = getActiveVersion(g);
        if (!active) return null;
        const preview = active.content.replace(/[#*`>\-\[\]!]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
        return {
          id: g.assistantMessage.id,
          preview: preview || "（空回复）",
          domId: g.assistantMessage.id,
        } satisfies NavItem;
      })
      .filter((x): x is NavItem => x !== null);
  }, [messageGroups]);

  const filteredSessions = useMemo(() => {
    const items = sessionsQuery.data?.items ?? [];
    // #4 修复：按当前 Agent 过滤 session（agent 隔离）。
    // 同时保留当前父会话的子代理任务会话，避免子代理卡片/会话被过滤掉。
    const agentFiltered = effectiveAgentId
      ? items.filter(
          (s) =>
            s.agentId === effectiveAgentId ||
            !s.agentId ||
            (s.kind === "subagent" && s.parentSessionId === effectiveSessionId),
        )
      : items;
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return agentFiltered;
    return agentFiltered.filter(
      (s) => s.title.toLowerCase().includes(q) || s.model.toLowerCase().includes(q),
    );
  }, [sessionsQuery.data?.items, sessionSearch, effectiveAgentId, effectiveSessionId]);

  const groupedSessions = useMemo(
    () => groupBySessionDate(filteredSessions),
    [filteredSessions],
  );

  const tokenBudget = useMemo(
    () => buildTokenBudget(sessionDetail?.messages ?? [], chatConfig.maxTokens, lastRoundTokens),
    [sessionDetail?.messages, chatConfig.maxTokens, lastRoundTokens],
  );

  const lastUserMessageId = useMemo(() => {
    if (messageGroups.length === 0) return null;
    return messageGroups[messageGroups.length - 1].userMessage.id;
  }, [messageGroups]);

  useEffect(() => {
    if (effectiveSessionId) {
      if (!selectedAgent) return;
      const saved = loadSessionChatConfig(effectiveSessionId);
      startTransition(() => {
        if (saved) {
          // 已有会话保留用户选择的模型，只同步 systemPrompt（如果用户没自定义）
          setChatConfig({
            ...saved,
            systemPrompt: saved.customSystemPrompt
              ? saved.systemPrompt
              : (saved.systemPrompt || selectedAgent.systemPrompt),
          });
          return;
        }
        setChatConfig((prev) => ({
          ...prev,
          model: sessionDetail?.model ?? selectedAgent.model,
          systemPrompt:
            sessionDetail?.systemPrompt?.trim() || selectedAgent.systemPrompt,
          customSystemPrompt:
            !!sessionDetail?.systemPrompt?.trim() &&
            sessionDetail.systemPrompt !== selectedAgent.systemPrompt,
        }));
      });
    } else {
      startTransition(() => {
        setChatConfig(resolveNewChatConfig(loadDefaultChatConfig(), selectedAgent));
      });
    }
  }, [effectiveSessionId, selectedAgent, sessionDetail?.model, sessionDetail?.systemPrompt]);

  useEffect(() => {
    // 仅在会话结构变化时滚动；token 逐字更新不触发 smooth scroll（避免视觉抖动）
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messageGroups.length, optimistic.length, isStreaming]);

  const updateConfig = useCallback(
    (patch: Partial<ChatSessionConfig>) => {
      setChatConfig((prev) => {
        const next = { ...prev, ...patch };
        if (effectiveSessionId) saveSessionChatConfig(effectiveSessionId, next);
        else saveDefaultChatConfig(next);
        if (effectiveSessionId && (patch.model || patch.systemPrompt !== undefined)) {
          updateSession.mutate({
            id: effectiveSessionId,
            ...(patch.model ? { model: patch.model } : {}),
            ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
          });
        }
        return next;
      });
    },
    [effectiveSessionId, updateSession],
  );

  const resetPromptToAgent = () => {
    if (!selectedAgent) return;
    updateConfig({ systemPrompt: selectedAgent.systemPrompt, customSystemPrompt: false });
  };

  const runStream = useCallback(
    async (opts: {
      message?: string;
      attachments?: ChatQueueItem["attachments"];
      regenerate?: boolean;
      regenerateUserMessageId?: string;
      retryFromMessageId?: string;
      editMessageId?: string;
      editContent?: string;
      skillId?: string;
      skillPrompt?: string;
      source?: "user" | "super" | "manager" | "sub" | "system";
      optimisticUser?: { id: string; text: string };
    }) => {
      // 捕获本次流式所属的 session（新会话首条消息时为 null，onDone 拿到 sessionId 后迁移键）
      let originSid = effectiveSessionId ?? NEW_STREAM_KEY;
      // 仅中止同一 session 上已有的流式（支持多 session 并发流式，互不干扰）
      getAbort(originSid)?.abort();
      const ac = new AbortController();
      getStreamState(originSid).abort = ac;

      ssSet(originSid, "isStreaming", true);
      ssSet(originSid, "streamingContent", "");
      ssSet(originSid, "liveTimeline", [{ type: "thinking", content: "", round: 1 }]);
      // 重试/重生成/编辑：定位到原 user 消息所在 group 原位流式，替换旧 assistant 气泡；
      // 新消息：null，流式气泡落列表底部。
      ssSet(originSid, "streamTargetUserId",
        opts.retryFromMessageId ?? opts.regenerateUserMessageId ?? opts.editMessageId ?? null,
      );
      ssSet(originSid, "lastRoundTokens", 0);
      ssSet(originSid, "error", null);
      setEditingUserId(null);

      const streamConfig = buildStreamConfig(
        {
          ...chatConfig,
          ...(opts.skillPrompt
            ? { systemPrompt: opts.skillPrompt, customSystemPrompt: true }
            : {}),
        },
        selectedAgent ? { systemPrompt: selectedAgent.systemPrompt } : undefined,
      );

      try {
        await streamAgentChat(
          {
            sessionId: effectiveSessionId ?? undefined,
            agentId: effectiveAgentId || undefined,
            message: opts.message,
            attachments: opts.attachments?.map(({ name, mimeType, previewUrl, extractedText, source }) => ({
              name,
              mimeType,
              previewUrl: previewUrl ?? "",
              extractedText,
              source,
            })),
            regenerate: opts.regenerate,
            regenerateUserMessageId: opts.regenerateUserMessageId,
            retryFromMessageId: opts.retryFromMessageId,
            editMessageId: opts.editMessageId,
            editContent: opts.editContent,
            skillId: opts.skillId,
            source: opts.source,
            ...streamConfig,
          },
          {
            onRoundStart: (round) =>
              ssSet(originSid, "liveTimeline", (prev) => {
                if (prev.length === 1 && prev[0]?.type === "thinking" && !prev[0].content) {
                  return [{ type: "thinking" as const, content: "", round }];
                }
                return [...prev, { type: "thinking" as const, content: "", round }];
              }),
            onThinking: (delta) => {
              ssSet(originSid, "liveTimeline", (prev) => {
                const copy = [...prev];
                for (let i = copy.length - 1; i >= 0; i--) {
                  const step = copy[i];
                  if (step.type === "thinking") {
                    copy[i] = { type: "thinking", content: step.content + delta, round: step.round };
                    return copy;
                  }
                }
                return [...copy, { type: "thinking", content: delta, round: 1 }];
              });
            },
            onToken: (delta) => {
              // rAF 合并：累积 delta 到下一帧单次写入，避免每字符一次 setState
              pendingStreamDeltaRef.current.set(
                originSid,
                (pendingStreamDeltaRef.current.get(originSid) ?? "") + delta,
              );
              scheduleStreamFlush(originSid);
            },
            onIntermediateContent: (content, round) => {
              // 工具轮次中的中间正式回复 → 进导轨时间线（无圆点），不进最终气泡
              ssSet(originSid, "liveTimeline", (prev) => {
                if (prev.some((s) => s.type === "content" && s.round === round)) return prev;
                return [...prev, { type: "content" as const, content, round }];
              });
            },
            onToolStart: (name, args, round, toolCallId) => {
              ssSet(originSid, "liveTimeline", (prev) => [...prev, { type: "tool", toolCallId, name, args, round, status: "running" }]);
            },
            onToolEnd: (name, result, round, hint, toolCallId) => {
              ssSet(originSid, "liveTimeline", (prev) =>
                prev.map((s) =>
                  s.type === "tool" && s.toolCallId === toolCallId && s.status === "running"
                    ? { ...s, result, hint: hint ?? formatToolResultHint(result), status: "done" }
                    : s,
                ),
              );
              if (name === "run_async" && result && typeof result === "object") {
                const r = result as { jobId?: string; status?: string; message?: string };
                if (r.jobId && r.status === "running") {
                  ssSet(originSid, "asyncOverlays", (prev) => {
                    if (prev.some((q) => q.jobId === r.jobId)) return prev;
                    return [
                      {
                        id: `run-${r.jobId}`,
                        kind: "async-running" as const,
                        text: r.message || "",
                        jobId: r.jobId,
                        taskLabel: r.message?.slice(0, 60),
                        status: "running" as const,
                        createdAt: Date.now(),
                      },
                      ...prev,
                    ];
                  });
                }
              }
            },
            onDone: async (data) => {
              // 新会话首条消息：originSid 是临时键，拿到真实 sessionId 后迁移状态
              if (originSid === NEW_STREAM_KEY && data.sessionId) {
                const prev = streamStatesRef.current.get(NEW_STREAM_KEY);
                if (prev) {
                  streamStatesRef.current.set(data.sessionId, prev);
                  streamStatesRef.current.delete(NEW_STREAM_KEY);
                }
                // 把待写 delta 的 rAF 键也迁移到真实 sessionId，避免最后一批 token 丢失
                flushStreamNow(originSid);
                originSid = data.sessionId;
              } else {
                flushStreamNow(originSid);
              }
              setSessionId(data.sessionId);
              if (data.tokenUsage?.total) ssSet(originSid, "lastRoundTokens", data.tokenUsage.total);
              if (opts.skillPrompt) {
                updateConfig({ systemPrompt: opts.skillPrompt, customSystemPrompt: true });
              }
              // 用 data.sessionId 显式拉取会话详情，避免 refetchSession 在
              // setSessionId 异步生效前用 null id 打 tRPC（控制台报错 + 短暂不同步）
              if (data.sessionId) {
                await utils.session.getById.fetch({ id: data.sessionId }).catch(() => {
                  // 拉取失败不阻塞 UI，下个 render 会因 enabled 查询自动重试
                });
              }
              // 延后清空，避免与 tool_end 的 setState 同批提交导致 hint 从未挂载
              setTimeout(() => {
                ssSet(originSid, "liveTimeline", []);
                ssSet(originSid, "streamingContent", "");
              }, 0);
              if (opts.optimisticUser) {
                ssSet(originSid, "optimistic", (prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
              }
              void utils.session.list.invalidate();
            },
            onError: (message, sid, suggestion) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                const prev = streamStatesRef.current.get(NEW_STREAM_KEY);
                if (prev) {
                  streamStatesRef.current.set(sid, prev);
                  streamStatesRef.current.delete(NEW_STREAM_KEY);
                }
                discardStreamFlush(originSid);
                originSid = sid;
              } else {
                discardStreamFlush(originSid);
              }
              if (opts.optimisticUser) ssSet(originSid, "optimistic", (prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
              ssSet(originSid, "error", message + (suggestion ? `\n${suggestion}` : ""));
              if (sid) setSessionId(sid);
              ssSet(originSid, "liveTimeline", []);
              ssSet(originSid, "streamingContent", "");
            },
          },
          ac.signal,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // 用户点击停止：先把待写 token 落地（保留中断前的部分内容），再延后清空
          flushStreamNow(originSid);
          // 保持当前流式 UI，等后端保存中断消息并刷新会话后再清空
          setTimeout(async () => {
            await refetchSession();
            ssSet(originSid, "liveTimeline", []);
            ssSet(originSid, "streamingContent", "");
            if (opts.optimisticUser) {
              ssSet(originSid, "optimistic", (prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
            }
          }, 500);
          return;
        }
        discardStreamFlush(originSid);
        ssSet(originSid, "error", err instanceof Error ? err.message : "对话请求失败");
        ssSet(originSid, "liveTimeline", []);
        ssSet(originSid, "streamingContent", "");
      } finally {
        // 安全清理：onDone/onError 已处理过则此处为 no-op；streamAgentChat 抛错未触发回调时兜底
        discardStreamFlush(originSid);
        ssSet(originSid, "isStreaming", false);
        ssSet(originSid, "streamTargetUserId", null);
        const st = getStreamState(originSid);
        st.abort = null;
        st.queueDraining = false;
        const finishedTaskId = st.activeQueueTaskId;
        if (finishedTaskId) {
          st.activeQueueTaskId = null;
          ssSet(originSid, "asyncOverlays", (prev) => prev.filter((i) => i.id !== finishedTaskId));
        }
        consumeRef.current();
      }
    },
    [effectiveAgentId, chatConfig, refetchSession, effectiveSessionId, updateConfig, utils.session.list, utils.session.getById, selectedAgent, getStreamState, ssSet, getAbort, scheduleStreamFlush, flushStreamNow, discardStreamFlush],
  );

  const consumeQueue = useCallback(() => {
    const sid = effectiveSessionId ?? NEW_STREAM_KEY;
    const st = getStreamState(sid);
    if (isSessionStreaming(effectiveSessionId) || st.queueDraining) return;

    // 两阶段优先消费：asyncResultQueue（异步任务结果）优先于 userQueue（用户消息）
    // 两个物理独立队列，不混排，保证优先级绝对正确
    const isReady = (t: ChatQueueItem) =>
      t.kind !== "async-running" &&
      (t.text.trim() || t.asyncResult || t.attachments?.length);

    // 1. 先查 asyncResultQueue 中的可消费 async-result
    let asyncReady: ChatQueueItem | undefined;
    for (const t of asyncResultQueue) {
      if (t.kind === "async-result" && isReady(t)) { asyncReady = t; break; }
    }
    // 2. 再查 userQueue 中的可消费 user 消息
    let userReady: ChatQueueItem | undefined;
    if (!asyncReady) {
      for (const t of st.userQueue) {
        if (t.kind === "user" && isReady(t)) { userReady = t; break; }
      }
    }
    const task = asyncReady ?? userReady;
    if (!task) return;

    st.queueDraining = true;

    if (task.kind === "async-result" && task.jobId) {
      ssSet(sid, "consumedDeliveries", (s: Set<string>) => new Set(s).add(task.jobId!));
    }

    if (task.kind === "user") {
      // 用户消息：从 userQueue 移除
      ssSet(sid, "userQueue", (prev) => prev.filter((i) => i.id !== task.id));
    } else {
      // async-result：标记 consumedDeliveries（已上面处理），asyncOverlays 中对应的 overlay 也清除
      st.activeQueueTaskId = task.id;
      if (task.jobId) {
        ssSet(sid, "asyncOverlays", (prev) => prev.filter((o) => o.jobId !== task.jobId));
      }
    }

    // runStream 会在开头设置 isStreaming=true；此处无需预置（多 session 隔离下避免污染其他 session）

    const supportsVision = !!getModelOption(chatConfig.model).supportsVision;
    // 统一走 formatQueueItemForLlm：async-result 的 asyncResult 块 + OCR 附件文本都由它拼装。
    // 之前非 vision 分支只取 task.text，导致异步结果内容被整体丢弃（空消息报错，主 Agent 收不到结果）。
    const streamMessage =
      formatQueueItemForLlm(task, supportsVision) ||
      (task.attachments?.length ? "（见附件）" : "");
    const streamAttachments = task.attachments?.map(
      ({ id, name, mimeType, previewUrl, extractedText, source }) => ({
        id,
        name,
        mimeType,
        previewUrl: previewUrl ?? "",
        extractedText,
        source,
      }),
    );
    const optimisticId = `opt-${task.id}`;
    const optimisticText =
      task.text.trim() ||
      (task.kind === "async-result" ? `[后台任务完成] ${task.taskLabel ?? task.jobId ?? ""}` : "") ||
      (task.attachments?.length ? "（见附件）" : "");
    const optimisticAttachments = streamAttachments?.length ? streamAttachments : undefined;
    ssSet(sid, "optimistic", (o) =>
      o.some((m) => m.id === optimisticId)
        ? o
        : [...o, { id: optimisticId, content: optimisticText, attachments: optimisticAttachments }],
    );
    void runStream({
      message: streamMessage,
      attachments: streamAttachments?.length ? streamAttachments : undefined,
      skillId: task.skillId,
      skillPrompt: task.skillPrompt,
      source: task.kind === "async-result" ? "super" : "user",
      optimisticUser: { id: optimisticId, text: optimisticText },
    });
  }, [runStream, chatConfig.model, asyncResultQueue, effectiveSessionId, isSessionStreaming, ssSet, getStreamState]);

  useEffect(() => {
    consumeRef.current = consumeQueue;
  }, [consumeQueue]);

  useEffect(() => {
    if (!isSessionStreaming(effectiveSessionId)) {
      // queueMicrotask 避免在 effect 同步阶段调用 setState，防止级联渲染
      queueMicrotask(() => consumeRef.current());
    }
  }, [isStreaming, queue.length, consumeQueue, effectiveSessionId, isSessionStreaming]);

  // 切换视图 session 时，从后台状态 Map 镜像该 session 的流式状态到视图
  useEffect(() => {
    applyView(effectiveSessionId);
  }, [effectiveSessionId, applyView]);

  // 流式 rAF 卸载清理：组件卸载时取消所有待处理动画帧，避免 setState after unmount
  useEffect(() => {
    const rafMap = streamRafRef.current;
    const deltaMap = pendingStreamDeltaRef.current;
    return () => {
      rafMap.forEach((id) => cancelAnimationFrame(id));
      rafMap.clear();
      deltaMap.clear();
    };
  }, []);

  // Ctrl+Shift+S 快捷键打开新建子代理弹窗
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        setShowCreateSubagent(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const enqueueMessage = (
    text: string,
    skill?: SelectedSkill,
    attachments?: ChatQueueItem["attachments"],
  ) => {
    const trimmed = text.trim();
    if ((!trimmed && !attachments?.length) || backendDown) return;
    // 输入框清空由 ChatInputArea 内部完成（value 状态已下放）
    const skillPrompt = skill
      ? `# Skill: ${skill.name}\n\n${skill.description}\n\n${skill.code}`
      : undefined;
    ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "userQueue", (prev) => [
      ...prev,
      createUserQueueItem(trimmed || "（见附件）", {
        skillId: skill?.id,
        skillPrompt,
        attachments,
      }),
    ]);
  };

  const handleRegenerate = (userMessageId: string) => {
    if (!effectiveSessionId || isSessionStreaming(effectiveSessionId)) return;
    void runStream({ regenerate: true, regenerateUserMessageId: userMessageId });
  };

  const handleRetry = (messageId: string) => {
    if (!effectiveSessionId || isSessionStreaming(effectiveSessionId)) return;
    void runStream({ retryFromMessageId: messageId });
  };

  const handleEditConfirm = (userMessageId: string) => {
    const content = editDraft.trim();
    if (!content || isSessionStreaming(effectiveSessionId)) return;
    void runStream({ editMessageId: userMessageId, editContent: content });
  };

  const handleSwitchVersion = async (assistantMessageId: string, versionIndex: number) => {
    if (isSessionStreaming(effectiveSessionId)) return;
    await switchVersion.mutateAsync({ messageId: assistantMessageId, versionIndex });
    await refetchSession();
  };

  const handleCopy = async (id: string, content: string) => {
    if (await copyToClipboard(content)) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const handleShare = async (content: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text: content });
        return;
      }
    } catch {
      /* fallback to copy */
    }
    if (await copyToClipboard(content)) {
      setCopiedId("share");
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const startNewChat = useCallback(() => {
    // 新建对话不中止任何已有 session 的流式（多 session 并发隔离）
    setSessionId(null);
    setAgentId("");
    // 输入框 value 已下放到 ChatInputArea，由其 key={effectiveSessionId ?? "new"}
    // 在切换/新建会话时整体 remount 自动清空，无需在此手动 reset。
    setSelectedSkill(null);
    setEditingSessionId(null);
    setChatConfig(resolveNewChatConfig(loadDefaultChatConfig(), selectedAgent));
    // 清空新会话临时状态，避免上一次新建会话的残留 optimistic/queue 污染下一次
    streamStatesRef.current.delete(NEW_STREAM_KEY);
    // 视图切到空会话（applyView(null) 会读取已清空的 NEW_STREAM_KEY）
    applyView(null);
    // 清除 URL 中的 sessionId/agentId，确保新建对话不受旧参数束缚
    const params = new URLSearchParams(searchParams.toString());
    let changed = false;
    if (params.get("sessionId")) {
      params.delete("sessionId");
      changed = true;
    }
    if (params.get("agentId")) {
      params.delete("agentId");
      changed = true;
    }
    if (changed) {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [selectedAgent, searchParams, pathname, router, applyView]);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    try {
      const res = await updateSession.mutateAsync({ id, title: trimmed });
      if (!res.success) {
        setError(res.error?.message ?? "重命名失败");
        return;
      }
      void utils.session.list.invalidate();
      if (effectiveSessionId === id) void refetchSession();
      setEditingSessionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重命名失败");
    }
  }, [updateSession, utils.session.list, effectiveSessionId, refetchSession]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      const res = await deleteSession.mutateAsync({ id });
      if (!res.success) {
        setError(res.error?.message ?? "删除失败");
        setDeleteSessionTarget(null);
        return;
      }
      void utils.session.list.invalidate();
      if (effectiveSessionId === id) startNewChat();
      setDeleteSessionTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setDeleteSessionTarget(null);
    }
  }, [deleteSession, effectiveSessionId, startNewChat, utils.session.list]);

  const selectSession = useCallback((id: string) => {
    if (effectiveSessionId === id) return;
    // 多 session 隔离：切换会话只切视图，不中止任何 session 的流式。
    // 流式状态 + 队列按 sessionId 存在 streamStatesRef，applyView 镜像目标 session 的状态到视图。
    // 切回仍在流式的 session 时能看到流式继续；已完成的能看到从 DB 加载的完整回复。
    setSessionId(id);
    setAgentId("");
    setEditingSessionId(null);
    setSelectedSkill(null);
    applyView(id);
    // 切换会话后同步 URL sessionId，移除 agentId，避免 URL 参数覆盖用户选择
    const params = new URLSearchParams(searchParams.toString());
    params.set("sessionId", id);
    if (params.get("agentId")) params.delete("agentId");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [effectiveSessionId, applyView, searchParams, pathname, router]);

  const selectAgent = useCallback((id: string) => {
    setAgentId(id);
    const agent = agentsQuery.data?.items.find((a: Agent) => a.id === id);
    if (agent && !chatConfig.customSystemPrompt) {
      updateConfig({ systemPrompt: agent.systemPrompt, model: agent.model });
    }
    // 同步 URL：用户显式选择后，移除可能覆盖选择的 agentId 参数
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("agentId")) {
      params.delete("agentId");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [agentsQuery.data?.items, chatConfig.customSystemPrompt, updateConfig, searchParams, pathname, router]);

  // 会话列表项交互回调：保持引用稳定，避免每次输入都触发所有 SessionListItem 重渲染
  const handleSessionSelect = useCallback((id: string) => {
    if (bulkMode) {
      setBulkSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      selectSession(id);
    }
  }, [bulkMode, selectSession]);

  const handleStartRename = useCallback((id: string) => {
    setEditingSessionId(id);
    const s = sessionsQuery.data?.items.find((x) => x.id === id);
    setRenameDraft(s?.title ?? "");
  }, [sessionsQuery.data?.items]);

  const renameDraftRef = useRef(renameDraft);
  useEffect(() => {
    renameDraftRef.current = renameDraft;
  }, [renameDraft]);
  const handleConfirmRename = useCallback((id: string) => {
    void handleRenameSession(id, renameDraftRef.current);
  }, [handleRenameSession]);

  const handleCancelRename = useCallback(() => {
    setEditingSessionId(null);
  }, []);

  const handleRequestDelete = useCallback((id: string) => {
    const s = sessionsQuery.data?.items.find((x) => x.id === id);
    if (s) setDeleteSessionTarget({ id: s.id, title: s.title });
  }, [sessionsQuery.data?.items]);

  const hasMessages = messageGroups.length > 0 || optimistic.length > 0 || isStreaming;
  const showLiveStream = isStreaming || liveTimeline.length > 0 || !!streamingContent;
  const lastGroupIndex = messageGroups.length - 1;

  const renderIntermediateSteps = (group: MessageGroup) => {
    const active = getActiveVersion(group);
    if (!active) return null;
    const steps = buildTimelineFromStored(active.toolCalls);
    if (!steps.length) return null;
    return (
      <div className="flex w-full justify-start">
        <ThinkingTimeline steps={steps} isLive={false} />
      </div>
    );
  };

  const renderAssistantBubble = (group: MessageGroup) => {
    const active = getActiveVersion(group);
    if (!active || !group.assistantMessage) return null;
    const assistantId = group.assistantMessage.id;
    const isInterrupted = group.assistantMessage.finishReason === "aborted";

    return (
      <motion.div
        key={`a-${assistantId}`}
        initial={false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        data-testid="assistant-message-bubble"
        data-nav-id={assistantId}
        className="group/msg relative mb-6 ml-6 flex max-w-[88%] flex-col items-start gap-1"
      >
        <div className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-sm text-[var(--kp-text-1)] shadow-sm">
          <PostContent content={active.content} className="prose-sm max-w-none" />
          {isInterrupted && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-600">
              <Ban className="h-3 w-3" />
              <span>已停止生成</span>
            </div>
          )}
        </div>

        <MessageActions
          onCopy={() => void handleCopy(assistantId, active.content)}
          onShare={() => void handleShare(active.content)}
          onRegenerate={() => handleRegenerate(group.userMessage.id)}
          showRegenerate
          showEdit={false}
          showRetry={false}
          disabled={isStreaming}
          copied={copiedId === assistantId}
          versionNav={
            group.versions.length > 1 ? (
              <MessageVersions
                current={group.activeVersionIndex}
                total={group.versions.length}
                onPrev={() => void handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex - 1)}
                onNext={() => void handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex + 1)}
              />
            ) : null
          }
        />
      </motion.div>
    );
  };

  // 流式渲染块：思考时间线 + 实时 assistant 气泡。重试/重生成/编辑时原位调用，
  // 新消息时在列表底部调用。
  const renderLiveStreamBlock = () => (
    <>
      {showLiveStream && liveTimeline.length > 0 && (
        <div className="flex w-full justify-start">
          <ThinkingTimeline steps={liveTimeline} isLive />
        </div>
      )}
      {showLiveStream && (
        <div className="flex w-full justify-start">
          <div
            className={cn(
              "group/msg ml-6 flex max-w-[88%] flex-col items-start gap-1",
              streamingContent ? "mb-6" : "mb-4",
            )}
            data-testid="streaming-assistant-bubble"
          >
            {streamingContent ? (
              <div className="min-h-[3rem] w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-sm text-[var(--kp-text-1)] shadow-sm">
                <PostContent content={streamingContent} className="prose-sm max-w-none" />
              </div>
            ) : liveTimeline.length === 0 ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] px-4 py-2 text-xs text-[var(--kp-text-2)] shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--kp-brand)]" />
                Thinking…
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className={cn("flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] transition-all duration-300", leftOpen ? "w-64" : "w-0 overflow-hidden border-r-0")}>
        <div className="w-64 shrink-0 border-b border-[var(--kp-divider)] px-3 py-2.5" data-testid="chat-left-panel-header">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-[var(--kp-text-1)]">
                {selectedAgent?.name ?? "assistant"}
              </div>
              <div className="truncate text-[10px] text-[var(--kp-text-3)]">{chatConfig.model}</div>
            </div>
          </div>
          {(() => {
            const pills = (skillsQuery.data?.items ?? []).filter((s) => s.enabled).slice(0, 3);
            if (pills.length === 0) return null;
            return (
              <div className="mt-2 flex flex-wrap gap-1">
                {pills.map((s) => {
                  const active = selectedSkill?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSkill(active ? null : { id: s.id, name: s.name, icon: s.icon, description: s.description, code: s.code })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition",
                        active
                          ? "bg-[var(--kp-brand)] text-white"
                          : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-soft)]",
                      )}
                      title={s.description}
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      <span className="max-w-[5rem] truncate">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
        <SubagentPanel
          parentSessionId={effectiveSessionId ?? undefined}
          onCreate={() => setShowCreateSubagent(true)}
          onOpenSubagent={selectSession}
        />
        <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">对话历史</h2>
          <div className="flex items-center gap-0.5">
            {/* #11 批量管理模式切换 */}
            <button
              type="button"
              onClick={() => {
                setBulkMode((v) => !v);
                setBulkSelected(new Set());
              }}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "h-8 w-8",
                bulkMode && "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]",
              )}
              aria-label="批量管理"
              title="批量管理会话"
            >
              <ListChecks className="h-4 w-4" />
            </button>
            <button type="button" onClick={startNewChat} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")} aria-label="新建对话" title="新建对话（发送首条消息时创建）">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* 批量操作条 */}
        {bulkMode && (
          <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] bg-[var(--kp-brand-soft)]/30 px-3 py-2 text-xs">
            <span className="text-[var(--kp-text-2)]">已选 {bulkSelected.size}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setBulkSelected(new Set(filteredSessions.map((s) => s.id)))}
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
              >
                全选
              </button>
              <button
                type="button"
                disabled={bulkSelected.size === 0 || bulkDeleteMutation.isPending}
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                {bulkDeleteMutation.isPending ? "删除中…" : "删除所选"}
              </button>
            </div>
          </div>
        )}
        <div className="w-64 border-b border-[var(--kp-divider)] px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--kp-text-3)]" />
            <input
              type="search"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="搜索会话…"
              data-testid="session-search"
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[var(--kp-brand)]"
            />
          </div>
        </div>
        <div className="w-64 flex-1 overflow-y-auto p-2" data-testid="session-list">
          {hasWorkspaces ? (
            /* Swarm 模式：Workspace → Agent → Session 三层树 */
            <WorkspaceTree
              effectiveSessionId={effectiveSessionId}
              onSelectSession={selectSession}
              onSelectAgent={(id) => {
                selectAgent(id);
              }}
              onNewChat={startNewChat}
              searchQuery={sessionSearch}
            />
          ) : (
            /* 非 swarm 模式：回退到扁平 session 列表 */
            <>
              {filteredSessions.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-[var(--kp-text-3)]">
                  {sessionSearch.trim() ? "无匹配会话" : "暂无对话"}
                </p>
              )}
              {groupedSessions.map((group) => (
                <div key={group.key} className="mb-3">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
                    {group.label}
                  </p>
                  {group.items.map((s) => (
                    <div key={s.id} className={cn(bulkMode && "flex items-center gap-1.5")}>
                      {bulkMode && (
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(s.id)}
                          onChange={(e) => {
                            setBulkSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id);
                              else next.delete(s.id);
                              return next;
                            });
                          }}
                          className="ml-1 h-3.5 w-3.5 shrink-0 accent-[var(--kp-brand)]"
                          aria-label={`选择会话 ${s.title}`}
                        />
                      )}
                      <div className={cn(bulkMode && "min-w-0 flex-1")}>
                        <SessionListItem
                          session={s}
                          active={effectiveSessionId === s.id}
                          editing={editingSessionId === s.id}
                          renameDraft={renameDraft}
                          onSelect={handleSessionSelect}
                          onStartRename={handleStartRename}
                          onRenameDraftChange={setRenameDraft}
                          onConfirmRename={handleConfirmRename}
                          onCancelRename={handleCancelRename}
                          onDelete={handleRequestDelete}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[var(--kp-divider)] px-4 py-2.5">
          <button type="button" onClick={() => setLeftOpen((v) => !v)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}>
            <PanelLeft className="h-4 w-4" />
          </button>
          <Bot className="h-5 w-5 shrink-0 text-[var(--kp-brand)]" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">
              {sessionDetail?.title ?? "Agent 对话"}
            </h1>
            <p className="truncate text-xs text-[var(--kp-text-3)]">
              {selectedAgent?.name ?? "—"} · {chatConfig.model}
              {queue.length > 0 && ` · 队列 ${queue.length}`}
            </p>
          </div>
          {effectiveSessionId && sessionDetail && (
            <SessionContextBar
              messages={sessionDetail.messages ?? []}
              systemPrompt={chatConfig.systemPrompt}
              className="hidden shrink-0 lg:flex"
            />
          )}
          {agentsQuery.data?.items && (
            <AgentTreeSelect
              value={effectiveAgentId}
              onChange={selectAgent}
              agents={agentsQuery.data.items.map((a: Agent) => ({
                id: a.id,
                name: a.name,
                tier: a.tier,
                parentId: a.parentId,
                status: a.status,
              }))}
              className="max-w-[180px]"
              aria-label="选择 Agent"
            />
          )}
          <Link href="/agents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:flex text-xs")}>Agent 管理</Link>
          <button type="button" onClick={() => setRightOpen((v) => !v)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}>
            <PanelRight className="h-4 w-4" />
          </button>
        </header>

        {isSubagentSession && (
          <div
            data-testid="subagent-context-bar"
            className="flex items-center gap-2 border-b border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/40 px-4 py-1.5 text-xs"
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-dark)]" />
            <span className="font-medium text-[var(--kp-brand-dark)]">子代理任务</span>
            {sessionDetail?.taskDescription && (
              <span className="min-w-0 flex-1 truncate text-[var(--kp-text-2)]">
                {sessionDetail.taskDescription}
              </span>
            )}
            {parentSessionId && (
              <Link
                href={`/chat?sessionId=${parentSessionId}`}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[var(--kp-brand-dark)] hover:bg-[var(--kp-brand-soft)]"
                title="返回父会话"
              >
                <ArrowLeft className="h-3 w-3" />
                来自会话{parentSession?.title ? ` · ${parentSession.title.slice(0, 16)}` : ""}
              </Link>
            )}
          </div>
        )}

        {effectiveSessionId && sessionDetail && (
          <div className="flex border-b border-[var(--kp-divider)] px-4 py-2 lg:hidden">
            <SessionContextBar
              messages={sessionDetail.messages ?? []}
              systemPrompt={chatConfig.systemPrompt}
            />
          </div>
        )}

        {backendDown && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>后端未连接，请运行 <code className="rounded bg-amber-100 px-1">pnpm dev</code></span>
          </div>
        )}

        <div className="relative flex min-h-0 flex-1">
          <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {!hasMessages && !backendDown && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-[var(--kp-text-3)]">
              <Bot className="mb-1 h-12 w-12 opacity-40" />
              <p className="text-sm">发送第一条消息开始对话</p>
              {/* #12 Swarm 新手引导：无 Workspace 时展示（可关闭，localStorage 记忆） */}
              {!hasWorkspaces && (
                <div ref={onboardingRef} className="relative max-w-md hidden rounded-2xl border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/30 p-4 text-left" data-testid="swarm-onboarding">
                  <button
                    type="button"
                    onClick={dismissSwarmOnboarding}
                    className="absolute right-2 top-2 rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
                    aria-label="关闭引导"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <p className="mb-1.5 text-xs font-semibold text-[var(--kp-text-1)]">试试 Agent Swarm</p>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--kp-text-2)]">
                    <li>· 右上角选择「KnowPilot 超级 Agent」，让它替你管理其他 Agent</li>
                    <li>· 对它说「创建一个 XX 工作区」，它会自动生成管理 Agent</li>
                    <li>· 也可以在 <Link href="/workspaces" className="text-[var(--kp-brand-dark)] underline">工作区管理页</Link> 手动创建</li>
                    <li>· 长任务会派生子代理后台执行，完成后结果自动回到对话</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {messageGroups.map((group, groupIdx) => {
            const isLastUser = groupIdx === lastGroupIndex;
            const isEditing = editingUserId === group.userMessage.id;
            const msgSource = (group.userMessage as { source?: string }).source ?? "user";
            // #24 子代理会话中，父 Agent 下发的任务消息视觉上像用户消息（右侧），
            // 但用角标标识为「父代理」；其他非 user 来源仍显示在左侧。
            const isParentAgentTask = isSubagentSession && msgSource === "super";
            const isAgentMessage = msgSource !== "user" && !isParentAgentTask;
            return (
              <div key={group.userMessage.id} className="flex flex-col">
                <div className={cn("flex w-full", isAgentMessage ? "justify-start" : "justify-end")}>
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  data-testid="user-message-bubble"
                  className={cn(
                    "group/msg relative mb-3 flex max-w-[70%] flex-col gap-1",
                    isAgentMessage ? "items-start self-start" : "items-end self-end",
                  )}
                >
                  {group.userMessage.attachments && group.userMessage.attachments.length > 0 && !isEditing && (
                    <div className="mb-1.5 flex flex-wrap justify-end gap-2">
                      {group.userMessage.attachments.map((att) => (
                        <div
                          key={att.previewUrl}
                          className="relative overflow-hidden rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] shadow-sm"
                          title={att.extractedText ? `OCR 识别 · ${att.extractedText.slice(0, 120)}` : att.name}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={att.previewUrl}
                            alt={att.name}
                            className="max-h-40 max-w-[min(100%,16rem)] object-contain"
                          />
                          {att.source === "ocr" && att.extractedText && (
                            <span className="absolute bottom-0 left-0 right-0 inline-flex items-center gap-0.5 truncate bg-emerald-600/80 px-1.5 py-0.5 text-[9px] text-white">
                              OCR <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={cn(
                    "relative w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl px-4 py-3 text-sm shadow-sm",
                    isAgentMessage
                      ? "bg-[var(--kp-bg-alt)] text-[var(--kp-text-1)] border border-[var(--kp-divider)]"
                      : "bg-[var(--kp-brand)] text-white",
                  )}>
                    <MessageSourceLabel
                      source={msgSource}
                      isSubagentSession={isSubagentSession}
                      align={isParentAgentTask ? "right" : "left"}
                    />
                      {group.userMessage.skillName && (
                        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                          <LucideIconByName name={group.userMessage.skillIcon} className="h-3 w-3" />
                          {group.userMessage.skillName}
                        </span>
                      )}
                      {isEditing ? (
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={Math.max(1, editDraft.split("\n").length)}
                          className="block w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed text-white outline-none placeholder:text-white/50 [field-sizing:content]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleEditConfirm(group.userMessage.id);
                            }
                            if (e.key === "Escape") setEditingUserId(null);
                          }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{group.userMessage.content}</p>
                      )}
                    </div>
                  <MessageActions
                    onCopy={() => void handleCopy(group.userMessage.id, isEditing ? editDraft : group.userMessage.content)}
                    onShare={() => void handleShare(isEditing ? editDraft : group.userMessage.content)}
                    onEdit={() => {
                      setEditingUserId(group.userMessage.id);
                      setEditDraft(group.userMessage.content);
                    }}
                    onEditSave={() => handleEditConfirm(group.userMessage.id)}
                    onEditCancel={() => setEditingUserId(null)}
                    onRetry={() => handleRetry(group.userMessage.id)}
                    showEdit={isLastUser}
                    showRetry={!isEditing}
                    showRegenerate={false}
                    isEditing={isEditing}
                    disabled={isStreaming}
                    copied={copiedId === group.userMessage.id}
                  />
                </motion.div>
                </div>
                {isStreaming && streamTargetUserId === group.userMessage.id
                  ? renderLiveStreamBlock()
                  : (
                      <>
                        {renderIntermediateSteps(group)}
                        <div className="flex w-full justify-start">
                        {renderAssistantBubble(group)}
                        </div>
                      </>
                    )}
              </div>
            );
          })}

          {optimistic.map((msg) => (
            <div key={msg.id} className="mb-4 flex justify-end">
              <div className="flex max-w-[70%] flex-col items-end gap-1.5">
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {msg.attachments.map((att) => (
                      <div
                        key={att.previewUrl}
                        className="relative overflow-hidden rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] shadow-sm"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          className="max-h-40 max-w-[min(100%,16rem)] object-contain opacity-80"
                        />
                        {att.source === "ocr" && att.extractedText && (
                          <span className="absolute bottom-0 left-0 right-0 inline-flex items-center gap-0.5 truncate bg-emerald-600/80 px-1.5 py-0.5 text-[9px] text-white">
                            OCR <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl bg-[var(--kp-brand)] px-4 py-3 text-sm text-white opacity-80">
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            </div>
          ))}

          {showLiveStream && !streamTargetUserId && renderLiveStreamBlock()}

          <div ref={bottomRef} />
          </div>
          <MessageNavRail items={navItems} />
        </div>

        {error && (
          <div
            className="mx-4 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800"
            data-testid="chat-error-banner"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold">请求失败</p>
                <p className="whitespace-pre-wrap leading-relaxed opacity-90">{error}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/* 错误可操作化：按错误类型提供针对性动作（#14） */}
                {error.includes("预算") && (
                  <Link
                    href="/settings"
                    className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-red-100"
                  >
                    查看预算设置
                  </Link>
                )}
                {(error.includes("超时") || error.includes("timeout")) && (
                  <button
                    type="button"
                    onClick={() => {
                      // 超时 → 建议转后台任务：把上一条用户消息包装成 run_async 请求重新入队
                      const lastGroup = messageGroups[messageGroups.length - 1];
                      const lastText = lastGroup?.userMessage.content;
                      if (lastText) {
                        ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "userQueue", (prev) => [
                          ...prev,
                          createUserQueueItem(`请用 run_async 在后台执行这个任务（避免前台超时）：\n${lastText}`),
                        ]);
                        ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "error", null);
                      }
                    }}
                    className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-red-100"
                  >
                    转后台重试
                  </button>
                )}
                {lastUserMessageId && (
                  <button
                    type="button"
                    onClick={() => handleRetry(lastUserMessageId)}
                    className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-red-100"
                  >
                    重试
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <MessageQueue
          items={queue}
          panelOpen={queuePanelOpen}
          onPanelOpenChange={setQueuePanelOpen}
          onChange={(items) => {
            // 用户编辑队列后，拆成 userQueue + asyncOverlays 两个物理独立队列
            const { userQueue: uq, asyncOverlays: ao } = splitQueueByKind(items, asyncQueueQuery.data);
            ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "userQueue", uq);
            ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "asyncOverlays", ao);
          }}
          onRemove={(id) => {
            // 从对应队列移除（userQueue 或 asyncOverlays）
            ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "userQueue", (q) => q.filter((t) => t.id !== id));
            ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "asyncOverlays", (q) => q.filter((t) => t.id !== id));
          }}
          onCancel={(jobId) => cancelAsyncJobMutation.mutate({ jobId })}
          onRetry={(jobId) => {
            ssSet(effectiveSessionId ?? NEW_STREAM_KEY, "consumedDeliveries", (prev: Set<string>) => new Set([...prev, jobId]));
            retryAsyncJobMutation.mutate({ jobId });
          }}
          onOpenSubagent={selectSession}
          asyncStats={asyncQueueStatsQuery.data}
          settingsPanelOpen={rightOpen}
          settingsPanelWidth={360}
        />

        <div className="border-t border-[var(--kp-divider)] px-4 py-3 md:px-6">
          <ChatInputArea
            key={effectiveSessionId ?? "new"}
            onSend={enqueueMessage}
            onStop={() => getAbort(effectiveSessionId)?.abort()}
            disabled={backendDown}
            isStreaming={isStreaming}
            queueLength={queue.filter((q) => q.kind === "user").length}
            skills={skillsQuery.data?.items ?? []}
            selectedSkill={selectedSkill}
            onSkillChange={setSelectedSkill}
            modelHint={modelOpt.inputHint ?? (modelOpt.supportsVision ? "多模态 · 支持图片" : "纯文本 · 图片将 OCR 后发送")}
            modelId={chatConfig.model}
            supportsVision={!!modelOpt.supportsVision}
            sessionHint={
              isSubagentSession
                ? "这是子代理任务会话。你直接发送的消息只在本会话内处理，不会回传父会话；只有父 Agent 下发的任务结果才会投递回父会话。"
                : undefined
            }
            sessionId={effectiveSessionId}
          />
        </div>
      </div>

      <aside
        className={cn(
          "relative z-40 flex shrink-0 flex-col border-l border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 backdrop-blur-xl transition-[width] duration-300 ease-[var(--kp-spring-gentle)]",
          rightOpen ? "w-[360px]" : "w-0 overflow-hidden border-l-0",
        )}
      >
        <AnimatePresence mode="wait">
          {rightOpen && (
            <motion.div
              key="settings-panel"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-full flex-col"
            >
              <ChatSettingsPanel
                chatConfig={chatConfig}
                updateConfig={updateConfig}
                resetPromptToAgent={resetPromptToAgent}
                onOpenPromptEditor={() => setShowPromptEditor(true)}
                skills={skillsQuery.data?.items ?? []}
                selectedSkill={selectedSkill}
                onSelectSkill={setSelectedSkill}
                modelSupportsReasoning={!!(modelOpt.supportsThinking ?? modelOpt.supportsReasoning)}
                modelReasoningRequired={!!modelOpt.reasoningRequired}
                tokenBudget={tokenBudget}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </aside>

      {showPromptEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">编辑 System Prompt</h3>
              <button type="button" onClick={() => setShowPromptEditor(false)}><X className="h-4 w-4" /></button>
            </div>
            <textarea value={chatConfig.systemPrompt} onChange={(e) => updateConfig({ systemPrompt: e.target.value, customSystemPrompt: true })} rows={12} className="m-4 flex-1 resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-sm outline-none" />
            <div className="flex justify-end border-t px-4 py-3">
              <button type="button" onClick={() => setShowPromptEditor(false)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>完成</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteSessionTarget}
        title="删除会话"
        description={`确定删除「${deleteSessionTarget?.title ?? ""}」？所有消息将被永久删除。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => deleteSessionTarget && void handleDeleteSession(deleteSessionTarget.id)}
        onCancel={() => setDeleteSessionTarget(null)}
      />

      {/* #11 批量删除确认 */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        title="批量删除会话"
        description={`确定删除所选的 ${bulkSelected.size} 个会话？所有消息将被永久删除。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => {
          const ids = [...bulkSelected];
          setShowBulkDeleteConfirm(false);
          bulkDeleteMutation.mutate(
            { ids },
            {
              onSuccess: (res) => {
                setToast(`已删除 ${res.deleted} 个会话`);
                setTimeout(() => setToast(null), 2500);
                setBulkSelected(new Set());
                setBulkMode(false);
                if (effectiveSessionId && ids.includes(effectiveSessionId)) startNewChat();
                void utils.session.list.invalidate();
              },
            },
          );
        }}
        onCancel={() => setShowBulkDeleteConfirm(false)}
      />

      <SubagentCreateDialog
        open={showCreateSubagent}
        parentSessionId={effectiveSessionId ?? undefined}
        onClose={() => setShowCreateSubagent(false)}
        onCreated={() => setToast("子代理任务已启动，结果完成后自动进入对话")}
      />

      {toast && (
        <div
          data-testid="chat-toast"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--kp-brand-light)] bg-[var(--kp-bg-alt)] px-4 py-2 text-xs text-[var(--kp-text-1)] shadow-lg"
        >
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[var(--kp-brand)]" />
            {toast}
          </span>
        </div>
      )}
    </div>
  );
}
