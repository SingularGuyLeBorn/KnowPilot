"use client";

/**
 * Agent Chat — 三栏布局 · 多版本 · 消息编辑 · Skill / 触发
 */

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Ban,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
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
import { LucideIconByName, ChatShortcutHints } from "@/lib/icons";
import { cn, formatRelativeTime, groupBySessionDate } from "@/lib/utils";
import { type Agent, type ChatSession, type ChatSessionConfig, type ChatImageAttachment } from "@knowpilot/shared";
import { buttonVariants } from "@/components/ui/button";
import { PostContent } from "@/components/post/PostContent";
import { KpSelect, ConfirmDialog } from "@/components/shared";
import { SessionContextBar } from "@/components/sessionContextUsage";
import { ChatInputArea, type SelectedSkill } from "@/components/chatInput";
import { ChatSettingsPanel } from "@/components/chatSettingsPanel";
import { buildTokenBudget } from "@/components/tokenBudgetBar";
import {
  type ChatQueueItem,
  createUserQueueItem,
  formatQueueItemForLlm,
  mergeAsyncPollIntoQueue,
  extractLocalQueueFromMerged,
  sortQueueItems,
} from "@/lib/chatQueueTypes";
import { MessageQueue } from "@/components/chatQueue";

/* ─── Sub-components ─── */

function ThinkingTimeline({
  steps,
  isLive = false,
}: {
  steps: TimelineStep[];
  isLive?: boolean;
}) {
  if (!steps.length) return null;

  return (
    <div className="mb-4 space-y-3" data-testid="thinking-timeline">
      {steps.map((step, i) => (
        <div
          key={step.type === "tool" ? step.toolCallId : `${step.type}-${step.round}-${i}`}
          className="relative border-l-2 border-[var(--kp-brand-light)]/50 pl-3"
        >
          <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--kp-brand)] ring-2 ring-[var(--kp-bg-alt)]" />
          {step.type === "thinking" ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--kp-text-2)]">
                <span className="rounded-full bg-[var(--kp-brand-soft)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--kp-brand-dark)]">
                  推理
                </span>
                <span>第 {step.round} 轮</span>
                {isLive && i === steps.length - 1 && step.type === "thinking" && (
                  <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-brand)]" />
                )}
              </div>
              {step.content.trim() ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--kp-bg)]/80 px-3 py-2 text-xs leading-relaxed text-[var(--kp-text-2)]">
                  {step.content}
                </pre>
              ) : isLive ? (
                <p className="text-xs text-[var(--kp-text-3)]">思考中…</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--kp-text-2)]">
                  工具
                </span>
                <span
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                    step.status === "running"
                      ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                      : "bg-[var(--kp-bg-soft)] text-[var(--kp-text-2)]",
                  )}
                  data-testid="tool-pill"
                >
                  <Wrench className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {step.name.replace(/^skill__/, "Skill · ").replace(/^mcp__/, "MCP · ")}
                  </span>
                  {step.status === "running" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                  {step.status === "done" && !isLive && (
                    <span className="text-[9px] text-[var(--kp-brand-dark)]">完成</span>
                  )}
                  {step.status === "done" && (step.hint || formatToolResultHint(step.result)) && (
                    <span
                      className={cn(
                        "text-[9px]",
                        step.result &&
                          typeof step.result === "object" &&
                          step.result !== null &&
                          "error" in (step.result as Record<string, unknown>)
                          ? "text-red-600"
                          : "text-[var(--kp-text-3)]",
                      )}
                      data-testid="tool-timing-hint"
                    >
                      {step.hint || formatToolResultHint(step.result)}
                    </span>
                  )}
                </span>
              </div>
              <details className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/60 px-3 py-2">
                <summary className="cursor-pointer text-[10px] text-[var(--kp-text-3)] hover:text-[var(--kp-brand-dark)]">
                  参数与结果
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--kp-text-3)]">
                  {JSON.stringify(step.args, null, 2)}
                </pre>
                {step.result !== undefined && (
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap border-t border-[var(--kp-divider-light)] pt-2 text-[10px] text-[var(--kp-text-2)]">
                    {JSON.stringify(step.result, null, 2)}
                  </pre>
                )}
              </details>
            </div>
          )}
        </div>
      ))}
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

function SessionListItem({
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
  onSelect: () => void;
  onStartRename: () => void;
  onRenameDraftChange: (v: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
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
            if (e.key === "Enter") { e.preventDefault(); onConfirmRename(); }
            if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
          }}
        />
        <button
          type="button"
          onClick={onConfirmRename}
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
        onClick={onSelect}
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
          onClick={onStartRename}
          className="rounded-md p-1.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
          aria-label="重命名"
          title="重命名"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDelete}
          className="rounded-md p-1.5 text-[var(--kp-text-3)] hover:bg-red-50 hover:text-red-600"
          aria-label="删除"
          title="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Main ─── */

export function ChatView() {
  const searchParams = useSearchParams();
  const agentFromUrl = searchParams.get("agentId");
  const sessionFromUrl = searchParams.get("sessionId");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{ id: string; content: string; attachments?: ChatImageAttachment[] }[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [liveTimeline, setLiveTimeline] = useState<TimelineStep[]>([]);
  const [lastRoundTokens, setLastRoundTokens] = useState(0);
  const [localQueue, setLocalQueue] = useState<ChatQueueItem[]>([]);
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

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const consumeRef = useRef<() => void>(() => {});
  const queueDrainingRef = useRef(false);
  const isStreamingRef = useRef(false);
  const localQueueRef = useRef<ChatQueueItem[]>([]);
  const activeQueueTaskIdRef = useRef<string | null>(null);
  const consumedDeliveriesRef = useRef<Set<string>>(new Set());

  const { useList: useAgentList } = useAgent();
  const agentsQuery = useAgentList({ page: 1, pageSize: 50 });
  const skillsQuery = trpc.skill.list.useQuery({ page: 1, pageSize: 100, enabled: true });
  const sessionsQuery = trpc.session.list.useQuery({ page: 1, pageSize: 40 });
  const providers = trpc.agent.llmProviders.useQuery();
  const utils = trpc.useUtils();
  const updateSession = trpc.session.update.useMutation();
  const deleteSession = trpc.session.delete.useMutation();
  const switchVersion = trpc.message.switchVersion.useMutation();

  const defaultAgentId = useMemo(() => {
    const items = agentsQuery.data?.items;
    if (!items?.length) return "";
    const assistant = items.find((a: Agent) => a.name === "assistant");
    return assistant?.id ?? items[0].id;
  }, [agentsQuery.data?.items]);

  const effectiveSessionId = sessionFromUrl ?? sessionId;

  const { data: sessionDetail, refetch: refetchSession } = trpc.session.getById.useQuery(
    { id: effectiveSessionId! },
    { enabled: !!effectiveSessionId },
  );

  const effectiveAgentId =
    agentFromUrl ?? (agentId || sessionDetail?.agentId || defaultAgentId);

  const backendDown = agentsQuery.isError || sessionsQuery.isError || providers.isError;

  const asyncQueueQuery = trpc.agent.pullAsyncQueue.useQuery(
    { sessionId: effectiveSessionId! },
    {
      enabled: !!effectiveSessionId && !backendDown,
      refetchInterval: (query) => (query.state.error ? 10000 : 2500),
    },
  );

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

  const queue = useMemo(
    () =>
      mergeAsyncPollIntoQueue(localQueue, asyncQueueQuery.data, {
        skipDeliveryJobIds: consumedDeliveries,
      }),
    [localQueue, asyncQueueQuery.data, consumedDeliveries],
  );

  useEffect(() => {
    localQueueRef.current = localQueue;
  }, [localQueue]);

  useEffect(() => {
    consumedDeliveriesRef.current = consumedDeliveries;
  }, [consumedDeliveries]);

  // 按会话持久化已消费的异步投递，刷新页面后不再显示旧结果
  useEffect(() => {
    if (!effectiveSessionId) return;
    const key = `kp:consumed-deliveries:${effectiveSessionId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        // 从外部存储恢复已消费的异步投递；eslint 规则不适用于这种外部系统同步
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConsumedDeliveries(new Set(JSON.parse(saved)));
      }
    } catch {
      // ignore
    }
  }, [effectiveSessionId]);

  useEffect(() => {
    if (!effectiveSessionId) return;
    const key = `kp:consumed-deliveries:${effectiveSessionId}`;
    try {
      localStorage.setItem(key, JSON.stringify([...consumedDeliveries]));
    } catch {
      // ignore
    }
  }, [effectiveSessionId, consumedDeliveries]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const selectedAgent = agentsQuery.data?.items.find((a: Agent) => a.id === effectiveAgentId);
  const modelOpt = getModelOption(chatConfig.model);

  const messageGroups = useMemo(
    () => buildMessageGroups(sessionDetail?.messages ?? []),
    [sessionDetail?.messages],
  );

  const filteredSessions = useMemo(() => {
    const items = sessionsQuery.data?.items ?? [];
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) => s.title.toLowerCase().includes(q) || s.model.toLowerCase().includes(q),
    );
  }, [sessionsQuery.data?.items, sessionSearch]);

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
          setChatConfig(resolveNewChatConfig(saved, selectedAgent));
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
      optimisticUser?: { id: string; text: string };
    }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      isStreamingRef.current = true;
      setIsStreaming(true);
      setStreamingContent("");
      setLiveTimeline([{ type: "thinking", content: "", round: 1 }]);
      setLastRoundTokens(0);
      setError(null);
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
            ...streamConfig,
          },
          {
            onRoundStart: (round) =>
              setLiveTimeline((prev) => {
                if (prev.length === 1 && prev[0]?.type === "thinking" && !prev[0].content) {
                  return [{ type: "thinking" as const, content: "", round }];
                }
                return [...prev, { type: "thinking" as const, content: "", round }];
              }),
            onThinking: (delta) => {
              setLiveTimeline((prev) => {
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
            onToken: (delta) => setStreamingContent((prev) => prev + delta),
            onToolStart: (name, args, round, toolCallId) => {
              setLiveTimeline((prev) => [...prev, { type: "tool", toolCallId, name, args, round, status: "running" }]);
            },
            onToolEnd: (name, result, round, hint, toolCallId) => {
              setLiveTimeline((prev) =>
                prev.map((s) =>
                  s.type === "tool" && s.toolCallId === toolCallId && s.status === "running"
                    ? { ...s, result, hint: hint ?? formatToolResultHint(result), status: "done" }
                    : s,
                ),
              );
              if (name === "run_async" && result && typeof result === "object") {
                const r = result as { jobId?: string; status?: string; message?: string };
                if (r.jobId && r.status === "running") {
                  setLocalQueue((prev) => {
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
              setSessionId(data.sessionId);
              if (data.tokenUsage?.total) setLastRoundTokens(data.tokenUsage.total);
              if (opts.skillPrompt) {
                updateConfig({ systemPrompt: opts.skillPrompt, customSystemPrompt: true });
              }
              await refetchSession();
              // 延后清空，避免与 tool_end 的 setState 同批提交导致 hint 从未挂载
              setTimeout(() => setLiveTimeline([]), 0);
              if (opts.optimisticUser) {
                setOptimistic((prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
              }
              void utils.session.list.invalidate();
            },
            onError: (message, sid, suggestion) => {
              if (opts.optimisticUser) setOptimistic((prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
              setError(message + (suggestion ? `\n${suggestion}` : ""));
              if (sid) setSessionId(sid);
              setTimeout(() => setLiveTimeline([]), 0);
            },
          },
          ac.signal,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          setLiveTimeline([]);
          // 给后端一点时间保存中断消息，然后刷新会话
          setTimeout(() => void refetchSession(), 500);
          if (opts.optimisticUser) {
            setOptimistic((prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
          }
          return;
        }
        setError(err instanceof Error ? err.message : "对话请求失败");
        setLiveTimeline([]);
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
        setStreamingContent("");
        queueDrainingRef.current = false;
        const finishedTaskId = activeQueueTaskIdRef.current;
        if (finishedTaskId) {
          activeQueueTaskIdRef.current = null;
          setLocalQueue((prev) => prev.filter((i) => i.id !== finishedTaskId));
        }
        consumeRef.current();
      }
    },
    [effectiveAgentId, chatConfig, refetchSession, effectiveSessionId, updateConfig, utils.session.list, selectedAgent],
  );

  const consumeQueue = useCallback(() => {
    if (isStreamingRef.current || queueDrainingRef.current) return;

    const pollData = asyncQueueQuery.data;
    const merged = mergeAsyncPollIntoQueue(localQueueRef.current, pollData, {
      skipDeliveryJobIds: consumedDeliveriesRef.current,
    });
    const sorted = sortQueueItems(merged);
    const readyIdx = sorted.findIndex(
      (t) =>
        t.kind !== "async-running" &&
        (t.text.trim() || t.asyncResult || t.attachments?.length),
    );
    if (readyIdx < 0) return;

    queueDrainingRef.current = true;
    const task = sorted[readyIdx];

    if (task.kind === "async-result" && task.jobId) {
      setConsumedDeliveries((s) => new Set(s).add(task.jobId!));
    }

    if (task.kind === "user") {
      // 已发出即离开队列，气泡区由 optimistic / session 消息展示
      setLocalQueue((prev) => prev.filter((i) => i.id !== task.id));
    } else {
      activeQueueTaskIdRef.current = task.id;
      const restMerged = sorted.filter((_, i) => i !== readyIdx);
      setLocalQueue(extractLocalQueueFromMerged(restMerged, pollData));
    }

    isStreamingRef.current = true;

    const supportsVision = !!getModelOption(chatConfig.model).supportsVision;
    const streamMessage = supportsVision
      ? formatQueueItemForLlm(task, true)
      : task.text.trim() || (task.attachments?.length ? "（见附件）" : "");
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
    const optimisticText = task.text.trim() || (task.attachments?.length ? "（见附件）" : "");
    const optimisticAttachments = streamAttachments?.length ? streamAttachments : undefined;
    setOptimistic((o) =>
      o.some((m) => m.id === optimisticId)
        ? o
        : [...o, { id: optimisticId, content: optimisticText, attachments: optimisticAttachments }],
    );
    void runStream({
      message: streamMessage,
      attachments: streamAttachments?.length ? streamAttachments : undefined,
      skillId: task.skillId,
      skillPrompt: task.skillPrompt,
      optimisticUser: { id: optimisticId, text: optimisticText },
    });
  }, [runStream, chatConfig.model, asyncQueueQuery.data]);

  useEffect(() => {
    consumeRef.current = consumeQueue;
  }, [consumeQueue]);

  useEffect(() => {
    if (!isStreaming) consumeQueue();
  }, [isStreaming, queue.length, consumeQueue]);

  const enqueueMessage = (
    text: string,
    skill?: SelectedSkill,
    attachments?: ChatQueueItem["attachments"],
  ) => {
    const trimmed = text.trim();
    if ((!trimmed && !attachments?.length) || backendDown) return;
    setInput("");
    const skillPrompt = skill
      ? `# Skill: ${skill.name}\n\n${skill.description}\n\n${skill.code}`
      : undefined;
    setLocalQueue((prev) => [
      ...prev,
      createUserQueueItem(trimmed || "（见附件）", {
        skillId: skill?.id,
        skillPrompt,
        attachments,
      }),
    ]);
  };

  const handleRegenerate = (userMessageId: string) => {
    if (!effectiveSessionId || isStreaming) return;
    void runStream({ regenerate: true, regenerateUserMessageId: userMessageId });
  };

  const handleRetry = (messageId: string) => {
    if (!effectiveSessionId || isStreaming) return;
    void runStream({ retryFromMessageId: messageId });
  };

  const handleEditConfirm = (userMessageId: string) => {
    const content = editDraft.trim();
    if (!content || isStreaming) return;
    void runStream({ editMessageId: userMessageId, editContent: content });
  };

  const handleSwitchVersion = async (assistantMessageId: string, versionIndex: number) => {
    if (isStreaming) return;
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

  const startNewChat = () => {
    abortRef.current?.abort();
    setSessionId(null);
    setInput("");
    setError(null);
    setOptimistic([]);
    setLocalQueue([]);
    setConsumedDeliveries(new Set());
    setSelectedSkill(null);
    setEditingSessionId(null);
    setChatConfig(resolveNewChatConfig(loadDefaultChatConfig(), selectedAgent));
  };

  const handleRenameSession = async (id: string, title: string) => {
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
  };

  const handleDeleteSession = async (id: string) => {
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
  };

  const selectSession = (id: string) => {
    setSessionId(id);
    setAgentId("");
    setOptimistic([]);
    setError(null);
    setLocalQueue([]);
    setConsumedDeliveries(new Set());
    setEditingSessionId(null);
  };

  const selectAgent = (id: string) => {
    setAgentId(id);
    const agent = agentsQuery.data?.items.find((a: Agent) => a.id === id);
    if (agent && !chatConfig.customSystemPrompt) {
      updateConfig({ systemPrompt: agent.systemPrompt, model: agent.model });
    }
    if (effectiveSessionId) {
      updateSession.mutate({ id: effectiveSessionId, agentId: id });
    }
  };

  const hasMessages = messageGroups.length > 0 || optimistic.length > 0 || isStreaming;
  const showLiveStream = isStreaming || liveTimeline.length > 0;
  const lastGroupIndex = messageGroups.length - 1;

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
        className="group/msg relative mb-6 flex max-w-[88%] flex-col items-start gap-1"
      >
        <div className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-sm text-[var(--kp-text-1)] shadow-sm">
          {buildTimelineFromStored(active.toolCalls).length > 0 && (
            <ThinkingTimeline steps={buildTimelineFromStored(active.toolCalls)} isLive={false} />
          )}
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

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className={cn("flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] transition-all duration-300", leftOpen ? "w-64" : "w-0 overflow-hidden border-r-0")}>
        <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">对话历史</h2>
          <button type="button" onClick={startNewChat} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")} aria-label="新建对话" title="新建对话（发送首条消息时创建）">
            <Plus className="h-4 w-4" />
          </button>
        </div>
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
                <SessionListItem
                  key={s.id}
                  session={s}
                  active={effectiveSessionId === s.id}
                  editing={editingSessionId === s.id}
                  renameDraft={renameDraft}
                  onSelect={() => selectSession(s.id)}
                  onStartRename={() => {
                    setEditingSessionId(s.id);
                    setRenameDraft(s.title);
                  }}
                  onRenameDraftChange={setRenameDraft}
                  onConfirmRename={() => void handleRenameSession(s.id, renameDraft)}
                  onCancelRename={() => setEditingSessionId(null)}
                  onDelete={() => setDeleteSessionTarget({ id: s.id, title: s.title })}
                />
              ))}
            </div>
          ))}
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
            <KpSelect
              value={effectiveAgentId}
              onChange={selectAgent}
              options={agentsQuery.data.items.map((a: Agent) => ({
                value: a.id,
                label: a.name,
              }))}
              size="sm"
              className="max-w-[140px]"
              aria-label="选择 Agent"
            />
          )}
          <Link href="/agents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:flex text-xs")}>Agent 管理</Link>
          <button type="button" onClick={() => setRightOpen((v) => !v)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}>
            <PanelRight className="h-4 w-4" />
          </button>
        </header>

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

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {!hasMessages && !backendDown && (
            <div className="flex h-full flex-col items-center justify-center text-center text-[var(--kp-text-3)]">
              <Bot className="mb-3 h-12 w-12 opacity-40" />
              <ChatShortcutHints className="justify-center" />
            </div>
          )}

          {messageGroups.map((group, groupIdx) => {
            const isLastUser = groupIdx === lastGroupIndex;
            const isEditing = editingUserId === group.userMessage.id;
            return (
              <div key={group.userMessage.id} className="flex flex-col">
                <div className="flex w-full justify-end">
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  data-testid="user-message-bubble"
                  className="group/msg relative mb-3 flex max-w-[70%] flex-col items-end gap-1 self-end"
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
                            <span className="absolute bottom-0 left-0 right-0 truncate bg-emerald-600/80 px-1.5 py-0.5 text-[9px] text-white">
                              OCR ✓
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl bg-[var(--kp-brand)] px-4 py-3 text-sm text-white shadow-sm">
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
                <div className="flex w-full justify-start">
                {renderAssistantBubble(group)}
                </div>
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
                          <span className="absolute bottom-0 left-0 right-0 truncate bg-emerald-600/80 px-1.5 py-0.5 text-[9px] text-white">
                            OCR ✓
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

          {showLiveStream && (
            <div
              className="group/msg mb-6 flex max-w-[88%] flex-col items-start gap-1"
              data-testid="streaming-assistant-bubble"
            >
              <div className="min-h-[3rem] w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-sm text-[var(--kp-text-1)] shadow-sm">
                {liveTimeline.length > 0 && <ThinkingTimeline steps={liveTimeline} isLive />}
                {streamingContent ? (
                  <PostContent content={streamingContent} className="prose-sm max-w-none" />
                ) : liveTimeline.length === 0 ? (
                  <div className="flex items-center gap-2 text-[var(--kp-text-3)]">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--kp-brand)]" />
                    Agent 思考中…
                  </div>
                ) : null}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
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
              {lastUserMessageId && (
                <button
                  type="button"
                  onClick={() => handleRetry(lastUserMessageId)}
                  className="shrink-0 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-red-100"
                >
                  重试
                </button>
              )}
            </div>
          </div>
        )}

        <MessageQueue
          items={queue}
          panelOpen={queuePanelOpen}
          onPanelOpenChange={setQueuePanelOpen}
          onChange={(items) =>
            setLocalQueue(extractLocalQueueFromMerged(items, asyncQueueQuery.data))
          }
          onRemove={(id) => setLocalQueue((q) => q.filter((t) => t.id !== id))}
          onCancel={(jobId) => cancelAsyncJobMutation.mutate({ jobId })}
          onRetry={(jobId) => {
            setConsumedDeliveries((prev) => new Set([...prev, jobId]));
            retryAsyncJobMutation.mutate({ jobId });
          }}
          settingsPanelOpen={rightOpen}
          settingsPanelWidth={360}
        />

        <div className="border-t border-[var(--kp-divider)] px-4 py-3 md:px-6">
          <ChatInputArea
            value={input}
            onChange={setInput}
            onSend={enqueueMessage}
            onStop={() => abortRef.current?.abort()}
            disabled={backendDown}
            isStreaming={isStreaming}
            queueLength={queue.filter((q) => q.kind === "user").length}
            skills={skillsQuery.data?.items ?? []}
            selectedSkill={selectedSkill}
            onSkillChange={setSelectedSkill}
            modelHint={modelOpt.inputHint ?? (modelOpt.supportsVision ? "多模态 · 支持图片" : "纯文本 · 图片将 OCR 后发送")}
            modelId={chatConfig.model}
            supportsVision={!!modelOpt.supportsVision}
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
    </div>
  );
}
