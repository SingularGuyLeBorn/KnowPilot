"use client";

/**
 * Agent Chat — 三栏布局 · 多版本 · 消息编辑 · Skill / 触发
 */

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Bot,
  Check,
  ListChecks,
  Loader2,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAgent, useSessionHoverPreview } from "@/lib/hooks";
import { streamAgentChat, stopAgentChat, copyToClipboard } from "@/lib/agentStream";
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
import { cn, groupBySessionDate } from "@/lib/utils";
import { type Agent, type ChatSessionConfig, type ChatImageAttachment, type ChatMessage } from "@knowpilot/shared";
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
  sessionQueueItemToChatItem,
  splitQueueByKind,
  sortQueueItems,
} from "@/lib/chatQueueTypes";
import { UserSendQueuePanel, RuntimeStatusPanel } from "@/components/chatQueue";
import { AsyncTaskPanel } from "@/components/asyncTaskPanel";
import { SubagentCreateDialog } from "@/components/subagentCreateDialog";
import { ChatHoverMonitor } from "@/components/chatHoverMonitor";
import { WorkspaceTree } from "@/components/workspaceTree";
import { WorkspaceSelect } from "@/components/workspaceSelect";
import { MessageNavRail, type NavItem } from "@/components/messageNavRail";
import { ThinkingTimeline } from "@/components/chatTimelineSteps";
import { MessageActions, MessageSourceLabel, MessageVersions } from "@/components/chatMessageBits";
import { SessionListItem } from "@/components/chatSessionListItem";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  useSessionMessages,
  sessionMessagesStore,
} from "@/lib/useSessionMessages";
import {
  useStreamLifecycle,
  streamLifecycleActions,
  streamLifecycleStore,
  type StreamLifecycleState,
} from "@/lib/useStreamLifecycle";
import {
  useSessionComposeState,
  sessionComposeActions,
  sessionComposeStore,
} from "@/lib/useSessionComposeState";

/* ─── 模块级常量与 UI 偏好持久化 ─── */

const NEW_STREAM_KEY = "__new__"; // 新会话首条消息发起时尚无 sessionId 时的临时键
const CHAT_UI_STORAGE_KEY = "kp-chat-ui-v1";
const LIFECYCLE_STORAGE_KEY = "kp:chat-lifecycle-states";
const COMPOSE_STORAGE_KEY = "kp:chat-compose-states";

type ChatUiPrefs = {
  leftOpen: boolean;
  rightOpen: boolean;
  leftTab: "history" | "async";
  historySubTab: "main" | "sub";
  rightTab: "config" | "runtime";
};

function readChatUiPrefs(): ChatUiPrefs {
  const defaults: ChatUiPrefs = {
    leftOpen: true,
    rightOpen: true,
    leftTab: "history",
    historySubTab: "main",
    rightTab: "config",
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(CHAT_UI_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ChatUiPrefs>;
    return {
      leftOpen: parsed.leftOpen ?? true,
      rightOpen: parsed.rightOpen ?? true,
      leftTab: parsed.leftTab === "async" ? "async" : "history",
      historySubTab: parsed.historySubTab === "sub" ? "sub" : "main",
      rightTab: parsed.rightTab === "runtime" ? "runtime" : "config",
    };
  } catch {
    return defaults;
  }
}

function writeChatUiPrefs(prefs: ChatUiPrefs) {
  try {
    localStorage.setItem(CHAT_UI_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
function saveChatStoresToStorage() {
  try {
    const life = streamLifecycleStore.serialize();
    delete life[NEW_STREAM_KEY];
    sessionStorage.setItem(LIFECYCLE_STORAGE_KEY, JSON.stringify(life));
    const compose = sessionComposeStore.serialize();
    delete compose[NEW_STREAM_KEY];
    sessionStorage.setItem(COMPOSE_STORAGE_KEY, JSON.stringify(compose));
  } catch {
    // ignore
  }
}

/* ─── Main ─── */

export function ChatView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const agentFromUrl = searchParams.get("agentId");
  const sessionFromUrl = searchParams.get("sessionId");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [userSelectedWorkspaceId, setUserSelectedWorkspaceId] = useState<string | null>(null);
  // 视图级非流式错误（如重命名失败）；流式 error 来自 lifecycleState.error
  const [viewError, setViewError] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  // 左栏：history=对话历史，async=异步任务运行记录（追溯，不消费）
  const [leftTab, setLeftTab] = useState<"history" | "async">("history");
  // 对话历史下的子标签页：main=主 Agent，sub=子 Agent
  const [historySubTab, setHistorySubTab] = useState<"main" | "sub">("main");
  // 右栏：config=配置，runtime=待消费的异步队列结果
  const [rightTab, setRightTab] = useState<"config" | "runtime">("config");
  const chatUiHydratedRef = useRef(false);
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
  /** session_rotate 后的跳转提示（不自动切换会话） */
  const [rotateBanner, setRotateBanner] = useState<{
    newSessionId: string;
    newTitle: string;
  } | null>(null);
  // #11 会话批量管理
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [hoverMonitorSessionId, setHoverMonitorSessionId] = useState<string | null>(null);
  const { enabled: sessionHoverPreviewEnabled } = useSessionHoverPreview();
  useEffect(() => {
    // 外部状态（hover preview 开关）变更时同步清理 UI 状态，非派生数据
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!sessionHoverPreviewEnabled) setHoverMonitorSessionId(null);
  }, [sessionHoverPreviewEnabled]);
  const hoverMonitorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #12 Swarm 新手引导（可关闭，localStorage 记忆）
  // 初始恒为 false，mount 后再读 localStorage，避免 SSR/首屏 hydration 不一致
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    // mount 后读 localStorage 同步到 React state（SSR 安全），非派生数据
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      if (localStorage.getItem("kp-swarm-onboarding-dismissed") !== "1") {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  const dismissSwarmOnboarding = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem("kp-swarm-onboarding-dismissed", "1");
    } catch {
      // ignore
    }
  };

  // 虚拟列表句柄：用于导航条按索引滚动 + 结构变化时强制滚到底部
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  /** 可指定 session：流结束后应消费该 session，而不是当前视图 */
  const consumeRef = useRef<(preferredSessionId?: string) => void>(() => {});

  /* ─── 多 session 状态隔离（三层 store）───
   * 消息：sessionMessagesStore / useSessionMessages
   * 流式：streamLifecycleStore / useStreamLifecycle
   * 编排：sessionComposeStore / useSessionComposeState（队列 / optimistic / abort）
   * 切换 session 只改 sessionId；hooks 自动订阅新切片，不再 applyView 镜像。
   */
  const effectiveSessionIdRef = useRef<string | null>(null);
  // 页面刷新/关闭时阻止 runStream finally 清掉 streaming phase，保证下次 mount 能续传
  const isPageUnloadingRef = useRef(false);
  // 防止极短时间重复入队（如发送按钮/快捷键连发）
  const lastEnqueueRef = useRef<{ text: string; at: number } | null>(null);
  const streamSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleStreamSave = useCallback((immediate?: boolean) => {
    if (streamSaveTimeoutRef.current) clearTimeout(streamSaveTimeoutRef.current);
    if (immediate) {
      saveChatStoresToStorage();
      return;
    }
    streamSaveTimeoutRef.current = setTimeout(() => {
      saveChatStoresToStorage();
      streamSaveTimeoutRef.current = null;
    }, 100);
  }, []);

  const isSessionStreaming = useCallback(
    (sid: string | null): boolean => streamLifecycleStore.isStreaming(sid),
    [],
  );
  /** INV-2：streaming|done 均占用，Compose 不得开新流 */
  const isSessionRunOccupied = useCallback(
    (sid: string | null): boolean => streamLifecycleStore.isRunOccupied(sid),
    [],
  );

  // 流式 token rAF 合并：onToken 每字符触发一次会让 ChatView 高频重渲染。
  const pendingStreamDeltaRef = useRef<Map<string, string>>(new Map());
  const streamRafRef = useRef<Map<string, number>>(new Map());

  const scheduleStreamFlush = useCallback((sid: string) => {
    if (streamRafRef.current.has(sid)) return;
    const id = requestAnimationFrame(() => {
      streamRafRef.current.delete(sid);
      const delta = pendingStreamDeltaRef.current.get(sid);
      if (delta) {
        pendingStreamDeltaRef.current.delete(sid);
        streamLifecycleActions.appendTokenDelta(sid, delta);
        scheduleStreamSave();
      }
    });
    streamRafRef.current.set(sid, id);
  }, [scheduleStreamSave]);

  /** 立即冲刷并取消该 session 的待写 delta */
  const flushStreamNow = useCallback((sid: string) => {
    const rafId = streamRafRef.current.get(sid);
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      streamRafRef.current.delete(sid);
    }
    const delta = pendingStreamDeltaRef.current.get(sid);
    if (delta) {
      pendingStreamDeltaRef.current.delete(sid);
      streamLifecycleActions.appendTokenDelta(sid, delta);
      scheduleStreamSave();
    }
  }, [scheduleStreamSave]);

  /** 取消该 session 的 rAF 并丢弃未写 delta */
  const discardStreamFlush = useCallback((sid: string) => {
    const rafId = streamRafRef.current.get(sid);
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      streamRafRef.current.delete(sid);
    }
    pendingStreamDeltaRef.current.delete(sid);
  }, []);

  const { useList: useAgentList } = useAgent();
  // R10：pageSize 50→100，兼顾 WorkspaceTree 对全部 Agent 的需求；WorkspaceTree 复用本查询，不再各自发 agent.list(100)。
  const agentsQuery = useAgentList({ page: 1, pageSize: 100 });
  // A16：skill 列表极少变化，加 staleTime 5min，减少每次进 Chat 都重请求。
  // skill CRUD 后 useCRUDApi 会 invalidate utils.skill.list（按 key 失效全部 input），自动刷新。
  const skillsQuery = trpc.skill.list.useQuery({ page: 1, pageSize: 100, enabled: true }, { staleTime: 5 * 60 * 1000 });
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
  // 4. startNewChat 期间 router.replace 清 URL 是异步的，必须用 ref 记录上一次 URL 值，
  //    避免 stale sessionFromUrl 把刚清空的 state 又拉回去（用户感知的“点两次才新建”）。
  const effectiveSessionId = sessionId ?? sessionFromUrl;
  const prevSessionFromUrlRef = useRef<string | null>(sessionFromUrl);

  // 刷新后恢复面板状态：URL view/panel 优先，否则用 localStorage 里用户上次切换后的值。
  // 不要根据「当前是不是子会话」去改 view——用户切到主 Agent 后刷新，应仍停在主 Agent。
  useEffect(() => {
    if (chatUiHydratedRef.current) return;
    chatUiHydratedRef.current = true;
    const prefs = readChatUiPrefs();
    const view = searchParams.get("view");
    const panel = searchParams.get("panel");
    setLeftOpen(prefs.leftOpen);
    setRightOpen(prefs.rightOpen);
    setLeftTab(panel === "async" || panel === "history" ? panel : prefs.leftTab);
    setHistorySubTab(view === "sub" || view === "main" ? view : prefs.historySubTab);
    setRightTab(prefs.rightTab);
  }, [searchParams]);

  useEffect(() => {
    if (!chatUiHydratedRef.current) return;
    writeChatUiPrefs({ leftOpen, rightOpen, leftTab, historySubTab, rightTab });
  }, [leftOpen, rightOpen, leftTab, historySubTab, rightTab]);

  const syncChatUiToUrl = useCallback(
    (patch: { view?: "main" | "sub"; panel?: "history" | "async" }) => {
      const params = new URLSearchParams(searchParams.toString());
      let changed = false;
      if (patch.view === "sub" || patch.view === "main") {
        // 主/子都显式写入 URL，刷新后恢复的是用户最后一次切换的值
        if (params.get("view") !== patch.view) {
          params.set("view", patch.view);
          changed = true;
        }
      }
      if (patch.panel === "async") {
        if (params.get("panel") !== "async") {
          params.set("panel", "async");
          changed = true;
        }
      } else if (patch.panel === "history") {
        if (params.has("panel")) {
          params.delete("panel");
          changed = true;
        }
      }
      if (changed) {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    },
    [searchParams, pathname, router],
  );

  useEffect(() => {
    if (sessionFromUrl && sessionFromUrl !== sessionId && sessionFromUrl !== prevSessionFromUrlRef.current) {
      // URL→state 在同一个事件处理（本 effect）内同步完成，不用 queueMicrotask 推迟：
      // 推迟只会制造「URL 已变、sessionId 未变」的中间帧，无任何收益。
      const sid = sessionFromUrl;
      setSessionId(sid);
      // 子会话可能已在服务端跑流：立刻发现并挂接，避免空白到刷新才出现
      void utils.session.listRunning.invalidate();
      // INV-8 ③：会话切换完成 → 显式 drain（该会话可能有恢复/镜像的待发队列项）
      consumeRef.current(sid);
    }
    prevSessionFromUrlRef.current = sessionFromUrl;
  }, [sessionFromUrl, sessionId, utils.session.listRunning]);
  // 同步当前视图 session 到 ref
  useEffect(() => {
    effectiveSessionIdRef.current = effectiveSessionId;
  }, [effectiveSessionId]);

  // 三层 store 订阅：sessionId 变化后自动切切片，无需 applyView
  const lifecycleKey = effectiveSessionId ?? NEW_STREAM_KEY;
  const {
    messages,
    isMessagesHydrated,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderMessages,
    hydrateFromServer,
  } = useSessionMessages(effectiveSessionId);
  const { state: lifecycleState, isStreaming } = useStreamLifecycle(lifecycleKey);
  const streamingContent = lifecycleState.streamingContent;
  const liveTimeline = lifecycleState.liveTimeline;
  const streamTargetUserId = lifecycleState.streamTargetUserId;
  // INV-4：本轮流式期间提前 upsert 的 assistant id，其 stored 渲染被屏蔽（live 块独占）
  const inFlightAssistantId =
    lifecycleState.phase === "streaming" || lifecycleState.phase === "done"
      ? lifecycleState.inFlightAssistantId
      : null;
  const lastRoundTokens = lifecycleState.lastRoundTokens;
  const streamError = lifecycleState.error;
  const error = viewError ?? streamError;
  const setError = setViewError;
  const { state: composeState } = useSessionComposeState(lifecycleKey);
  const optimistic = composeState.optimistic;
  const userQueue = composeState.userQueue;
  const asyncOverlays = composeState.asyncOverlays;
  const consumedDeliveries = composeState.consumedDeliveries;

  /** 任意 session 的消息兜底重拉（当前会话走 hook，其它走 store） */
  const hydrateSessionMessagesFallback = useCallback(
    async (sid: string) => {
      if (!sid || sid === NEW_STREAM_KEY) return;
      if (sid === effectiveSessionId) {
        // 不 await：hydrate → store dispatch → tryCommitAfterHydrate（INV-1 对账）
        // + hydrateDone（INV-8 ④）全部经 store 事件流转，不把 await 挂在流式回调上。
        void hydrateFromServer();
        return;
      }
      try {
        const res = await utils.message.listForChat.fetch({ sessionId: sid, limit: 50 });
        sessionMessagesStore.hydrateSessionMessages(sid, res.items as ChatMessage[]);
      } catch {
        /* ignore */
      }
    },
    [effectiveSessionId, hydrateFromServer, utils.message.listForChat],
  );

  const { data: sessionDetail, refetch: refetchSession } = trpc.session.getById.useQuery(
    { id: effectiveSessionId! },
    { enabled: !!effectiveSessionId },
  );
  // 当前会话是否为子代理「任务」会话（用于任务条 / 父会话锚点等）。
  // 只用 kind / parentSessionId，不要用 Agent.tier===sub 兜底——
  // 否则子 Agent 的「主会话」也会被当成任务会话，并和标签页状态纠缠。
  const isSubagentSession =
    sessionDetail?.kind === "subagent" || !!sessionDetail?.parentSessionId;
  const parentSessionId = sessionDetail?.parentSessionId ?? null;

  const { data: parentSession } = trpc.session.getById.useQuery(
    { id: parentSessionId! },
    { enabled: !!parentSessionId },
  );

  // Agent 选择优先级：URL 参数 > 用户显式选择 > 当前会话关联 Agent > 默认 assistant
  // URL agentId 优先级最高：用户通过链接/刷新进入时应以 URL 为准；
  // 在会话内切换时不带 agentId，此时用户显式选择/当前会话 Agent 生效。
  const effectiveAgentId =
    agentFromUrl || agentId || sessionDetail?.agentId || defaultAgentId;

  // 根据 effectiveAgentId / session 推导当前 Workspace；用户未手动切换时自动跟随
  const derivedWorkspaceId = useMemo(() => {
    const workspaces = workspacesQuery.data?.items;
    if (!workspaces?.length) return null;
    const agent = effectiveAgentId
      ? agentsQuery.data?.items.find((a: Agent) => a.id === effectiveAgentId)
      : undefined;
    if (agent?.workspaceId && workspaces.some((w) => w.id === agent.workspaceId)) {
      return agent.workspaceId;
    }
    const systemWs = workspaces.find((w) => w.isSystem);
    return systemWs?.id ?? workspaces[0].id;
  }, [workspacesQuery.data?.items, agentsQuery.data?.items, effectiveAgentId]);
  const selectedWorkspaceId = userSelectedWorkspaceId ?? derivedWorkspaceId;

  // 子 Agent 会话下，所有「主 Agent」视角的过滤/创建都应以父会话/父 Agent 为锚点，
  // 否则左栏主会话列表会显示为空，用户无法切回父会话。
  const mainAgentId = isSubagentSession
    ? (parentSession?.agentId ?? effectiveAgentId)
    : effectiveAgentId;
  const mainSessionId = isSubagentSession ? parentSessionId : effectiveSessionId;
  // 与 SubagentCreateDialog 乐观更新使用同一 query key（pageSize 必须一致）
  // 推优先：子会话状态走 SSE subagent_session_update，仅 mount/focus 兜底拉取
  trpc.session.listChildren.useQuery(
    { parentSessionId: mainSessionId!, pageSize: 20 },
    { enabled: !!mainSessionId, refetchInterval: false, refetchOnWindowFocus: true },
  );

  const backendDown = agentsQuery.isError || sessionsQuery.isError || providers.isError;

  // 发现运行中会话：改 focus/mount 拉取，不再 5s 空轮询（visibilitychange 已覆盖切回标签）
  const runningSessionsQuery = trpc.session.listRunning.useQuery(undefined, {
    enabled: !backendDown,
    refetchInterval: false,
    refetchOnWindowFocus: true,
  });

  const asyncQueueStatsQuery = trpc.agent.asyncQueueStats.useQuery(undefined, {
    enabled: !backendDown,
    // 推优先：SSE async_job_update 带 stats；60s 兜底防漏
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // 异步任务活跃数（子 Agent 会话下以父会话为锚点）
  const asyncTaskCountQuery = trpc.task.list.useQuery(
    { page: 1, pageSize: 50, sessionId: mainSessionId ?? undefined },
    { enabled: !!mainSessionId },
  );
  const asyncTaskActiveCount = useMemo(() => {
    const items = (asyncTaskCountQuery.data?.items ?? []) as { status?: string }[];
    return items.filter((t) => t.status === "running" || t.status === "queued").length;
  }, [asyncTaskCountQuery.data?.items]);

  // 推优先：SSE 即时通知；仅错误时短轮询兜底，正常不再 interval
  const asyncQueueQuery = trpc.agent.pullAsyncQueue.useQuery(
    { sessionId: effectiveSessionId! },
    {
      enabled: !!effectiveSessionId && !backendDown,
      refetchInterval: (query) => (query.state.error ? 15_000 : false),
      refetchOnWindowFocus: true,
    },
  );

  const sessionQueueQuery = trpc.agent.listSessionQueueItems.useQuery(
    { sessionId: effectiveSessionId! },
    { enabled: !!effectiveSessionId && !backendDown },
  );
  const createSessionQueueItemMutation = trpc.agent.createSessionQueueItem.useMutation();
  const submitInjectMutation = trpc.agent.submitInject.useMutation();
  const consumeSessionQueueItemMutation = trpc.agent.consumeSessionQueueItem.useMutation();
  const deleteSessionQueueItemMutation = trpc.agent.deleteSessionQueueItem.useMutation();
  const reorderSessionQueueItemsMutation = trpc.agent.reorderSessionQueueItems.useMutation();
  const ackAsyncDeliveryMutation = trpc.agent.ackAsyncDelivery.useMutation();
  // 推优先：agent_message SSE 触发 refetch；仅错误时兜底轮询
  const pullAgentMessagesQuery = trpc.agent.pullAgentMessages.useQuery(
    { agentId: effectiveAgentId! },
    {
      enabled: !!effectiveAgentId && !!isSubagentSession && !backendDown,
      refetchInterval: (query) =>
        isSubagentSession && query.state.error ? 10_000 : false,
      refetchOnWindowFocus: true,
    },
  );

  // 当工具调用产生 async-running overlay 时立即触发一次 poll，防止任务在 stats 轮询间隙完成而漏投。
  // 无 jobId 的 spawn overlay 用 subagentSessionId / overlay.id 去重触发。
  const asyncPollTriggerRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!effectiveSessionId) return;
    const keys = asyncOverlays
      .filter(
        (o) =>
          o.kind === "async-running" &&
          (o.status === "running" || o.status === "queued"),
      )
      .map((o) => o.jobId || o.subagentSessionId || o.id);
    let shouldPoll = false;
    for (const key of keys) {
      if (!asyncPollTriggerRef.current.has(key)) {
        asyncPollTriggerRef.current.add(key);
        shouldPoll = true;
      }
    }
    if (shouldPoll) void asyncQueueQuery.refetch();
  }, [asyncOverlays, effectiveSessionId, asyncQueueQuery]);

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

  const pinAsyncJobMutation = trpc.agent.toggleAsyncJobPinned.useMutation({
    onSuccess: () => {
      void asyncQueueQuery.refetch();
    },
  });

  // 从 DB 水合发送队列（仅在切换会话时一次，避免覆盖本地编辑）
  const hydratedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveSessionId) {
      hydratedSessionRef.current = null;
      return;
    }
    if (!sessionQueueQuery.data) return;
    if (hydratedSessionRef.current === effectiveSessionId) return;
    hydratedSessionRef.current = effectiveSessionId;
    const items = sessionQueueQuery.data.map(sessionQueueItemToChatItem);
    sessionComposeActions.setUserQueue(effectiveSessionId, items);
    // INV-8 ④：发送队列 DB hydrate 完成 → 显式 drain 请求（覆盖切会话后有待发项的场景）
    streamLifecycleActions.hydrateDone(effectiveSessionId);
  }, [effectiveSessionId, sessionQueueQuery.data]);

  // 子 Agent 会话：把 pending AgentMessage 镜像进 SessionQueueItem（幂等）
  // 若 triggerAgentRun 已写入同内容 ChatMessage，则直接 markConsumed，避免队列再消费导致「消息发两遍」
  const markAgentMessageConsumedMutation = trpc.agent.markAgentMessageConsumed.useMutation();
  useEffect(() => {
    if (!effectiveSessionId || !isSubagentSession || !pullAgentMessagesQuery.data?.length) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      // 并行镜像：N 条 pending 消息同时发，不串行阻塞渲染（旧实现顺序 await 导致进入子会话卡死）
      const results = await Promise.allSettled(
        pullAgentMessagesQuery.data.map(async (msg) => {
          const alreadyInChat = messages.some(
            (m) => m.role === "user" && m.content.trim() === String(msg.content ?? "").trim(),
          );
          if (alreadyInChat) {
            try {
              await markAgentMessageConsumedMutation.mutateAsync({ messageId: msg.id });
            } catch {
              /* ignore */
            }
            return;
          }
          try {
            await createSessionQueueItemMutation.mutateAsync({
              sessionId: effectiveSessionId,
              kind: "superior",
              content: msg.content,
              // AgentMessage.source 是 tier（super/manager），不是 fromAgentId
              source: msg.source || "manager",
              agentMessageId: msg.id,
            });
          } catch {
            // 幂等冲突或网络错误忽略
          }
        }),
      );
      if (cancelled) return;
      // 仅当至少有一条实际处理（非全 rejected）才 refetch
      if (results.some((r) => r.status === "fulfilled")) {
        void sessionQueueQuery.refetch();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSessionId, isSubagentSession, pullAgentMessagesQuery.data, messages]);

  // 推优先：通过 store 统一监听 async-stream SSE（当前会话 + 父会话）。
  // 不再自建 EventSource——复用 useSessionMessages 的 watchSession 连接，消除双连接浪费。
  // 事件回调里 watchSession 的子 Agent session 在 cleanup 时统一 close。
  const extraWatchedSessionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!effectiveSessionId || backendDown) return;
    const sessionIds = new Set<string>([effectiveSessionId]);
    if (mainSessionId) sessionIds.add(mainSessionId);
    // 捕获 ref 值到 effect 局部变量，避免 cleanup 时 ref 已变更（react-hooks/exhaustive-deps）
    const extraWatched = extraWatchedSessionsRef.current;

    const refreshAsync = () => {
      // INV-8 ④：异步队列刷新完成（async_delivery / async_job_update / session_run_started 触发）
      // = 显式 drain 请求。投递到达时视图空闲则立即消费；占用中由 commit 兑底。
      // 注意：完成态展示不在这里做——poll 显示 job 已被服务端消费时，由
      // mergeAsyncPollIntoQueue 纯派生把本地 overlay 转为 done/failed（createdAt+15s），
      // 覆盖初始 fetch / refetch / SSE 全部数据到达路径，不依赖哪个事件先到。
      void asyncQueueQuery.refetch().then(() => {
        if (effectiveSessionId) streamLifecycleActions.hydrateDone(effectiveSessionId);
      });
      void asyncQueueStatsQuery.refetch();
      if (mainSessionId) {
        void utils.session.listChildren.invalidate({ parentSessionId: mainSessionId, pageSize: 20 });
        void utils.task.list.invalidate();
        if (mainSessionId !== effectiveSessionId) {
          void utils.agent.pullAsyncQueue.invalidate({ sessionId: mainSessionId });
        }
      }
    };

    const cleanups: Array<() => void> = [];
    for (const sid of sessionIds) {
      // 确保该 session 已 watch（引用计数 +1），并注册额外事件监听
      sessionMessagesStore.watchSession(sid);
      const register = (eventType: string, handler: (ev: MessageEvent) => void) => {
        cleanups.push(sessionMessagesStore.addSessionEventListener(sid, eventType, handler));
      };

      register("async_delivery", refreshAsync);
      register("session_run_started", (ev) => {
        try {
          const data = JSON.parse(ev.data) as { sessionId?: string };
          void utils.session.listRunning.invalidate();
          refreshAsync();
          if (data.sessionId && data.sessionId !== sid) {
            sessionMessagesStore.watchSession(data.sessionId);
            extraWatchedSessionsRef.current.add(data.sessionId);
          }
        } catch {
          void utils.session.listRunning.invalidate();
          refreshAsync();
        }
      });
      register("async_job_update", (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            stats?: {
              queued: number;
              runningGlobal: number;
              maxGlobal: number;
              maxPerSession: number;
              taskTimeoutMs: number;
            };
          };
          if (data.stats) {
            utils.agent.asyncQueueStats.setData(undefined, data.stats);
          }
        } catch {
          /* ignore parse */
        }
        refreshAsync();
      });
      register("agent_message", () => {
        if (isSubagentSession) void pullAgentMessagesQuery.refetch();
      });
      register("subagent_session_update", (ev) => {
        if (mainSessionId) {
          void utils.session.listChildren.invalidate({ parentSessionId: mainSessionId, pageSize: 20 });
        }
        void utils.session.listRunning.invalidate();
        try {
          const data = JSON.parse(ev.data) as {
            subagentSessionId?: string;
            status?: string;
          };
          if (data.subagentSessionId && data.subagentSessionId !== sid) {
            sessionMessagesStore.watchSession(data.subagentSessionId);
            extraWatchedSessionsRef.current.add(data.subagentSessionId);
          }
        } catch {
          /* ignore */
        }
      });
      register("session_rotated", (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            oldSessionId?: string;
            newSessionId: string;
            newTitle: string;
          };
          if (data.oldSessionId && data.oldSessionId === effectiveSessionId) {
            setRotateBanner({ newSessionId: data.newSessionId, newTitle: data.newTitle });
          }
          void utils.session.list.invalidate();
          void utils.session.getById.invalidate({ id: data.oldSessionId ?? effectiveSessionId });
        } catch {
          /* ignore */
        }
      });
      register("session_title_updated", () => {
        void utils.session.list.invalidate();
      });
      register("agent_renamed", () => {
        void utils.agent.list.invalidate();
      });
    }
    return () => {
      for (const fn of cleanups) fn();
      for (const sid of sessionIds) {
        sessionMessagesStore.closeSessionWatch(sid);
      }
      // 清理事件回调里动态 watch 的子 Agent session
      for (const sid of extraWatched) {
        sessionMessagesStore.closeSessionWatch(sid);
      }
      extraWatched.clear();
    };
  }, [
    effectiveSessionId,
    mainSessionId,
    backendDown,
    asyncQueueQuery,
    asyncQueueStatsQuery,
    pullAgentMessagesQuery,
    isSubagentSession,
    utils,
  ]);

  // 拖拽重排防抖写 DB
  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistQueueOrder = useCallback(
    (items: ChatQueueItem[]) => {
      if (!effectiveSessionId) return;
      const orderedIds = items.map((i) => i.dbId).filter((id): id is string => !!id);
      if (orderedIds.length === 0) return;
      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
      reorderTimerRef.current = setTimeout(() => {
        reorderSessionQueueItemsMutation.mutate({ sessionId: effectiveSessionId, orderedIds });
      }, 500);
    },
    [effectiveSessionId, reorderSessionQueueItemsMutation],
  );

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

  // 右侧「状态」：未消费 = 仅待开始/运行中；已结束不进未消费；已消费带滑入
  const runtimePendingItems = useMemo(
    () => asyncResultQueue.filter((i) => i.kind === "async-running"),
    [asyncResultQueue],
  );
  const runtimeHeldItems = useMemo(
    () => asyncResultQueue.filter((i) => i.kind === "async-result" && i.pinned),
    [asyncResultQueue],
  );
  const runtimeConsumedItems = useMemo(() => {
    const consumed = (asyncQueueQuery.data as { consumed?: Array<{
      id: string;
      jobId: string;
      taskLabel: string;
      asyncResult: string;
      status: "done" | "failed";
      error?: string;
      subagentSessionId?: string;
      subagentName?: string;
      logs?: ChatQueueItem["logs"];
      createdAt: number;
      sourceType?: string;
    }> } | undefined)?.consumed ?? [];
    return consumed.map((del): ChatQueueItem => ({
      id: `consumed-${del.jobId}`,
      kind: "async-result",
      text: "",
      jobId: del.jobId,
      taskLabel: del.taskLabel,
      asyncResult: del.status === "failed" ? `任务失败：${del.error || "未知错误"}` : del.asyncResult,
      status: del.status,
      subagentSessionId: del.subagentSessionId,
      subagentName: del.subagentName,
      logs: del.logs,
      createdAt: del.createdAt,
      sourceType: del.sourceType,
    }));
  }, [asyncQueueQuery.data]);
  const [runtimeSubTab, setRuntimeSubTab] = useState<"pending" | "consumed">("pending");

  const queue = useMemo(
    () => [...sortQueueItems(asyncResultQueue), ...sortQueueItems(userQueue)],
    [asyncResultQueue, userQueue],
  );

  // 父会话实时任务进度：从合并后的 asyncResultQueue 派生，
  // async_task_run / spawn_subagent 返回 running 时立即显示，
  // 任务完成后显示 done/failed，展示窗口结束后自动消失
  // （store overlay 由 removeAt 定时器清理；纯派生项随 overlay 15s 生命周期过期不再派生）。
  // 完成态转换由两条互斥路径保证，显示不依赖谁赢得原子 CLAIM 竞态：
  // ① 前端 consume 赢得 CLAIM → consumeQueue 内 patchAsyncOverlays 转完成态（removeAt=now+5s）；
  // ② 服务端 autoConsume 赢得 CLAIM → mergeAsyncPollIntoQueue 纯派生转换
  //    （serverConsumed 展示项，removeAt=createdAt+15s，覆盖初始 fetch/refetch/SSE 全部数据路径）。
  const asyncProgressSteps = useMemo<TimelineStep[]>(() => {
    const steps: TimelineStep[] = [];
    for (const item of asyncResultQueue) {
      const latestLog = item.logs?.length ? item.logs[item.logs.length - 1] : undefined;
      if (item.kind === "async-running") {
        steps.push({
          type: "progress",
          jobId: item.jobId ?? item.id,
          label: item.taskLabel || `后台任务 ${item.jobId?.slice(0, 6) ?? ""}`,
          round: 1,
          status: item.status === "queued" ? "queued" : "running",
          content: latestLog?.message,
        });
      } else if (item.kind === "async-result" && item.status) {
        steps.push({
          type: "progress",
          jobId: item.jobId ?? item.id,
          label: item.taskLabel || `后台任务 ${item.jobId?.slice(0, 6) ?? ""}`,
          round: 1,
          status: item.status === "failed" ? "failed" : "done",
          content: item.status === "failed" ? item.asyncResult : latestLog?.message,
        });
      }
    }
    return steps;
  }, [asyncResultQueue]);

  // 按会话持久化已消费的异步投递，刷新页面后不再显示旧结果
  useEffect(() => {
    if (!effectiveSessionId) return;
    const key = `kp:consumed-deliveries:${effectiveSessionId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        sessionComposeActions.setConsumedDeliveries(
          effectiveSessionId,
          new Set<string>(JSON.parse(saved)),
        );
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

  // R19：agent.list 已裁剪 systemPrompt；Chat 用 agent.getById 取 systemPrompt/model，与 list metadata 合并
  const selectedAgentMeta = agentsQuery.data?.items.find((a: Agent) => a.id === effectiveAgentId);
  const selectedAgentFull = trpc.agent.getById.useQuery(
    { id: effectiveAgentId! },
    { enabled: !!effectiveAgentId },
  );
  const selectedAgent = useMemo<Agent | undefined>(() => {
    if (!selectedAgentMeta) return undefined;
    const full = selectedAgentFull.data;
    return {
      ...selectedAgentMeta,
      systemPrompt: full?.systemPrompt ?? "",
      model: full?.model ?? selectedAgentMeta.model,
      tools: full?.tools ?? selectedAgentMeta.tools ?? [],
    } as Agent;
  }, [selectedAgentMeta, selectedAgentFull.data]);
  const modelOpt = getModelOption(chatConfig.model);

  const messageGroups = useMemo(
    () => buildMessageGroups(messages),
    [messages],
  );

  // 右侧导航条：每条 assistant 回复一个横杠，hover 放大 + 预览，点击滚动定位
  const navItems = useMemo<NavItem[]>(() => {
    return messageGroups
      .map((g, idx) => {
        if (!g.assistantMessage) return null;
        const active = getActiveVersion(g);
        if (!active) return null;
        const preview = active.content.replace(/[#*`>\-\[\]!]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
        return {
          id: g.assistantMessage.id,
          preview: preview || "（空回复）",
          domId: g.assistantMessage.id,
          // 记录在 messageGroups 中的索引，供虚拟列表 scrollToIndex 使用
          index: idx,
        } satisfies NavItem;
      })
      .filter((x): x is NavItem => x !== null);
  }, [messageGroups]);

  const filteredSessions = useMemo(() => {
    const items = sessionsQuery.data?.items ?? [];
    // 主 Agent 标签页只显示当前主 Agent 的会话；子 Agent 任务会话由「子 Agent」标签页隔离，
    // 避免不同 Agent 的会话混在一起。子 Agent 会话下以父 Agent 为锚点，确保能切回父会话。
    const anchorAgentId = mainAgentId;
    const agentFiltered = anchorAgentId
      ? items.filter(
          (s) =>
            s.kind !== "subagent" &&
            (s.agentId === anchorAgentId || !s.agentId),
        )
      : items.filter((s) => s.kind !== "subagent");
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return agentFiltered;
    return agentFiltered.filter(
      (s) => s.title.toLowerCase().includes(q) || s.model.toLowerCase().includes(q),
    );
  }, [sessionsQuery.data?.items, sessionSearch, mainAgentId]);

  const groupedSessions = useMemo(
    () => groupBySessionDate(filteredSessions),
    [filteredSessions],
  );

  const tokenBudget = useMemo(
    () => buildTokenBudget(messages, chatConfig.maxTokens, lastRoundTokens, chatConfig.model),
    [messages, chatConfig.maxTokens, chatConfig.model, lastRoundTokens],
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
    // 仅在会话结构变化时滚动到底部；token 逐字更新由 Virtuoso followOutput 处理（避免视觉抖动）
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
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

  // R17：useCallback 稳定化，使 ChatSettingsPanel memo 后流式期间跳过重渲染
  const resetPromptToAgent = useCallback(() => {
    if (!selectedAgent) return;
    updateConfig({ systemPrompt: selectedAgent.systemPrompt, customSystemPrompt: false });
  }, [selectedAgent, updateConfig]);

  const handleOpenPromptEditor = useCallback(() => setShowPromptEditor(true), []);

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
      toolResults?: Record<string, unknown>;
      optimisticUser?: { id: string; text: string };
      resumeAfter?: number;
      isResume?: boolean;
      targetSessionId?: string;
      /** 后台消费队列时：不抢占当前视图 / URL */
      keepCurrentView?: boolean;
      /** 覆盖 agentId（后台消费其它 session 时用该 session 的 Agent） */
      agentId?: string;
    }) => {
      // 捕获本次流式所属的 session（新会话首条消息时为 NEW_STREAM_KEY，onDone 拿到 sessionId 后迁移）
      let originSid = opts.targetSessionId ?? effectiveSessionId ?? NEW_STREAM_KEY;
      // 视图不变量：流回调不依赖闭包 keepCurrentView，改用 effectiveSessionIdRef 运行时判断
      // keepCurrentView 参数仅保留给 consumeQueue 标记后台消费，不再在回调里使用
      void opts.keepCurrentView;
      sessionComposeActions.getActiveAbortController(originSid)?.abort();
      const ac = new AbortController();
      sessionComposeActions.setActiveAbortController(originSid, ac);

      const isResume = opts.isResume === true;
      streamLifecycleActions.beginStream(originSid, {
        streamTargetUserId:
          opts.retryFromMessageId ?? opts.regenerateUserMessageId ?? opts.editMessageId ?? null,
        resume: isResume,
      });
      // INV-2：非 resume 时若仍 occupied，beginStream 已 no-op，禁止继续发请求
      if (!isResume && streamLifecycleStore.get(originSid).phase !== "streaming") {
        sessionComposeActions.setActiveAbortController(originSid, null);
        sessionComposeActions.setQueueDraining(originSid, false);
        return;
      }
      scheduleStreamSave(true);
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
            sessionId: opts.targetSessionId ?? effectiveSessionId ?? undefined,
            agentId: opts.agentId || effectiveAgentId || undefined,
            message: isResume ? undefined : opts.message,
            resumeAfter: opts.resumeAfter,
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
            toolResults: opts.toolResults,
            clientMessageId: opts.optimisticUser?.id,
            ...streamConfig,
          },
          {
            onSessionStart: (sid) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                flushStreamNow(NEW_STREAM_KEY);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, sid);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, sid);
                originSid = sid;
                // 新会话首条消息期间入队的项尚无 dbId，迁移后补写 DB
                const pending = sessionComposeStore.get(sid).userQueue;
                for (const item of pending) {
                  if (item.dbId || (item.kind !== "user" && item.kind !== "superior")) continue;
                  createSessionQueueItemMutation
                    .mutateAsync({
                      sessionId: sid,
                      kind: item.kind === "superior" ? "superior" : "user",
                      content: item.text,
                      source: item.source ?? "user",
                      sourceName: item.sourceName,
                      agentMessageId: item.agentMessageId,
                      attachments: item.attachments,
                      skillId: item.skillId,
                      skillPrompt: item.skillPrompt,
                    })
                    .then((res) => {
                      const dbId = (res as { data?: { id?: string } })?.data?.id;
                      if (!dbId) return;
                      sessionComposeActions.patchUserQueue(sid, (q) =>
                        q.map((i) => (i.id === item.id ? { ...i, dbId } : i)),
                      );
                    })
                    .catch(() => {});
                }
              }
              // 视图不变量：流回调只在「用户仍在新对话页」时 adopt 新 session，
              // 用户已切走则绝不抢视图（effectiveSessionIdRef 运行时读，不用闭包 keepCurrentView）
              if (!opts.isResume) {
                const current = effectiveSessionIdRef.current;
                if (current === null || current === sid) {
                  flushSync(() => setSessionId(sid));
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("sessionId", sid);
                  if (params.get("agentId")) params.delete("agentId");
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                }
              }
              // session 一建立就刷新侧边栏列表，不要等 onDone——用户发首条消息后
              // 新会话应立即可见，而非等第一条回复结束才出现。
              void utils.session.list.invalidate();
              scheduleStreamSave(true);
            },
            onRoundStart: (round) => {
              const prev = streamLifecycleStore.get(originSid).liveTimeline;
              if (prev.length === 1 && prev[0]?.type === "thinking" && !prev[0].content) {
                streamLifecycleActions.replaceTimeline(originSid, [
                  { type: "thinking" as const, content: "", round },
                ]);
              } else {
                streamLifecycleActions.appendTimelineStep(originSid, {
                  type: "thinking" as const,
                  content: "",
                  round,
                });
              }
            },
            onThinking: (delta) => {
              streamLifecycleActions.appendThinkingDelta(originSid, delta);
            },
            onToken: (delta) => {
              pendingStreamDeltaRef.current.set(
                originSid,
                (pendingStreamDeltaRef.current.get(originSid) ?? "") + delta,
              );
              scheduleStreamFlush(originSid);
            },
            onIntermediateContent: (content, round) => {
              discardStreamFlush(originSid);
              streamLifecycleActions.clearStreamingContent(originSid);
              const prev = streamLifecycleStore.get(originSid).liveTimeline;
              if (!prev.some((step) => step.type === "content" && step.round === round)) {
                streamLifecycleActions.appendTimelineStep(originSid, {
                  type: "content" as const,
                  content,
                  round,
                });
              }
            },
            onToolStart: (name, args, round, toolCallId) => {
              flushStreamNow(originSid);
              streamLifecycleActions.moveStreamingContentToTimeline(originSid, round);
              const prev = streamLifecycleStore.get(originSid).liveTimeline;
              if (prev.some((step) => step.type === "tool" && step.toolCallId === toolCallId)) return;
              streamLifecycleActions.appendTimelineStep(originSid, {
                type: "tool",
                toolCallId,
                name,
                args,
                round,
                status: "running",
                startedAt: Date.now(),
              });
            },
            onToolEnd: (name, result, round, hint, toolCallId) => {
              streamLifecycleActions.updateTimelineStep(
                originSid,
                (step) =>
                  step.type === "tool" && step.toolCallId === toolCallId && step.status === "running",
                { result, hint: hint ?? formatToolResultHint(result), status: "done" },
              );
              if (
                (name === "async_task_run" || name === "spawn_subagent") &&
                result &&
                typeof result === "object"
              ) {
                const r = result as {
                  jobId?: string;
                  status?: string;
                  message?: string;
                  subagentSessionId?: string;
                  subagentName?: string;
                  agentId?: string;
                  success?: boolean;
                };
                if (name === "spawn_subagent" && (r.success || r.agentId || r.subagentSessionId)) {
                  if (r.agentId) {
                    const wsId = selectedWorkspaceId ?? null;
                    const optimisticAgent = {
                      id: r.agentId,
                      name: r.subagentName || `子 Agent ${r.agentId.slice(0, 4)}`,
                      description: null,
                      model: chatConfig.model || "deepseek-v4-flash",
                      tools: [] as string[],
                      tier: "sub" as const,
                      workspaceId: wsId,
                      parentId: effectiveAgentId ?? null,
                      heartbeatModel: null,
                      heartbeat: null,
                      status: "active",
                      source: "native_tool:spawn_subagent",
                      deletedAt: null,
                      deletedBy: null,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                      apiKey: null,
                      systemPrompt: "",
                    };
                    utils.agent.list.setData({ page: 1, pageSize: 100 }, (old) => {
                      if (!old?.items) {
                        return { items: [optimisticAgent], total: 1, page: 1, pageSize: 100, totalPages: 1 };
                      }
                      if (old.items.some((a) => a.id === r.agentId)) return old;
                      return {
                        ...old,
                        items: [optimisticAgent, ...old.items],
                        total: (old.total ?? old.items.length) + 1,
                      };
                    });
                  }
                  void utils.agent.list.invalidate().then(() => utils.agent.list.refetch()).catch(() => undefined);
                  void utils.session.list.invalidate().then(() => utils.session.list.refetch()).catch(() => undefined);
                }
                if (r.jobId && (r.status === "running" || r.status === "queued")) {
                  const jobId = r.jobId;
                  const status = r.status;
                  sessionComposeActions.patchAsyncOverlays(originSid, (prev) => {
                    if (prev.some((q) => q.jobId === jobId)) return prev;
                    const label = r.message || r.subagentName || `${name === "spawn_subagent" ? "子 Agent" : "后台任务"} ${jobId.slice(0, 6)}`;
                    return [
                      {
                        id: `run-${jobId}`,
                        kind: "async-running" as const,
                        text: r.message || "",
                        jobId,
                        taskLabel: label.slice(0, 60),
                        status: status === "queued" ? ("queued" as const) : ("running" as const),
                        subagentSessionId: r.subagentSessionId,
                        subagentName: r.subagentName,
                        createdAt: Date.now(),
                      },
                      ...prev,
                    ];
                  });
                } else if (name === "spawn_subagent" && r.subagentSessionId && !r.jobId) {
                  const overlayId = `spawn-${r.agentId ?? r.subagentSessionId}`;
                  sessionComposeActions.patchAsyncOverlays(originSid, (prev) => {
                    if (prev.some((q) => q.id === overlayId || q.subagentSessionId === r.subagentSessionId)) return prev;
                    const label = r.subagentName || r.message || "子 Agent 任务";
                    return [
                      {
                        id: overlayId,
                        kind: "async-running" as const,
                        text: r.message || "",
                        taskLabel: label.slice(0, 60),
                        status: "running" as const,
                        subagentSessionId: r.subagentSessionId,
                        subagentName: r.subagentName,
                        createdAt: Date.now(),
                      },
                      ...prev,
                    ];
                  });
                }
              }
            },
            onEventId: (id) => {
              streamLifecycleActions.setLastEventId(originSid, id);
            },
            onDone: (data) => {
              if (originSid === NEW_STREAM_KEY && data.sessionId) {
                flushStreamNow(originSid);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, data.sessionId);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, data.sessionId);
                originSid = data.sessionId;
              } else {
                flushStreamNow(originSid);
              }
              if (!opts.isResume) {
                // 视图不变量：onDone 不抢视图。adopt 已在 onSessionStart 完成；
                // 若用户已切走，结果写入该 session 的 MessageStore，用户切回时自然看到。
              }
              if (data.tokenUsage?.total) {
                streamLifecycleActions.setLastRoundTokens(originSid, data.tokenUsage.total);
              }
              if (opts.skillPrompt) {
                updateConfig({ systemPrompt: opts.skillPrompt, customSystemPrompt: true });
              }
              if (data.sessionId) {
                void utils.session.getById.invalidate({ id: data.sessionId }).catch(() => undefined);
              }
              const content = data.content ?? "";
              const assistantMessageId = data.assistantMessageId ?? null;
              // INV-1：先进入 done+pending，再幂等 upsert；MS upsert 会 tryCommit → idle → onStreamCommitted
              streamLifecycleActions.completeStream(originSid, content, { assistantMessageId });
              if (assistantMessageId) {
                sessionMessagesStore.upsertAssistantFromDone(originSid, {
                  assistantMessageId,
                  content,
                  toolCalls: data.toolCalls,
                  tokenUsage: data.tokenUsage ?? null,
                });
                // SSE 可能已先 upsert：再试一次 content/id 匹配
                streamLifecycleActions.tryCommitStream(originSid, {
                  messageId: assistantMessageId,
                  content,
                });
              } else {
                // 无 id（空回复等）：立即 commit，避免队列永久卡住
                streamLifecycleActions.commitStream(originSid);
              }
              if (opts.optimisticUser) {
                sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
              }
              void utils.session.list.invalidate();
            },
            onError: (message, sid, suggestion) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                discardStreamFlush(originSid);
                streamLifecycleActions.migrateStreamSession(NEW_STREAM_KEY, sid);
                sessionComposeActions.migrateComposeSession(NEW_STREAM_KEY, sid);
                originSid = sid;
              } else {
                discardStreamFlush(originSid);
              }
              if (opts.optimisticUser) {
                sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
              }
              const isNoStream =
                typeof message === "string" && message.includes("没有运行中的 Agent 流");
              if (opts.isResume && isNoStream) {
                streamLifecycleActions.clearError(originSid);
                streamLifecycleActions.commitStream(originSid);
                void hydrateSessionMessagesFallback(originSid);
                return;
              }
              streamLifecycleActions.failStream(
                originSid,
                message + (suggestion ? `\n${suggestion}` : ""),
              );
              // error 仍占用队列语义上需释放 → commit 到 idle（保留 error 字段供 UI）
              streamLifecycleActions.commitStream(originSid);
              if (sid && !opts.isResume) {
                // 视图不变量：onError 不抢视图。错误存在该 session 的 lifecycle.error，
                // 用户若仍在新对话页则 adopt 让他看到错误；已切走则不抢。
                const current = effectiveSessionIdRef.current;
                if (current === null || current === sid) {
                  flushSync(() => setSessionId(sid));
                }
              }
            },
          },
          ac.signal,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          if (isPageUnloadingRef.current) {
            return;
          }
          flushStreamNow(originSid);
          const leftover = streamLifecycleStore.get(originSid).streamingContent;
          // INV-1：abort 时只 completeStream（phase=done，live 块继续显示 leftover），
          // 不立即 commit。服务端保存 partial assistant 后会广播 message_upserted
          // （或下方 hydrate 拉回）→ tryCommitAfterAssistant/Hydrate → tryCommitStream
          // 对齐后才 commit → idle。这样 live 块拆除与 stored 气泡出现原子切换，
          // 消除「中断后回复先消失再出现」的空窗。
          streamLifecycleActions.completeStream(originSid, leftover);
          const hydrateSid = originSid === NEW_STREAM_KEY ? (effectiveSessionId ?? "") : originSid;
          if (hydrateSid) void hydrateSessionMessagesFallback(hydrateSid);
          // 兜底：服务端可能无 partial 内容（abort 极早）→ 不会发 message_upserted，
          // done phase 会卡住队列。2s 后仍未 commit 则强制释放。
          window.setTimeout(() => {
            const st = streamLifecycleStore.get(originSid);
            if (st.phase === "done") {
              streamLifecycleActions.commitStream(originSid);
            }
          }, 2000);
          if (opts.optimisticUser) {
            sessionComposeActions.removeOptimisticUserBubble(originSid, opts.optimisticUser.id);
          }
          return;
        }
        discardStreamFlush(originSid);
        streamLifecycleActions.failStream(
          originSid,
          err instanceof Error ? err.message : "对话请求失败",
        );
        streamLifecycleActions.commitStream(originSid);
      } finally {
        discardStreamFlush(originSid);
        streamLifecycleActions.setConnected(originSid, false);
        if (!isPageUnloadingRef.current) {
          const phase = streamLifecycleStore.get(originSid).phase;
          // 异常退出仍停在 streaming：强制 commit 释放占用
          if (phase === "streaming") {
            streamLifecycleActions.commitStream(originSid);
          }
        }
        sessionComposeActions.setActiveAbortController(originSid, null);
        sessionComposeActions.setQueueDraining(originSid, false);
        const finishedTaskId = sessionComposeStore.get(originSid).activeQueueTaskId;
        if (finishedTaskId) {
          sessionComposeActions.setActiveQueueTaskId(originSid, null);
          void finishedTaskId;
        }
        // 队列消费改由 onStreamCommitted（INV-1/2）驱动，finally 不再 hydrate+consume
      }
    },
    [effectiveAgentId, chatConfig, effectiveSessionId, selectedWorkspaceId, updateConfig, utils.session.list, utils.session.getById, utils.agent.list, selectedAgent, scheduleStreamFlush, flushStreamNow, discardStreamFlush, scheduleStreamSave, pathname, router, searchParams, createSessionQueueItemMutation, hydrateSessionMessagesFallback],
  );

  // 用 ref 保存最新的 runStream，供 mount 自动续传使用（避免把 runStream 本身放进 mount effect deps）
  const runStreamRef = useRef(runStream);
  useEffect(() => {
    runStreamRef.current = runStream;
  }, [runStream]);

  // mount：从 sessionStorage 恢复 compose + lifecycle，并自动续传刷新前正在运行的会话
  useEffect(() => {
    try {
      const composeRaw = sessionStorage.getItem(COMPOSE_STORAGE_KEY);
      if (composeRaw) {
        const parsed = JSON.parse(composeRaw) as Record<string, Parameters<typeof sessionComposeStore.hydrate>[0][string]>;
        sessionComposeStore.hydrate(parsed);
      }
      // 兼容旧键：若仍有 kp:chat-stream-states，尝试抽出队列字段
      const legacyRaw = sessionStorage.getItem("kp:chat-stream-states");
      if (legacyRaw && !composeRaw) {
        try {
          const legacy = JSON.parse(legacyRaw) as Record<string, {
            optimistic?: Parameters<typeof sessionComposeStore.hydrate>[0][string]["optimistic"];
            userQueue?: ChatQueueItem[];
            asyncOverlays?: ChatQueueItem[];
            consumedDeliveries?: string[];
          }>;
          const mapped: Record<string, Parameters<typeof sessionComposeStore.hydrate>[0][string]> = {};
          for (const [k, v] of Object.entries(legacy)) {
            mapped[k] = {
              optimistic: v.optimistic ?? [],
              userQueue: v.userQueue ?? [],
              asyncOverlays: v.asyncOverlays ?? [],
              consumedDeliveries: new Set(v.consumedDeliveries ?? []),
            };
          }
          sessionComposeStore.hydrate(mapped);
        } catch {
          /* ignore legacy */
        }
      }
      // INV-8 ④：sessionStorage 恢复完成 = 显式 drain 请求。
      // drain 钩子在后面的 effect 才订阅——drainRequested 标记 + takeDrainRequests
      // 晚订阅补偿保证不丢，不依赖订阅时序。
      for (const sid of sessionComposeStore.listSessionIds()) {
        const compose = sessionComposeStore.get(sid);
        const hasPending =
          compose.userQueue.some(
            (t) =>
              (t.kind === "user" || t.kind === "superior") &&
              (t.text.trim() || t.attachments?.length),
          ) ||
          compose.asyncOverlays.some(
            (t) => t.kind === "async-result" && (t.text.trim() || t.asyncResult),
          );
        if (hasPending) streamLifecycleActions.hydrateDone(sid);
      }
      const lifeRaw = sessionStorage.getItem(LIFECYCLE_STORAGE_KEY);
      if (lifeRaw) {
        const parsed = JSON.parse(lifeRaw) as Record<string, StreamLifecycleState & { isStreaming?: boolean }>;
        for (const [sid, st] of Object.entries(parsed)) {
          if (sid === NEW_STREAM_KEY) continue;
          const wasStreaming = st.phase === "streaming" || st.isStreaming === true;
          if (wasStreaming) {
            streamLifecycleActions.beginStream(sid, {
              streamTargetUserId: st.streamTargetUserId,
              resume: true,
            });
            if (st.streamingContent) {
              streamLifecycleActions.setStreamingContent(sid, st.streamingContent);
            }
            if (st.liveTimeline?.length) {
              streamLifecycleActions.replaceTimeline(sid, st.liveTimeline);
            }
            if (st.lastEventId) {
              streamLifecycleActions.setLastEventId(sid, st.lastEventId);
            }
            console.log("[mount] resuming", sid, "lastEventId", st.lastEventId);
            // runStreamRef 已由先声明的 effect 赋值，事件处理内同步续传，无需 microtask
            void runStreamRef.current({
              targetSessionId: sid,
              resumeAfter: st.lastEventId ?? 0,
              isResume: true,
            });
          }
        }
      }
    } catch (e) {
      console.error("[mount] restore error", e);
    }
  }, []);

  // 卸载 / 刷新前持久化，并标记正在卸载以阻止 finally 清掉 streaming phase
  useEffect(() => {
    const onBeforeUnload = () => {
      isPageUnloadingRef.current = true;
      saveChatStoresToStorage();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      saveChatStoresToStorage();
    };
  }, []);

  // 切回浏览器标签页时：若后台有流式会话连接断开，自动续传；切出时持久化状态
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        saveChatStoresToStorage();
        return;
      }
      const life = streamLifecycleStore.serialize();
      for (const [sid, st] of Object.entries(life)) {
        if (sid === NEW_STREAM_KEY) continue;
        if (st.phase === "streaming" && !sessionComposeActions.getActiveAbortController(sid)) {
          // 事件处理内同步续传，无需 microtask
          void runStreamRef.current({ targetSessionId: sid, resumeAfter: st.lastEventId, isResume: true });
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // 后端主动发现运行中会话并续传：覆盖 sessionStorage 丢失、跨标签、切换 Agent 等场景
  // 仅信任 StreamHub.listRunning()（含 spawn_subagent / triggerAgentRun 的流式运行）
  useEffect(() => {
    const items = runningSessionsQuery.data?.items;
    if (!items || items.length === 0) return;
    for (const item of items) {
      const sid = item.sessionId;
      if (!sid || sid === NEW_STREAM_KEY) continue;
      // 已存在 active stream（abort 非空）说明已自行恢复或在运行中，无需重复 resume
      if (sessionComposeActions.getActiveAbortController(sid)) continue;
      // 架构不变量：挂接进度必须与本地状态一致。
      // - 本地无该运行任何进度（服务端启动的运行：子 Agent triggerAgentRun / report_back 后父会话 autoConsume）：
      //   必须 resumeAfter=0 从头重放事件缓冲重建完整 liveTimeline。
      //   若从尾巴（item.lastEventId）接，thinking/tool 事件全被跳过 → 空 Thinking 卡住、
      //   done 后只有正式回复文本、hydrate 再闪烁重建完整时间线。
      // - 本地已有进度（断线重连）：接在本地 lastEventId 之后，避免重放重复拼接。
      const st = streamLifecycleStore.get(sid);
      const hasLocalProgress =
        st.phase === "streaming" && (st.lastEventId > 0 || st.liveTimeline.some((s) => s.type !== "thinking" || s.content));
      const resumeAfter = hasLocalProgress ? st.lastEventId : 0;
      // runStreamRef 已由先声明的 effect 赋值，同步挂接，无需 microtask
      void runStreamRef.current({ targetSessionId: sid, resumeAfter, isResume: true });
    }
  }, [runningSessionsQuery.data]);

  const consumeQueue = useCallback((targetSessionId?: string) => {
    const viewSid = effectiveSessionId ?? NEW_STREAM_KEY;
    const sid = targetSessionId ?? viewSid;
    const compose = sessionComposeStore.get(sid);
    // INV-2：streaming|done 均占用，禁止开新流
    if (isSessionRunOccupied(sid) || compose.queueDraining) return;

    const isReady = (t: ChatQueueItem) =>
      t.kind !== "async-running" &&
      (t.text.trim() || t.asyncResult || t.attachments?.length);

    // 当前视图：可用 poll 合并后的 asyncResultQueue；后台 session：仅看本地 overlays
    // （异步投递的后台续跑主要由服务端 autoConsumeAsyncDelivery 完成）
    const asyncCandidates =
      sid === viewSid ? asyncResultQueue : compose.asyncOverlays;

    let asyncReady: ChatQueueItem | undefined;
    for (const t of asyncCandidates) {
      // serverConsumed = 服务端 autoConsume 已消费，纯展示，前端不再参与 CLAIM
      if (t.kind === "async-result" && !t.serverConsumed && isReady(t) && !t.pinned) {
        asyncReady = t;
        break;
      }
    }
    let userReady: ChatQueueItem | undefined;
    if (!asyncReady) {
      for (const t of compose.userQueue) {
        if ((t.kind === "user" || t.kind === "superior") && isReady(t)) {
          userReady = t;
          break;
        }
      }
    }
    const task = asyncReady ?? userReady;
    if (!task) return;

    if (task.kind === "superior" && sid === NEW_STREAM_KEY) {
      return;
    }

    const keepCurrentView = sid !== viewSid;
    const sessionMeta = (sessionsQuery.data?.items ?? []).find((s) => s.id === sid);
    const streamAgentId = sessionMeta?.agentId || undefined;

    sessionComposeActions.setQueueDraining(sid, true);

    void (async () => {
      if (task.kind === "async-result" && task.jobId) {
        sessionComposeActions.markDeliveryConsumed(sid, task.jobId);
        try {
          const ack = await ackAsyncDeliveryMutation.mutateAsync({ jobId: task.jobId });
          if (!ack.claimed) {
            sessionComposeActions.setQueueDraining(sid, false);
            void utils.session.listRunning.invalidate();
            if (sid === viewSid) void asyncQueueQuery.refetch();
            // 已释放 drain 锁且在 async 续体内（调用栈已 unwind），直接重试下一项
            consumeRef.current(sid);
            return;
          }
        } catch {
          sessionComposeActions.setQueueDraining(sid, false);
          return;
        }
      }

      if (task.kind === "user" || task.kind === "superior") {
        if (task.kind === "superior") {
          const sessionMessages = sessionMessagesStore.getMessages(sid);
          const already = sessionMessages.some(
            (m) => m.role === "user" && m.content.trim() === task.text.trim(),
          );
          if (already) {
            sessionComposeActions.removeUserQueueItem(sid, task.id);
            if (task.dbId) {
              consumeSessionQueueItemMutation.mutate({ id: task.dbId });
            }
            sessionComposeActions.setQueueDraining(sid, false);
            // 已释放 drain 锁且在 async 续体内，直接重试下一项
            consumeRef.current(sid);
            return;
          }
        }
        sessionComposeActions.removeUserQueueItem(sid, task.id);
        if (task.dbId) {
          consumeSessionQueueItemMutation.mutate({ id: task.dbId });
        }
      } else {
        if (task.jobId) {
          const finishedJobId = task.jobId;
          const finishedStatus = task.status ?? "done";
          const finishedResult = task.asyncResult ?? "";
          sessionComposeActions.patchAsyncOverlays(sid, (prev) => {
            const existing = prev.find((o) => o.jobId === finishedJobId);
            if (!existing) {
              sessionComposeActions.setActiveQueueTaskId(sid, task.id);
              return prev;
            }
            const updated: ChatQueueItem = {
              ...existing,
              id: `run-${finishedJobId}`,
              kind: "async-result",
              status: finishedStatus,
              asyncResult: finishedResult,
              removeAt: Date.now() + 5000,
            };
            sessionComposeActions.setActiveQueueTaskId(sid, updated.id);
            return prev.map((o) => (o.jobId === finishedJobId ? updated : o));
          });
        } else {
          sessionComposeActions.setActiveQueueTaskId(sid, task.id);
        }
      }

      const supportsVision = !!getModelOption(chatConfig.model).supportsVision;
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
      const isAsyncResult = task.kind === "async-result";
      const optimisticText = task.text.trim() || (task.attachments?.length ? "（见附件）" : "");
      const optimisticAttachments = streamAttachments?.length ? streamAttachments : undefined;
      if (!isAsyncResult && (optimisticText || optimisticAttachments)) {
        const existing = sessionComposeStore.get(sid).optimistic;
        if (!existing.some((m) => m.id === optimisticId)) {
          sessionComposeActions.addOptimisticUserBubble(sid, {
            id: optimisticId,
            content: optimisticText,
            attachments: optimisticAttachments,
            createdAt: Date.now(),
          });
        }
      }
      void runStream({
        message: streamMessage,
        attachments: streamAttachments?.length ? streamAttachments : undefined,
        skillId: task.skillId,
        skillPrompt: task.skillPrompt,
        source: isAsyncResult
          ? "sub"
          : task.kind === "superior"
            ? (["super", "manager", "sub", "system"].includes(String(task.source))
                ? (task.source as "super" | "manager" | "sub" | "system")
                : "manager")
            : "user",
        toolResults: isAsyncResult
          ? {
              subagentResult: {
                jobId: task.jobId,
                subagentSessionId: task.subagentSessionId,
                subagentName: task.subagentName ?? `子 Agent ${task.jobId?.slice(0, 6) ?? ""}`,
                sourceType: task.sourceType,
                taskLabel: task.taskLabel,
              },
            }
          : undefined,
        optimisticUser: isAsyncResult ? undefined : { id: optimisticId, text: optimisticText },
        targetSessionId: sid === NEW_STREAM_KEY ? undefined : sid,
        keepCurrentView,
        agentId: streamAgentId,
      });
    })();
  }, [runStream, chatConfig.model, asyncResultQueue, effectiveSessionId, isSessionRunOccupied, consumeSessionQueueItemMutation, ackAsyncDeliveryMutation, utils.session.listRunning, asyncQueueQuery, sessionsQuery.data?.items]);

  /** 优先消费 preferredSessionId，再扫描其它有待消费项的 session（后台不抢视图） */
  const drainAllPendingQueues = useCallback(
    (preferredSessionId?: string) => {
      const viewSid = effectiveSessionId ?? NEW_STREAM_KEY;
      const ordered: string[] = [];
      const seen = new Set<string>();
      const push = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
      };
      if (preferredSessionId) push(preferredSessionId);
      push(viewSid);
      for (const id of sessionComposeStore.listSessionIds()) push(id);

      for (const sid of ordered) {
        const compose = sessionComposeStore.get(sid);
        // INV-2：streaming|done 均占用，跳过
        if (isSessionRunOccupied(sid) || compose.queueDraining) continue;
        const hasUser = compose.userQueue.some(
          (t) =>
            (t.kind === "user" || t.kind === "superior") &&
            (t.text.trim() || t.attachments?.length),
        );
        const asyncCandidates = sid === viewSid ? asyncResultQueue : compose.asyncOverlays;
        const hasAsync = asyncCandidates.some(
          (t) =>
            t.kind === "async-result" &&
            !t.serverConsumed &&
            !t.pinned &&
            (t.text.trim() || t.asyncResult),
        );
        if (!hasUser && !hasAsync) continue;
        consumeQueue(sid);
      }
    },
    [consumeQueue, effectiveSessionId, isSessionRunOccupied, asyncResultQueue],
  );

  useEffect(() => {
    consumeRef.current = drainAllPendingQueues;
  }, [drainAllPendingQueues]);

  // INV-8：drain 的 ②（onStreamCommitted）④（HYDRATE_DONE）消费点。
  // ① 用户入队 / ③ 会话切换在各自事件处理里直接调 consumeRef，不再有任何
  // 「useEffect 监听状态变化 → drain」的兑底驱动。
  useEffect(() => {
    const drain = (sid: string) => {
      streamLifecycleActions.clearDrainRequest(sid);
      // 本文件唯一保留的 queueMicrotask：onStreamCommitted 在 Lifecycle store 的 dispatch
      // 同步栈内触发，consumeQueue → runStream → beginStream 会重入同一个 dispatch。
      // microtask 是重入边界（等 dispatch 栈清空再消费），不是时序猜测补丁——
      // 删掉它任何场景都不丢，只是 drain 会在 store dispatch 内重入执行。
      queueMicrotask(() => consumeRef.current(sid));
    };
    const off = streamLifecycleActions.onStreamCommitted(drain);
    // 晚订阅补偿：sessionStorage 恢复等早于本钩子订阅的 INV-8 ④ 请求，一次性吃掉存量
    for (const sid of streamLifecycleStore.takeDrainRequests()) drain(sid);
    return off;
  }, []);

  // 清理已过期的已完成 async overlay，让进度条稳定展示 5 秒后自动消失
  useEffect(() => {
    if (!effectiveSessionId) return;
    const timer = setInterval(() => {
      const sid = effectiveSessionId;
      const current = sessionComposeStore.get(sid).asyncOverlays;
      const now = Date.now();
      const hasExpired = current.some((o) => o.kind === "async-result" && o.removeAt && o.removeAt <= now);
      if (hasExpired) {
        sessionComposeActions.patchAsyncOverlays(sid, (prev) =>
          prev.filter((o) => !(o.kind === "async-result" && o.removeAt && o.removeAt <= now)),
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [effectiveSessionId]);

  // 流式 rAF 卸载清理：组件卸载时取消所有待处理动画帧 / 残留定时器，避免 setState after unmount
  useEffect(() => {
    const rafMap = streamRafRef.current;
    const deltaMap = pendingStreamDeltaRef.current;
    return () => {
      rafMap.forEach((id) => cancelAnimationFrame(id));
      rafMap.clear();
      deltaMap.clear();
      if (streamSaveTimeoutRef.current) {
        clearTimeout(streamSaveTimeoutRef.current);
        streamSaveTimeoutRef.current = null;
      }
      if (reorderTimerRef.current) {
        clearTimeout(reorderTimerRef.current);
        reorderTimerRef.current = null;
      }
      if (hoverMonitorTimeoutRef.current) {
        clearTimeout(hoverMonitorTimeoutRef.current);
        hoverMonitorTimeoutRef.current = null;
      }
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

  // R16：useCallback 稳定化，使 ChatInputArea memo 后流式期间跳过重渲染
  const enqueueMessage = useCallback(
    (
      text: string,
      skill?: SelectedSkill,
      attachments?: ChatQueueItem["attachments"],
      delivery?: "steer" | "follow_up",
    ) => {
      let messageText = text.trim();
      if ((!messageText && !attachments?.length) || backendDown) return;

      // 斜杠指令：/compact → 作为普通用户消息交给 Agent，由 session_compact 工具执行
      if (/^\/compact\s*$/i.test(messageText) && !attachments?.length) {
        if (!effectiveSessionId) {
          setToast("请先选择或创建一个会话");
          return;
        }
        if (sessionDetail?.status === "archived") {
          setToast("此会话已归档，无法压缩");
          return;
        }
        messageText = "请压缩当前会话上下文";
      }

      if (sessionDetail?.status === "archived") {
        setToast("此会话已归档，请跳转到新会话继续对话");
        return;
      }

      // 运行中：默认 Steering；显式 follow_up 走停前续问（不改 phase，不 beginStream）
      if (effectiveSessionId && isSessionRunOccupied(effectiveSessionId)) {
        const kind = delivery === "follow_up" ? "follow_up" : "steer";
        if (!messageText) return;
        void (async () => {
          try {
            await submitInjectMutation.mutateAsync({
              sessionId: effectiveSessionId,
              content: messageText,
              kind,
            });
            setToast(
              kind === "steer"
                ? "已加入纠偏，将在当前工具批结束后生效"
                : "已加入后续提问，将在本轮结束后继续",
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setToast(msg || "注入失败");
          }
        })();
        return;
      }

      // 500ms 内相同文本（含空附件）视为重复发送，直接丢弃，避免重复气泡。
      const now = Date.now();
      const last = lastEnqueueRef.current;
      const attachmentsKey = attachments?.map((a) => a.name).join("\n") ?? "";
      if (last && now - last.at < 500 && last.text === `${messageText}\n${attachmentsKey}`) {
        return;
      }
      lastEnqueueRef.current = { text: `${messageText}\n${attachmentsKey}`, at: now };
      const skillPrompt = skill
        ? `# Skill: ${skill.name}\n\n${skill.description}\n\n${skill.code}`
        : undefined;
      const sid = effectiveSessionId ?? NEW_STREAM_KEY;
      const localItem = createUserQueueItem(messageText || "（见附件）", {
        skillId: skill?.id,
        skillPrompt,
        attachments,
      });

      // 有真实 sessionId 时：必须先写 DB 拿到 dbId 再入队。
      // 否则消费时无法删除 DB 项，刷新/水合会把同一条再送一遍。
      if (effectiveSessionId) {
        void (async () => {
          try {
            const res = await createSessionQueueItemMutation.mutateAsync({
              sessionId: effectiveSessionId,
              kind: "user",
              content: localItem.text,
              source: "user",
              attachments: localItem.attachments,
              skillId: localItem.skillId,
              skillPrompt: localItem.skillPrompt,
            });
            const dbId = (res as { data?: { id?: string } })?.data?.id;
            if (!dbId) {
              console.warn("[enqueueMessage] createSessionQueueItem 未返回 id，跳过入队以防重复发送");
              return;
            }
            sessionComposeActions.patchUserQueue(effectiveSessionId, (prev) => {
              if (prev.some((i) => i.dbId === dbId || i.id === localItem.id)) return prev;
              if (prev.some((i) => !i.dbId && i.text === localItem.text && i.kind === "user")) {
                return prev.map((i) =>
                  !i.dbId && i.text === localItem.text && i.kind === "user"
                    ? { ...i, dbId }
                    : i,
                );
              }
              return [...prev, { ...localItem, dbId }];
            });
            // INV-8 ①：用户入队 → 显式 drain
            consumeRef.current(effectiveSessionId);
          } catch (err) {
            console.warn("[enqueueMessage] 持久化失败，本会话仍入队（无 dbId）:", err);
            sessionComposeActions.patchUserQueue(effectiveSessionId, (prev) => {
              if (prev.some((i) => i.id === localItem.id || i.text === localItem.text)) return prev;
              return [...prev, localItem];
            });
            // INV-8 ①：用户入队 → 显式 drain
            consumeRef.current(effectiveSessionId);
          }
        })();
        return;
      }

      sessionComposeActions.enqueueUserQueueItem(sid, localItem);
      // INV-8 ①：用户入队 → 显式 drain
      consumeRef.current(sid);
    },
    [backendDown, effectiveSessionId, createSessionQueueItemMutation, submitInjectMutation, sessionDetail?.status, isSessionRunOccupied],
  );

  const handleStop = useCallback(async () => {
    if (effectiveSessionId) {
      // 先通知后端真正停止运行，再 abort 本地连接
      try {
        await stopAgentChat(effectiveSessionId);
      } catch {
        // 后端停止失败也继续 abort 本地连接
      }
    }
    sessionComposeActions.getActiveAbortController(effectiveSessionId)?.abort();
  }, [effectiveSessionId]);

  // R16：稳定 skills 引用，避免 ChatInputArea memo 因 ?? [] 新数组失效
  const skills = useMemo(() => skillsQuery.data?.items ?? [], [skillsQuery.data]);

  const handleRegenerate = (userMessageId: string) => {
    if (!effectiveSessionId || isSessionRunOccupied(effectiveSessionId)) return;
    void runStream({ regenerate: true, regenerateUserMessageId: userMessageId });
  };

  const handleRetry = (messageId: string) => {
    if (!effectiveSessionId || isSessionRunOccupied(effectiveSessionId)) return;
    void runStream({ retryFromMessageId: messageId });
  };

  const handleEditConfirm = (userMessageId: string) => {
    const content = editDraft.trim();
    if (!content || isSessionRunOccupied(effectiveSessionId)) return;
    void runStream({ editMessageId: userMessageId, editContent: content });
  };

  const handleSwitchVersion = async (assistantMessageId: string, versionIndex: number) => {
    // 切版本只读 MS，不开新流；但仍需避免与 streaming 冲突
    if (isSessionStreaming(effectiveSessionId)) return;
    await switchVersion.mutateAsync({ messageId: assistantMessageId, versionIndex });
    // 服务端 afterUpdate 会推 message_upserted；hydrate 作兜底
    void hydrateFromServer();
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
    // 先把当前 effective Agent 固化到 state：如果从已有会话切过来，agentId state 可能
    // 被清空，直接 setSessionId(null) 会让 effectiveAgentId 回退到 default assistant。
    setAgentId((prev) => prev || effectiveAgentId);
    setSessionId(null);
    // 保持当前选中的 Agent，不清空——用户选了哪个 Agent，新会话继续用哪个
    // setAgentId("") 已移除，避免回退到 defaultAgentId(assistant)
    // 输入框 value 已下放到 ChatInputArea，由其 key={effectiveSessionId ?? "new"}
    // 在切换/新建会话时整体 remount 自动清空，无需在此手动 reset。
    setSelectedSkill(null);
    setEditingSessionId(null);
    setChatConfig(resolveNewChatConfig(loadDefaultChatConfig(), selectedAgent));
    streamLifecycleActions.resetSession(NEW_STREAM_KEY);
    sessionComposeActions.resetComposeSession(NEW_STREAM_KEY);
    // 清除 URL 中的 sessionId/agentId/view，确保新建对话不受旧参数束缚
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
    if (params.get("view") !== "main") {
      params.set("view", "main");
      changed = true;
    }
    if (changed) {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    setHistorySubTab("main");
  }, [selectedAgent, effectiveAgentId, searchParams, pathname, router]);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    try {
      // 写 autoName（显示优先字段），而非 title。否则自动命名过的 session
      // autoName 已有值，改 title 被 autoName 屏蔽 → 重命名「屁都没有」。
      // 写 autoName 后 autoNameSession 的幂等检查（autoName 已有值跳过）也保证不会被自动命名覆盖。
      const res = await updateSession.mutateAsync({ id, autoName: trimmed });
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
  }, [updateSession, utils.session.list, effectiveSessionId, refetchSession, setError]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      const res = await deleteSession.mutateAsync({ id });
      if (!res.success) {
        setError(res.error?.message ?? "删除失败");
        setDeleteSessionTarget(null);
        return;
      }
      // 清理 MessageStore 缓存 + 关闭 EventSource + 忘记 hydrate 标记，否则删除后残留数据 / 连接泄漏
      sessionMessagesStore.clearSession(id);
      sessionMessagesStore.forgetSession(id);
      // 三层 store 统一清理：StreamLifecycle + Compose 也会残留已删 session 的 state
      streamLifecycleActions.deleteSession(id);
      sessionComposeActions.deleteComposeSession(id);
      void utils.session.list.invalidate();
      if (effectiveSessionId === id) startNewChat();
      setDeleteSessionTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setDeleteSessionTarget(null);
    }
  }, [deleteSession, effectiveSessionId, startNewChat, utils.session.list, setError]);

  const selectSession = useCallback((id: string) => {
    if (effectiveSessionId === id) return;
    // 多 session 隔离：切换会话只改 sessionId，三层 hook 自动订阅新切片。
    setSessionId(id);
    setAgentId("");
    setUserSelectedWorkspaceId(null);
    setEditingSessionId(null);
    setSelectedSkill(null);
    void utils.session.listRunning.invalidate();
    const targetSt = streamLifecycleStore.get(id);
    if (
      targetSt.phase === "streaming" &&
      !targetSt.connected &&
      !sessionComposeActions.getActiveAbortController(id)
    ) {
      // 事件处理内同步续传，无需 microtask
      void runStreamRef.current({ targetSessionId: id, resumeAfter: targetSt.lastEventId, isResume: true });
    }
    // INV-8 ③：会话切换完成 → 显式 drain（恢复/镜像的待发队列项立即开跑；占用中 drain 自动跳过）
    consumeRef.current(id);
    // 切换会话后同步 URL sessionId。
    // 只有「点进某个会话」时才按会话类型带上 view——这是用户显式导航，不是后台强制。
    // 用户在同一会话内点「主/子 Agent」标签时，只改 view/localStorage，不走这里。
    const params = new URLSearchParams(searchParams.toString());
    params.set("sessionId", id);
    if (params.get("agentId")) params.delete("agentId");
    const targetMeta = (sessionsQuery.data?.items ?? []).find((s) => s.id === id);
    const targetIsSub =
      targetMeta?.kind === "subagent" || !!targetMeta?.parentSessionId;
    if (targetIsSub) {
      params.set("view", "sub");
      setHistorySubTab("sub");
    } else {
      params.set("view", "main");
      setHistorySubTab("main");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [effectiveSessionId, searchParams, pathname, router, sessionsQuery.data?.items, utils.session.listRunning]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    setUserSelectedWorkspaceId(workspaceId);
    const workspaceAgents = (agentsQuery.data?.items ?? []).filter(
      (a: Agent) => a.workspaceId === workspaceId && a.status !== "deleted",
    );
    const tierRank: Record<string, number> = { super: 0, manager: 1, sub: 2 };
    const mainAgent = [...workspaceAgents].sort(
      (a, b) => (tierRank[a.tier] ?? 99) - (tierRank[b.tier] ?? 99),
    )[0];

    // 如果当前 session 的 Agent 不在新 Workspace 中，切到该 Workspace 的主 Agent 新建对话
    const currentAgentInWorkspace = effectiveAgentId
      ? workspaceAgents.some((a: Agent) => a.id === effectiveAgentId)
      : false;

    if (!currentAgentInWorkspace) {
      setAgentId(mainAgent?.id ?? "");
      setSessionId(null);
      streamLifecycleActions.resetSession(NEW_STREAM_KEY);
      sessionComposeActions.resetComposeSession(NEW_STREAM_KEY);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("sessionId");
      params.delete("agentId");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [agentsQuery.data?.items, effectiveAgentId, searchParams, pathname, router]);

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

  // 悬停会话时预加载消息并显示右上角监控小窗口（默认关闭，对话设置可开）
  const handleSessionHover = useCallback(
    (id: string) => {
      if (!sessionHoverPreviewEnabled) return;
      if (!id || id === effectiveSessionId) return;
      if (hoverMonitorTimeoutRef.current) clearTimeout(hoverMonitorTimeoutRef.current);
      setHoverMonitorSessionId(id);
      void utils.message.listForChat.prefetchInfinite({ sessionId: id, limit: 8 });
    },
    [utils, effectiveSessionId, sessionHoverPreviewEnabled],
  );

  const handleSessionHoverEnd = useCallback((id: string) => {
    hoverMonitorTimeoutRef.current = setTimeout(() => {
      setHoverMonitorSessionId((current) => (current === id ? null : current));
    }, 200);
  }, []);

  const handleHoverMonitorEnter = useCallback(() => {
    if (hoverMonitorTimeoutRef.current) clearTimeout(hoverMonitorTimeoutRef.current);
  }, []);

  const handleHoverMonitorLeave = useCallback(() => {
    hoverMonitorTimeoutRef.current = setTimeout(() => {
      setHoverMonitorSessionId(null);
    }, 200);
  }, []);
  const handleStartRename = useCallback((id: string) => {
    setEditingSessionId(id);
    const s = sessionsQuery.data?.items.find((x) => x.id === id);
    // 预填当前显示名（autoName 优先于 title），否则编辑框显示旧 title 误导用户
    setRenameDraft(s?.autoName || s?.title || "");
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
    if (s) {
      setDeleteSessionTarget({ id: s.id, title: s.title });
      return;
    }
    // WorkspaceTree 子 Agent 会话可能不在主 sessionsQuery 里
    setDeleteSessionTarget({ id, title: "该会话" });
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

  const renderAssistantBubble = (group: MessageGroup, isLastGroup: boolean) => {
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
        className="group/msg relative mb-6 ml-12 flex max-w-[88%] flex-col items-start gap-1"
      >
        <div className="w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-left text-sm text-[var(--kp-text-1)] shadow-sm">
          <PostContent content={active.content} className="prose-sm max-w-none text-left" />
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
          showRegenerate={isLastGroup}
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
              "group/msg ml-12 flex max-w-[88%] flex-col items-start gap-1",
              streamingContent ? "mb-6" : "mb-4",
            )}
            data-testid="streaming-assistant-bubble"
          >
            {streamingContent ? (
              <div className="min-h-[3rem] w-full rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-left text-sm text-[var(--kp-text-1)] shadow-sm">
                <PostContent content={streamingContent} className="prose-sm max-w-none text-left" />
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

  // 单个消息组渲染（用户气泡 + 思考时间线/中间步骤 + assistant 气泡 或 原位流式块）
  // 提取为函数供虚拟列表 itemContent 调用，仅可见项会执行。
  const renderMessageGroup = (group: MessageGroup, groupIdx: number) => {
    const isLastUser = groupIdx === lastGroupIndex;
    const isEditing = editingUserId === group.userMessage.id;
    const msgSource = (group.userMessage as { source?: string }).source ?? "user";
    const msgToolResults = (group.userMessage as { toolResults?: unknown }).toolResults;
    const subResult = (msgToolResults as {
      subagentResult?: {
        subagentName?: string;
        sourceType?: string;
        taskLabel?: string;
      };
    } | undefined)?.subagentResult;
    const subagentName = msgSource === "sub" ? subResult?.subagentName : undefined;
    // #24 子代理会话中，父 Agent 下发的任务消息视觉上像用户消息（右侧）。
    // source 可能是 super / manager（取决于父 Agent tier）。
    const isParentAgentTask =
      isSubagentSession && (msgSource === "super" || msgSource === "manager");
    // 异步结果投递：右侧气泡 + async sleep / async task 角标
    const isAsyncResultDelivery = msgSource === "sub" && !!subResult;
    // 心跳触发：放右侧（通知位），气泡内文字仍左对齐；视觉用灰底+橙标，不走 brand 用户色
    const isHeartbeat = msgSource === "system";
    const isRightSide = isHeartbeat
      || (isSubagentSession
        ? msgSource === "user" || isParentAgentTask || isAsyncResultDelivery
        : msgSource === "user" || msgSource === "sub" || isParentAgentTask);
    const isAgentMessage = !isRightSide;
    return (
      <div className="flex flex-col">
        <div className={cn("flex w-full", isRightSide ? "justify-end" : "justify-start")}>
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            data-testid="user-message-bubble"
            className={cn(
              "group/msg relative mb-3 flex flex-col gap-1",
              // 异步投递 / 父 Agent 任务含 markdown 表格，需更宽
              isAsyncResultDelivery || isParentAgentTask ? "max-w-[92%]" : "max-w-[70%]",
              isRightSide ? "items-end self-end" : "items-start self-start",
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
                      loading="lazy"
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
              "relative w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl px-4 py-3 text-left text-sm shadow-sm",
              isHeartbeat || isAgentMessage
                ? "bg-[var(--kp-bg-alt)] text-[var(--kp-text-1)] border border-[var(--kp-divider)]"
                : isAsyncResultDelivery
                  // 子 Agent 返回结果：比正常用户气泡（--kp-brand-deep）略微深一点点（--kp-brand-darker），均达 AA
                  ? "bg-[var(--kp-brand-darker)] text-white"
                  : "bg-[var(--kp-brand-deep)] text-white",
            )}>
              <MessageSourceLabel
                source={msgSource}
                isSubagentSession={isSubagentSession}
                align={isRightSide ? "right" : "left"}
                subagentName={subagentName}
                asyncKind={isAsyncResultDelivery ? subResult?.sourceType : undefined}
                taskLabel={isAsyncResultDelivery ? subResult?.taskLabel : undefined}
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
                  className="block w-full resize-none border-0 bg-transparent p-0 text-left text-sm leading-relaxed text-white outline-none placeholder:text-white/50 [field-sizing:content]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleEditConfirm(group.userMessage.id);
                    }
                    if (e.key === "Escape") setEditingUserId(null);
                  }}
                />
              ) : isAsyncResultDelivery || isParentAgentTask ? (
                // 子 Agent 异步投递 / 父 Agent 下发任务：内容是 markdown（报告、表格、列表），用 PostContent 渲染
                // 气泡底色与正常用户气泡一致（bg-brand + text-white），prose-invert 让 markdown 文字/边框在深色背景上可读
                <PostContent
                  content={group.userMessage.content}
                  className="prose-sm prose-invert max-w-none text-left [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_a]:text-white [&_strong]:text-white [&_code]:bg-white/15 [&_pre]:bg-white/10 [&_blockquote]:border-white/40 [&_blockquote]:text-white/80"
                />
              ) : (
                <p className="whitespace-pre-wrap text-left leading-relaxed">{group.userMessage.content}</p>
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
              showEdit={isLastUser && !isHeartbeat}
              showRetry={isLastUser && !isEditing && !isHeartbeat}
              showRegenerate={false}
              isEditing={isEditing}
              disabled={isStreaming}
              copied={copiedId === group.userMessage.id}
            />
          </motion.div>
        </div>
        {(isStreaming && streamTargetUserId === group.userMessage.id) ||
        (!!group.assistantMessage && group.assistantMessage.id === inFlightAssistantId)
          ? // INV-4：本轮流式的组（重试原位 / assistant 提前 upsert）由 live 块独占渲染，
            // stored timeline+气泡在 commit 前不渲染 → live→stored 在同一列表项内原子切换，无双渲染闪烁
            renderLiveStreamBlock()
          : (
              <>
                {renderIntermediateSteps(group)}
                <div className="flex w-full justify-start">
                  {renderAssistantBubble(group, isLastUser)}
                </div>
              </>
            )}
      </div>
    );
  };

  // 乐观消息渲染（用户发送后、流式落地前的占位气泡）
  const renderOptimisticMessage = (msg: { id: string; content: string; attachments?: ChatImageAttachment[] }) => (
    <div className="mb-4 flex justify-end">
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
                  loading="lazy"
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
        <div className="w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl bg-[var(--kp-brand-deep)] px-4 py-3 text-sm text-white opacity-80">
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    </div>
  );

  // 统一虚拟列表数据：消息组 + 乐观消息 + 尾部流式块（仅 !streamTargetUserId 时）
  type ChatItem =
    | { kind: "group"; key: string; group: MessageGroup; index: number }
    | { kind: "optimistic"; key: string; msg: { id: string; content: string; attachments?: ChatImageAttachment[]; createdAt?: number } }
    | { kind: "live"; key: "live-trailing" };
  // 后端已持久化的用户消息如果带有 clientMessageId，则隐藏对应的乐观气泡，避免重复显示。
  const materializedClientIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      const cid = (m as { toolResults?: { clientMessageId?: string } | null }).toolResults?.clientMessageId;
      if (cid) set.add(cid);
    }
    return set;
  }, [messages]);
  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = messageGroups.map((group, index) => ({
      kind: "group",
      key: group.userMessage.id,
      group,
      index,
    }));
    for (const msg of optimistic) {
      if (materializedClientIds.has(msg.id)) continue;
      items.push({ kind: "optimistic", key: msg.id, msg });
    }
    // INV-4：in-flight assistant 已物化进组（live 块在组内原位渲染）时，不再渲染尾部 live 项
    const inFlightMaterialized =
      !!inFlightAssistantId &&
      messageGroups.some((g) => g.assistantMessage?.id === inFlightAssistantId);
    if (showLiveStream && !streamTargetUserId && !inFlightMaterialized) {
      items.push({ kind: "live", key: "live-trailing" });
    }
    return items;
  }, [messageGroups, optimistic, showLiveStream, streamTargetUserId, materializedClientIds, inFlightAssistantId]);

  const handleNavScrollToIndex = useCallback((index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
  }, []);

  // 当前 Workspace 下的子 Agent 数量（用于子 Agent 标签徽标）
  const currentSubAgentCount = useMemo(() => {
    return (agentsQuery.data?.items ?? []).filter(
      (a: Agent) => a.workspaceId === selectedWorkspaceId && a.tier === "sub" && a.status !== "deleted",
    ).length;
  }, [agentsQuery.data?.items, selectedWorkspaceId]);

  // 左栏内容：避免 JSX 内嵌多层三元表达式导致解析/维护困难
  const leftPanelBody = useMemo(() => {
    if (leftTab === "async") {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {asyncProgressSteps.length > 0 && (
            <div className="border-b border-[var(--kp-divider)] px-3 pt-3" data-testid="async-progress-block">
              <ThinkingTimeline steps={asyncProgressSteps} isLive />
            </div>
          )}
          <AsyncTaskPanel
            parentSessionId={mainSessionId ?? undefined}
            onCancelJob={(jobId) => cancelAsyncJobMutation.mutate({ jobId })}
            onRetryJob={(jobId) => {
              sessionComposeActions.markDeliveryConsumed(effectiveSessionId ?? NEW_STREAM_KEY, jobId);
              retryAsyncJobMutation.mutate({ jobId });
            }}
          />
        </div>
      );
    }
    const isMain = historySubTab === "main";
    return (
      <>
        {/* 对话历史子标签页：主 Agent + 子 Agent */}
        <div className="flex gap-1 border-b border-[var(--kp-divider)] px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setHistorySubTab("main");
              syncChatUiToUrl({ view: "main" });
              // 当前停在子会话时，顺带切回父会话，避免中栏仍卡在失败的子任务页
              if (isSubagentSession && parentSessionId) {
                selectSession(parentSessionId);
              }
            }}
            data-testid="history-subtab-main"
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              isMain
                ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
            )}
          >
            主 Agent
          </button>
          <button
            type="button"
            onClick={() => {
              setHistorySubTab("sub");
              syncChatUiToUrl({ view: "sub" });
            }}
            data-testid="history-subtab-sub"
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              !isMain
                ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
            )}
          >
            子 Agent
            {currentSubAgentCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--kp-bg-mute)] px-1 py-0 text-[9px] font-semibold text-[var(--kp-text-2)]">
                {currentSubAgentCount}
              </span>
            )}
          </button>
        </div>

        <div className="w-64 border-b border-[var(--kp-divider)] px-3 py-2">
          <WorkspaceSelect
            value={selectedWorkspaceId}
            workspaces={workspacesQuery.data?.items ?? []}
            onChange={selectWorkspace}
            disabled={workspacesQuery.isLoading}
          />
        </div>

        <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">
            {isMain ? "对话历史" : "子 Agent"}
          </h2>
          <div className="flex items-center gap-0.5">
            {isMain ? (
              <>
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
                    bulkMode && "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
                  )}
                  aria-label="批量管理"
                  title="批量管理会话"
                >
                  <ListChecks className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={startNewChat}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}
                  aria-label="新建对话"
                  title="新建对话（发送首条消息时创建）"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="subagent-create-button"
                onClick={() => setShowCreateSubagent(true)}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}
                aria-label="新建子 Agent 任务"
                title="新建子 Agent 任务"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* 批量操作条（仅主 Agent 标签） */}
        {isMain && bulkMode && (
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
              placeholder={isMain ? "搜索会话…" : "搜索子 Agent…"}
              data-testid="session-search"
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[var(--kp-brand)]"
            />
          </div>
        </div>

        <div className="w-64 flex-1 overflow-y-auto p-2" data-testid="session-list">
          {hasWorkspaces ? (
            /* Swarm 模式：当前 Workspace → Agent → Session 树 */
            <WorkspaceTree
              currentWorkspaceId={selectedWorkspaceId}
              effectiveSessionId={effectiveSessionId}
              effectiveAgentId={effectiveAgentId}
              agents={agentsQuery.data?.items ?? []}
              onSelectSession={selectSession}
              onHoverSession={handleSessionHover}
              onHoverSessionEnd={handleSessionHoverEnd}
              onDeleteSession={handleRequestDelete}
              onNewChat={startNewChat}
              searchQuery={sessionSearch}
              mode={isMain ? "main" : "sub"}
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
                          aria-label={`选择会话 ${s.autoName || s.title}`}
                        />
                      )}
                      <div className={cn(bulkMode && "min-w-0 flex-1")}>
                        <SessionListItem
                          session={s}
                          active={effectiveSessionId === s.id}
                          editing={editingSessionId === s.id}
                          renameDraft={renameDraft}
                          onSelect={handleSessionSelect}
                          onHover={handleSessionHover}
                          onHoverEnd={handleSessionHoverEnd}
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
      </>
    );
  }, [
    leftTab,
    historySubTab,
    mainSessionId,
    effectiveSessionId,
    effectiveAgentId,
    selectSession,
    currentSubAgentCount,
    setShowCreateSubagent,
    bulkMode,
    setBulkSelected,
    filteredSessions,
    bulkDeleteMutation.isPending,
    setShowBulkDeleteConfirm,
    sessionSearch,
    setSessionSearch,
    hasWorkspaces,
    groupedSessions,
    bulkSelected,
    handleSessionSelect,
    handleSessionHover,
    handleSessionHoverEnd,
    handleStartRename,
    setRenameDraft,
    handleConfirmRename,
    isSubagentSession,
    parentSessionId,
    syncChatUiToUrl,
    handleCancelRename,
    handleRequestDelete,
    editingSessionId,
    renameDraft,
    agentsQuery.data?.items,
    selectedWorkspaceId,
    selectWorkspace,
    workspacesQuery.data?.items,
    workspacesQuery.isLoading,
    startNewChat,
    asyncProgressSteps,
    cancelAsyncJobMutation,
    retryAsyncJobMutation,
  ]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className={cn("flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] transition-all duration-300", leftOpen ? "w-64" : "w-0 overflow-hidden border-r-0")}>
        <div className="w-64 shrink-0 border-b border-[var(--kp-divider)] px-3 py-2.5" data-testid="chat-left-panel-header">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-[var(--kp-text-1)]">
                {selectedAgent?.name ?? "assistant"}
              </div>
              <div className="truncate text-[10px] text-[var(--kp-text-3)]">{chatConfig.model}</div>
            </div>
          </div>
          {/* 左栏顶层标签页：对话历史 + 异步任务 */}
          <div className="mt-2 flex gap-1 rounded-lg bg-[var(--kp-bg-mute)] p-0.5">
            <button
              type="button"
              onClick={() => {
                setLeftTab("history");
                syncChatUiToUrl({ panel: "history" });
              }}
              data-testid="left-tab-history"
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                leftTab === "history"
                  ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
              )}
            >
              对话历史
            </button>
            <button
              type="button"
              onClick={() => {
                setLeftTab("async");
                syncChatUiToUrl({ panel: "async" });
              }}
              data-testid="left-tab-async"
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                leftTab === "async"
                  ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                  : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
              )}
            >
              异步任务
              {asyncTaskActiveCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--kp-brand-soft)] px-1 py-0 text-[9px] font-semibold text-[var(--kp-brand-deep)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--kp-brand)]" />
                  {asyncTaskActiveCount}
                </span>
              )}
            </button>
          </div>
        </div>
        {leftPanelBody}
      </aside>

      {sessionHoverPreviewEnabled && (
        <ChatHoverMonitor
          sessionId={hoverMonitorSessionId}
          onMouseEnter={handleHoverMonitorEnter}
          onMouseLeave={handleHoverMonitorLeave}
          onClose={() => setHoverMonitorSessionId(null)}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[var(--kp-divider)] px-4 py-2.5">
          <button type="button" onClick={() => setLeftOpen((v) => !v)} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}>
            <PanelLeft className="h-4 w-4" />
          </button>
          <Bot className="h-5 w-5 shrink-0 text-[var(--kp-brand)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">
                {sessionDetail?.autoName || sessionDetail?.title || "Agent 对话"}
              </h1>
              {isLoadingOlderMessages && !isStreaming && (
                <Loader2 className="h-3 w-3 animate-spin text-[var(--kp-text-3)]" />
              )}
            </div>
            <p className="truncate text-xs text-[var(--kp-text-3)]">
              {selectedAgent?.name ?? "—"} · {chatConfig.model}
              {queue.length > 0 && ` · 队列 ${queue.length}`}
            </p>
          </div>
          {effectiveSessionId && sessionDetail && (
            <SessionContextBar
              messages={messages}
              systemPrompt={chatConfig.systemPrompt}
              modelId={chatConfig.model}
              contextSummary={sessionDetail.contextSummary}
              onCompact={() => enqueueMessage("请压缩当前会话上下文")}
              compactPending={isSessionRunOccupied(effectiveSessionId ?? "")}
              className="hidden shrink-0 lg:flex"
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
            <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
            <span className="font-medium text-[var(--kp-brand-deep)]">子 Agent 任务</span>
            {sessionDetail?.status && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  sessionDetail.status === "running" || sessionDetail.status === "queued"
                    ? "bg-blue-100 text-blue-700"
                    : sessionDetail.status === "completed"
                      ? "bg-green-100 text-green-700"
                      : sessionDetail.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700",
                )}
              >
                {sessionDetail.status === "running" && "运行中"}
                {sessionDetail.status === "queued" && "排队中"}
                {sessionDetail.status === "completed" && "已完成"}
                {sessionDetail.status === "failed" && "失败"}
                {sessionDetail.status === "paused" && "已暂停"}
                {sessionDetail.status === "active" && "活跃"}
                {!["running", "queued", "completed", "failed", "paused", "active"].includes(sessionDetail.status) && sessionDetail.status}
              </span>
            )}
            {sessionDetail?.taskDescription && (
              <span className="min-w-0 flex-1 truncate text-[var(--kp-text-2)]">
                {sessionDetail.taskDescription}
              </span>
            )}
            {parentSessionId && (
              <Link
                href={`/chat?sessionId=${parentSessionId}`}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
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
              messages={messages}
              systemPrompt={chatConfig.systemPrompt}
              modelId={chatConfig.model}
              contextSummary={sessionDetail.contextSummary}
              onCompact={() => enqueueMessage("请压缩当前会话上下文")}
              compactPending={isSessionRunOccupied(effectiveSessionId ?? "")}
            />
          </div>
        )}

        {backendDown && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>后端未连接，请运行 <code className="rounded bg-amber-100 px-1">pnpm dev</code></span>
          </div>
        )}

        {(rotateBanner || (sessionDetail?.status === "archived" && sessionDetail.rotatedToSessionId)) && (
          <div
            data-testid="session-rotate-banner"
            className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/40 px-3 py-2 text-xs text-[var(--kp-brand-deep)]"
          >
            <span className="min-w-0 flex-1 truncate">
              新 session 已创建：
              {rotateBanner?.newTitle ?? "续写会话"}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-md bg-[var(--kp-brand-deep)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
              onClick={() => {
                const id = rotateBanner?.newSessionId ?? sessionDetail?.rotatedToSessionId;
                if (!id) return;
                setRotateBanner(null);
                selectSession(id);
              }}
            >
              点击跳转
            </button>
            {rotateBanner && (
              <button
                type="button"
                className="shrink-0 rounded-md px-1.5 py-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
                aria-label="关闭提示"
                onClick={() => setRotateBanner(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="relative flex min-h-0 flex-1">
          {!isMessagesHydrated && !!effectiveSessionId && !hasMessages ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--kp-text-3)]" />
            </div>
          ) : !hasMessages && !backendDown ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-4 text-center text-[var(--kp-text-3)] md:px-6">
              <Bot className="mb-1 h-12 w-12 opacity-40" />
              <p className="text-sm">发送第一条消息开始对话</p>
              {/* #12 Swarm 新手引导：无 Workspace 时展示（可关闭，localStorage 记忆） */}
              {!hasWorkspaces && showOnboarding && (
                <div className="relative max-w-md rounded-2xl border border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)] p-4 text-left" data-testid="swarm-onboarding">
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
                    <li>· 也可以在 <Link href="/workspaces" className="text-[var(--kp-brand-deep)] underline">工作区管理页</Link> 手动创建</li>
                    <li>· 长任务会派生子 Agent 后台执行，完成后结果自动回到对话</li>
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              className="flex-1 min-h-0"
              data={chatItems}
              computeItemKey={(_, item) => item.key}
              itemContent={(_, item) => (
                <div className="px-4 py-1 md:px-6">
                  {item.kind === "group" && renderMessageGroup(item.group, item.index)}
                  {item.kind === "optimistic" && renderOptimisticMessage(item.msg)}
                  {item.kind === "live" && renderLiveStreamBlock()}
                </div>
              )}
              components={{
                // 顶部加载更早时显示细条 spinner（无按钮，滚到顶部自动触发，见 startReached）
                Header: () =>
                  isLoadingOlderMessages ? (
                    <div className="flex justify-center py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--kp-text-3)]" />
                    </div>
                  ) : (
                    <div className="h-2" />
                  ),
                Footer: () => <div className="h-4" />,
              }}
              followOutput={(atBottom) => (atBottom ? "auto" : false)}
              increaseViewportBy={{ top: 600, bottom: 600 }}
              // P0-1：滚到顶部自动 fetchNextPage 加载更早消息（业界标准 infinite-up-scroll，无按钮）；
              // Virtuoso 按 computeItemKey 稳定 id 在 prepend 时自动保持滚动位置。
              startReached={() => {
                if (hasOlderMessages && !isLoadingOlderMessages) {
                  void loadOlderMessages();
                }
              }}
            />
          )}
          <MessageNavRail items={navItems} onScrollToIndex={handleNavScrollToIndex} />
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
                      // 超时 → 建议转后台任务：把上一条用户消息包装成 async_task_run 请求重新入队
                      const lastGroup = messageGroups[messageGroups.length - 1];
                      const lastText = lastGroup?.userMessage.content;
                      if (lastText) {
                        sessionComposeActions.patchUserQueue(effectiveSessionId ?? NEW_STREAM_KEY, (prev) => [
                          ...prev,
                          createUserQueueItem(`请用 async_task_run 在后台执行这个任务（避免前台超时）：\n${lastText}`),
                        ]);
                        streamLifecycleActions.clearError(effectiveSessionId ?? NEW_STREAM_KEY);
                        setViewError(null);
                        // INV-8 ①：用户点击入队 → 显式 drain
                        // （clearError 在已是 idle 时无转移，不会触发 ②）
                        consumeRef.current(effectiveSessionId ?? NEW_STREAM_KEY);
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

        <div className="border-t border-[var(--kp-divider)] px-4 pt-3 md:px-6">
          <UserSendQueuePanel
            items={sortQueueItems(userQueue)}
            onChange={(items) => {
              const { userQueue: uq, asyncOverlays: ao } = splitQueueByKind(items, asyncQueueQuery.data);
              sessionComposeActions.setUserQueue(effectiveSessionId ?? NEW_STREAM_KEY, uq);
              sessionComposeActions.setAsyncOverlays(effectiveSessionId ?? NEW_STREAM_KEY, ao);
              persistQueueOrder(uq);
            }}
            onRemove={(id) => {
              const target = userQueue.find((t) => t.id === id);
              sessionComposeActions.removeUserQueueItem(effectiveSessionId ?? NEW_STREAM_KEY, id);
              sessionComposeActions.patchAsyncOverlays(effectiveSessionId ?? NEW_STREAM_KEY, (q) =>
                q.filter((t) => t.id !== id),
              );
              if (target?.dbId) {
                deleteSessionQueueItemMutation.mutate({ id: target.dbId });
              }
            }}
            asyncStats={asyncQueueStatsQuery.data}
          />
          <ChatInputArea
            key={effectiveSessionId ?? "new"}
            onSend={enqueueMessage}
            onStop={handleStop}
            disabled={backendDown || sessionDetail?.status === "archived"}
            isStreaming={isStreaming}
            queueLength={userQueue.length}
            skills={skills}
            selectedSkill={selectedSkill}
            onSkillChange={setSelectedSkill}
            modelHint={modelOpt.inputHint ?? (modelOpt.supportsVision ? "多模态 · 支持图片" : "纯文本 · 图片将 OCR 后发送")}
            modelId={chatConfig.model}
            supportsVision={!!modelOpt.supportsVision}
            onOpenConfig={() => {
              setRightOpen(true);
              setRightTab("config");
            }}
            sessionHint={
              sessionDetail?.status === "archived"
                ? sessionDetail.rotatedToSessionId
                  ? "此会话已归档。请点击上方提示跳转到新会话继续对话。"
                  : "此会话已归档，无法继续发送消息。"
                : isSubagentSession
                  ? "这是子 Agent 任务会话。你直接发送的消息只在本会话内处理，不会回传父会话；只有父 Agent 下发的任务结果才会投递回父会话。"
                  : undefined
            }
            sessionId={effectiveSessionId}
          />
        </div>
      </div>

      <aside
        className={cn(
          "relative z-40 flex shrink-0 flex-col overflow-x-hidden border-l border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 backdrop-blur-xl transition-[width] duration-300 ease-[var(--kp-spring-gentle)]",
          rightOpen ? "w-[360px]" : "w-0 overflow-hidden border-l-0",
        )}
      >
        <AnimatePresence mode="wait">
          {rightOpen && (
            <motion.div
              key="right-panel"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-full min-w-0 flex-col overflow-x-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--kp-divider)] px-3 py-2.5">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setRightTab("config")}
                    data-testid="right-tab-config"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                      rightTab === "config"
                        ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                        : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
                    )}
                  >
                    配置
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab("runtime")}
                    data-testid="right-tab-runtime"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                      rightTab === "runtime"
                        ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                        : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
                    )}
                  >
                    状态
                    {runtimePendingItems.length > 0 && (
                      <span className="ml-1 inline-flex min-w-[1rem] justify-center rounded-full bg-[var(--kp-brand-soft)] px-1 text-[9px] font-semibold text-[var(--kp-brand-deep)]">
                        {runtimePendingItems.length}
                      </span>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setRightOpen(false)}
                  className="text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
                  title="收起面板"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {rightTab === "config" ? (
                  <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                    <ChatSettingsPanel
                      chatConfig={chatConfig}
                      updateConfig={updateConfig}
                      resetPromptToAgent={resetPromptToAgent}
                      onOpenPromptEditor={handleOpenPromptEditor}
                      skills={skills}
                      selectedSkill={selectedSkill}
                      onSelectSkill={setSelectedSkill}
                      modelSupportsReasoning={!!(modelOpt.supportsThinking ?? modelOpt.supportsReasoning)}
                      modelReasoningRequired={!!modelOpt.reasoningRequired}
                      tokenBudget={tokenBudget}
                    />
                  </div>
                ) : (
                  <RuntimeStatusPanel
                    tab={runtimeSubTab}
                    onTabChange={setRuntimeSubTab}
                    pendingItems={runtimePendingItems}
                    consumedItems={runtimeConsumedItems}
                    heldItems={runtimeHeldItems}
                    onCancel={(jobId) => cancelAsyncJobMutation.mutate({ jobId })}
                    onTogglePin={(jobId, pinned) => pinAsyncJobMutation.mutate({ jobId, pinned })}
                  />
                )}
              </div>
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
        parentSessionId={mainSessionId ?? undefined}
        parentAgentId={mainAgentId}
        parentAgentTools={selectedAgent?.tools}
        onClose={() => setShowCreateSubagent(false)}
        onCreated={() => setToast("子 Agent 任务已启动，结果完成后自动进入对话")}
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
