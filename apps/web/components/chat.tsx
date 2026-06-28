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
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAgent } from "@/lib/hooks";
import { streamAgentChat, copyToClipboard } from "@/lib/agentStream";
import {
  buildStreamConfig,
  getModelOption,
  loadDefaultChatConfig,
  loadSessionChatConfig,
  saveDefaultChatConfig,
  saveSessionChatConfig,
} from "@/lib/chatConfig";
import {
  buildMessageGroups,
  buildTimelineFromStored,
  getActiveVersion,
  type MessageGroup,
  type TimelineStep,
} from "@/lib/chatMessageUtils";
import { LucideIconByName, ChatShortcutHints } from "@/lib/icons";
import { cn, formatRelativeTime, groupBySessionDate } from "@/lib/utils";
import { type Agent, type ChatSessionConfig } from "@knowpilot/shared";
import { buttonVariants } from "@/components/ui/button";
import { PostContent } from "@/components/post/PostContent";
import { ChatInputArea, type SelectedSkill } from "@/components/chatInput";
import { ChatSettingsPanel } from "@/components/chatSettingsPanel";
import { buildTokenBudget } from "@/components/tokenBudgetBar";

const msgSpring = { type: "spring" as const, stiffness: 280, damping: 28 };

type QueuedTask = { id: string; text: string; skillId?: string; skillPrompt?: string };

/* ─── Sub-components ─── */

function ThinkingTimeline({
  steps,
  isLive = false,
}: {
  steps: TimelineStep[];
  isLive?: boolean;
}) {
  const hasRunning = steps.some((s) => s.type === "tool" && s.status === "running");
  const hasThinkingText = steps.some((s) => s.type === "thinking" && s.content.trim().length > 0);
  const [open, setOpen] = useState(isLive || hasRunning || hasThinkingText);
  if (!steps.length) return null;

  const toolCount = steps.filter((s) => s.type === "tool").length;
  const thinkCount = steps.filter((s) => s.type === "thinking").length;
  const summary =
    thinkCount && toolCount
      ? `${thinkCount} 轮推理 · ${toolCount} 次工具`
      : thinkCount
        ? `${thinkCount} 轮推理`
        : `${toolCount} 次工具`;

  return (
    <div className="mb-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)]/60 p-2" data-testid="thinking-timeline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-[var(--kp-text-3)] hover:text-[var(--kp-brand-dark)]"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>推理 · 工具 · 观察</span>
        <span className="rounded-full bg-[var(--kp-bg)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--kp-text-2)]">
          {steps.length}
        </span>
        {isLive && hasRunning && <Loader2 className="ml-auto h-3 w-3 animate-spin text-[var(--kp-brand)]" />}
        {!open && <span className="ml-auto truncate text-[10px] font-normal opacity-70">{summary}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="rounded-lg bg-[var(--kp-bg)] p-2 text-xs">
              {step.type === "thinking" ? (
                <>
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--kp-brand-dark)]">
                    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">
                      推理
                    </span>
                    <span>第 {step.round} 轮</span>
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[var(--kp-text-2)]">{step.content}</pre>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">
                      工具
                    </span>
                    <span
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        step.status === "running"
                          ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                          : step.status === "done"
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)]",
                      )}
                      data-testid="tool-pill"
                    >
                      <Wrench className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {step.name.replace(/^skill__/, "Skill · ").replace(/^mcp__/, "MCP · ")}
                      </span>
                      {step.status === "running" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                      {step.status === "done" && !isLive && (
                        <span className="text-[9px] opacity-80">完成</span>
                      )}
                    </span>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-[var(--kp-text-3)] hover:text-[var(--kp-brand-dark)]">
                      <span className="mr-1 rounded bg-amber-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                        观察
                      </span>
                      参数与结果
                    </summary>
                    <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap opacity-70">
                      {JSON.stringify(step.args, null, 2)}
                    </pre>
                    {step.result !== undefined && (
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap border-t border-[var(--kp-divider)] pt-1 text-[var(--kp-text-2)]">
                        {JSON.stringify(step.result, null, 2).slice(0, 2000)}
                      </pre>
                    )}
                  </details>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageVersions({
  current,
  total,
  onPrev,
  onNext,
  onRegenerate,
  isStreaming,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onRegenerate: () => void;
  isStreaming: boolean;
}) {
  if (total <= 1 && isStreaming) {
    return (
      <div className="mt-2 flex items-center gap-1 text-xs text-[var(--kp-text-3)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        生成中…
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--kp-divider)] pt-2">
      {total > 1 && (
        <div className="flex items-center gap-1 text-xs text-[var(--kp-text-3)]">
          <button type="button" onClick={onPrev} disabled={current <= 0} className="rounded p-1 hover:bg-[var(--kp-bg-mute)] disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>{current + 1} / {total}</span>
          <button type="button" onClick={onNext} disabled={current >= total - 1} className="rounded p-1 hover:bg-[var(--kp-bg-mute)] disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {!isStreaming && (
        <button type="button" onClick={onRegenerate} className="flex items-center gap-1 text-xs text-[var(--kp-brand-dark)] hover:underline">
          <RotateCcw className="h-3 w-3" />
          重新生成
        </button>
      )}
    </div>
  );
}

function MessageActions({
  onCopy,
  onEdit,
  onRetry,
  showEdit = true,
  showRetry = true,
  disabled,
}: {
  onCopy: () => void;
  onEdit?: () => void;
  onRetry?: () => void;
  showEdit?: boolean;
  showRetry?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto">
      <button
        type="button"
        onClick={onCopy}
        disabled={disabled}
        className="rounded-md p-1.5 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:pointer-events-none disabled:opacity-40"
        title="复制"
        aria-label="复制"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {showEdit && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="rounded-md p-1.5 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:pointer-events-none disabled:opacity-40"
          title="编辑"
          aria-label="编辑"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={disabled}
          className="rounded-md p-1.5 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:pointer-events-none disabled:opacity-40"
          title="重试"
          aria-label="重试"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
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
  const [optimistic, setOptimistic] = useState<{ id: string; content: string }[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [liveTimeline, setLiveTimeline] = useState<TimelineStep[]>([]);
  const [lastRoundTokens, setLastRoundTokens] = useState(0);
  const [queue, setQueue] = useState<QueuedTask[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [chatConfig, setChatConfig] = useState<ChatSessionConfig>(() => loadDefaultChatConfig());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SelectedSkill | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const consumeRef = useRef<() => void>(() => {});
  const queueDrainingRef = useRef(false);

  const { useList: useAgentList } = useAgent();
  const agentsQuery = useAgentList({ page: 1, pageSize: 50 });
  const skillsQuery = trpc.skill.list.useQuery({ page: 1, pageSize: 100, enabled: true });
  const sessionsQuery = trpc.session.list.useQuery({ page: 1, pageSize: 40 });
  const providers = trpc.agent.llmProviders.useQuery();
  const utils = trpc.useUtils();
  const updateSession = trpc.session.update.useMutation();
  const switchVersion = trpc.message.switchVersion.useMutation();

  const defaultAgentId = useMemo(() => {
    const items = agentsQuery.data?.items;
    if (!items?.length) return "";
    const assistant = items.find((a: Agent) => a.name === "assistant");
    return assistant?.id ?? items[0].id;
  }, [agentsQuery.data?.items]);

  const effectiveSessionId = sessionFromUrl ?? sessionId;
  const effectiveAgentId = agentFromUrl ?? (agentId || defaultAgentId);

  const { data: sessionDetail, refetch: refetchSession } = trpc.session.getById.useQuery(
    { id: effectiveSessionId! },
    { enabled: !!effectiveSessionId },
  );

  const backendDown = agentsQuery.isError || sessionsQuery.isError || providers.isError;
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
    if (!effectiveSessionId || !selectedAgent) return;
    const saved = loadSessionChatConfig(effectiveSessionId);
    startTransition(() => {
      if (saved) {
        setChatConfig(saved);
        return;
      }
      setChatConfig((prev) => ({
        ...prev,
        model: sessionDetail?.model ?? selectedAgent.model,
        systemPrompt: sessionDetail?.systemPrompt ?? selectedAgent.systemPrompt,
        customSystemPrompt: !!sessionDetail?.systemPrompt && sessionDetail.systemPrompt !== selectedAgent.systemPrompt,
      }));
    });
  }, [effectiveSessionId, selectedAgent, sessionDetail?.model, sessionDetail?.systemPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageGroups, optimistic, isStreaming, streamingContent, liveTimeline]);

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

      setIsStreaming(true);
      setStreamingContent("");
      setLiveTimeline([{ type: "thinking", content: "", round: 1 }]);
      setLastRoundTokens(0);
      setError(null);
      setEditingUserId(null);

      const streamConfig = buildStreamConfig({
        ...chatConfig,
        ...(opts.skillPrompt
          ? { systemPrompt: opts.skillPrompt, customSystemPrompt: true }
          : {}),
      });

      try {
        await streamAgentChat(
          {
            sessionId: effectiveSessionId ?? undefined,
            agentId: effectiveAgentId || undefined,
            message: opts.message,
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
            onToolStart: (name, args, round) => {
              setLiveTimeline((prev) => [...prev, { type: "tool", name, args, round, status: "running" }]);
            },
            onToolEnd: (name, result, round) => {
              setLiveTimeline((prev) =>
                prev.map((s) =>
                  s.type === "tool" && s.name === name && s.round === round && s.status === "running"
                    ? { ...s, result, status: "done" }
                    : s,
                ),
              );
            },
            onDone: async (data) => {
              setSessionId(data.sessionId);
              if (data.tokenUsage?.total) setLastRoundTokens(data.tokenUsage.total);
              if (opts.optimisticUser) {
                setOptimistic((prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
              }
              if (opts.skillPrompt) {
                updateConfig({ systemPrompt: opts.skillPrompt, customSystemPrompt: true });
              }
              setStreamingContent("");
              setLiveTimeline([]);
              await refetchSession();
              void utils.session.list.invalidate();
            },
            onError: (message, sid, suggestion) => {
              if (opts.optimisticUser) setOptimistic((prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
              setError(message + (suggestion ? `\n${suggestion}` : ""));
              if (sid) setSessionId(sid);
            },
          },
          ac.signal,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "对话请求失败");
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        queueDrainingRef.current = false;
        consumeRef.current();
      }
    },
    [effectiveAgentId, chatConfig, refetchSession, effectiveSessionId, updateConfig, utils.session.list],
  );

  const consumeQueue = useCallback(() => {
    if (isStreaming || queueDrainingRef.current) return;
    queueDrainingRef.current = true;
    setQueue((prev) => {
      if (prev.length === 0) {
        queueDrainingRef.current = false;
        return prev;
      }
      const [task, ...rest] = prev;
      const optimisticId = `opt-${task.id}`;
      setOptimistic((o) => (o.some((m) => m.id === optimisticId) ? o : [...o, { id: optimisticId, content: task.text }]));
      void runStream({
        message: task.text,
        skillId: task.skillId,
        skillPrompt: task.skillPrompt,
        optimisticUser: { id: optimisticId, text: task.text },
      });
      return rest;
    });
  }, [isStreaming, runStream]);

  useEffect(() => {
    consumeRef.current = consumeQueue;
  }, [consumeQueue]);

  useEffect(() => {
    if (!isStreaming) consumeQueue();
  }, [isStreaming, queue.length, consumeQueue]);

  const enqueueMessage = (text: string, skill?: SelectedSkill) => {
    const trimmed = text.trim();
    if (!trimmed || backendDown) return;
    setInput("");
    const skillPrompt = skill
      ? `# Skill: ${skill.name}\n\n${skill.description}\n\n${skill.code}`
      : undefined;
    setQueue((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, text: trimmed, skillId: skill?.id, skillPrompt },
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

  const startNewChat = () => {
    abortRef.current?.abort();
    setSessionId(null);
    setInput("");
    setError(null);
    setOptimistic([]);
    setQueue([]);
    setSelectedSkill(null);
    setChatConfig(loadDefaultChatConfig());
  };

  const selectAgent = (id: string) => {
    setAgentId(id);
    const agent = agentsQuery.data?.items.find((a: Agent) => a.id === id);
    if (agent && !chatConfig.customSystemPrompt) {
      updateConfig({ systemPrompt: agent.systemPrompt, model: agent.model });
    }
  };

  const hasMessages = messageGroups.length > 0 || optimistic.length > 0 || isStreaming;
  const lastGroupIndex = messageGroups.length - 1;

  const renderAssistantBubble = (group: MessageGroup, groupIdx: number) => {
    const active = getActiveVersion(group);
    const assistantId = group.assistantMessage?.id ?? `streaming-${group.userMessage.id}`;
    const timeline = buildTimelineFromStored(active?.toolCalls);
    const isLast = groupIdx === lastGroupIndex;
    const showLiveStream = isLast && (isStreaming || liveTimeline.length > 0);
    if (!active && !showLiveStream) return null;

    return (
      <motion.div
        key={`a-${assistantId}`}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={msgSpring}
        className="group relative mb-4 flex justify-start"
      >
        <div className="relative max-w-[88%]">
          <div
            className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-sm text-[var(--kp-text-1)]"
            {...(showLiveStream ? { "data-testid": "streaming-assistant-bubble" } : {})}
          >
            {(showLiveStream ? liveTimeline : timeline).length > 0 && (
              <ThinkingTimeline steps={showLiveStream ? liveTimeline : timeline} isLive={showLiveStream} />
            )}
            {showLiveStream ? (
              streamingContent ? (
                <PostContent content={streamingContent} className="prose-sm max-w-none" />
              ) : (
                <div className="flex items-center gap-2 text-[var(--kp-text-3)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Agent 思考中…
                </div>
              )
            ) : active ? (
              <PostContent content={active.content} className="prose-sm max-w-none" />
            ) : (
              <p className="text-[var(--kp-text-3)]">（无回复）</p>
            )}
            {group.versions.length > 0 && group.assistantMessage && !showLiveStream && (
              <MessageVersions
                current={group.activeVersionIndex}
                total={group.versions.length}
                onPrev={() => void handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex - 1)}
                onNext={() => void handleSwitchVersion(group.assistantMessage!.id, group.activeVersionIndex + 1)}
                onRegenerate={() => handleRegenerate(group.userMessage.id)}
                isStreaming={isLast && isStreaming}
              />
            )}
            {showLiveStream && (
              <MessageVersions current={group.versions.length} total={group.versions.length + 1} onPrev={() => {}} onNext={() => {}} onRegenerate={() => {}} isStreaming />
            )}
          </div>
          {active && !showLiveStream && (
            <div className="absolute left-0 top-full z-10 mt-1 flex items-center gap-2">
              <MessageActions
                onCopy={() => void handleCopy(assistantId, active.content)}
                showEdit={false}
                showRetry={false}
              />
              {copiedId === assistantId && (
                <span className="text-[10px] text-[var(--kp-text-3)]">已复制</span>
              )}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className={cn("flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] transition-all duration-300", leftOpen ? "w-64" : "w-0 overflow-hidden border-r-0")}>
        <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">对话历史</h2>
          <button type="button" onClick={startNewChat} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")} aria-label="新建对话">
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
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSessionId(s.id); setOptimistic([]); setError(null); setQueue([]); }}
                  className={cn("mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition", effectiveSessionId === s.id ? "bg-[var(--kp-brand)]/10 text-[var(--kp-brand-dark)]" : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]")}
                >
                  <div className="truncate font-medium">{s.title}</div>
                  <div className="truncate text-xs text-[var(--kp-text-3)]">
                    {s.model} · {formatRelativeTime(s.updatedAt)}
                  </div>
                </button>
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
            <h1 className="truncate text-sm font-semibold">Agent 对话</h1>
            <p className="truncate text-xs text-[var(--kp-text-3)]">
              {selectedAgent?.name ?? "—"} · {chatConfig.model}
              {tokenBudget.sessionTokens > 0 && ` · ${tokenBudget.sessionTokens} tok`}
              {queue.length > 0 && ` · 队列 ${queue.length}`}
            </p>
          </div>
          {agentsQuery.data?.items && (
            <select value={effectiveAgentId} onChange={(e) => selectAgent(e.target.value)} className="max-w-[140px] rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-2 py-1 text-xs">
              {agentsQuery.data.items.map((a: Agent) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <Link href="/agents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:flex text-xs")}>Agent 管理</Link>
          <button type="button" onClick={() => setRightOpen((v) => !v)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}>
            <PanelRight className="h-4 w-4" />
          </button>
        </header>

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
              <div key={group.userMessage.id}>
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={msgSpring}
                  className="group relative mb-3 flex justify-end"
                >
                  <div className="relative max-w-[88%]">
                    <div className="rounded-2xl bg-[var(--kp-brand)] px-4 py-3 text-sm text-white">
                      {group.userMessage.skillName && (
                        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                          <LucideIconByName name={group.userMessage.skillIcon} className="h-3 w-3" />
                          {group.userMessage.skillName}
                        </span>
                      )}
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-lg bg-white/10 p-2 text-sm text-white outline-none"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditConfirm(group.userMessage.id); }
                              if (e.key === "Escape") setEditingUserId(null);
                            }}
                          />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleEditConfirm(group.userMessage.id)} className="rounded bg-white/20 px-2 py-1 text-xs">确认</button>
                            <button type="button" onClick={() => setEditingUserId(null)} className="rounded px-2 py-1 text-xs opacity-70">取消</button>
                          </div>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{group.userMessage.content}</p>
                      )}
                    </div>
                    {!isEditing && (
                      <div className="absolute right-0 top-full z-10 mt-1 flex items-center gap-2">
                        <MessageActions
                          onCopy={() => void handleCopy(group.userMessage.id, group.userMessage.content)}
                          onEdit={() => { setEditingUserId(group.userMessage.id); setEditDraft(group.userMessage.content); }}
                          onRetry={() => handleRetry(group.userMessage.id)}
                          showEdit={isLastUser}
                          showRetry
                          disabled={isStreaming}
                        />
                        {copiedId === group.userMessage.id && (
                          <span className="text-[10px] text-[var(--kp-text-3)]">已复制</span>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
                {renderAssistantBubble(group, groupIdx)}
              </div>
            );
          })}

          {optimistic.map((msg) => (
            <div key={msg.id} className="mb-4 flex justify-end">
              <div className="max-w-[88%] rounded-2xl bg-[var(--kp-brand)] px-4 py-3 text-sm text-white opacity-80">
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {(isStreaming || liveTimeline.length > 0) && messageGroups.length === 0 && (
            <div className="mb-4 flex justify-start" data-testid="streaming-assistant-bubble">
              <div className="max-w-[88%] rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-sm">
                {liveTimeline.length > 0 && <ThinkingTimeline steps={liveTimeline} isLive />}
                {streamingContent ? (
                  <PostContent content={streamingContent} className="prose-sm max-w-none" />
                ) : (
                  <div className="flex items-center gap-2 text-[var(--kp-text-3)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Agent 思考中…
                  </div>
                )}
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

        {queue.length > 0 && (
          <div className="mx-4 mb-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-2">
            <div className="mb-1 text-xs font-medium text-[var(--kp-text-3)]">发送队列 ({queue.length})</div>
            {queue.map((task) => (
              <div key={task.id} className="flex items-center gap-2 py-1 text-xs">
                <MessageSquare className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{task.text}</span>
                <button type="button" onClick={() => setQueue((q) => q.filter((t) => t.id !== task.id))}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-[var(--kp-divider)] px-4 py-3 md:px-6">
          <ChatInputArea
            value={input}
            onChange={setInput}
            onSend={enqueueMessage}
            disabled={backendDown}
            isStreaming={isStreaming}
            skills={skillsQuery.data?.items ?? []}
            selectedSkill={selectedSkill}
            onSkillChange={setSelectedSkill}
          />
        </div>
      </div>

      <aside
        className={cn(
          "flex shrink-0 flex-col border-l border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 backdrop-blur-xl transition-[width] duration-300 ease-[var(--kp-spring-gentle)]",
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
                modelSupportsReasoning={!!modelOpt.supportsReasoning}
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
    </div>
  );
}
