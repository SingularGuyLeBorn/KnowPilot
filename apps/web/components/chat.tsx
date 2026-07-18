"use client";

/**
 * Agent Chat — 左栏 + 标签/分屏中栏 · 多版本 · 消息编辑 · Skill / 触发
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useAgent } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
  loadDefaultChatConfig,
  resolveNewChatConfig,
} from "@/lib/chatConfig";
import { type Agent, type ChatMessage } from "@knowpilot/shared";
import {
  sessionQueueItemToChatItem,
  mergeUserQueueFromDb,
} from "@/lib/chatQueueTypes";
import { ChatHoverMonitor } from "@/components/chatHoverMonitor";
import { ChatOverlays } from "@/components/chatOverlays";
import { ChatSidebar } from "@/components/chatSidebar";
import { ChatTabBar } from "@/components/chatTabBar";
import { ChatSessionPane } from "@/components/chatSessionPane";
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
import { useChatUiPrefs } from "@/lib/useChatUiPrefs";
import { useChatConfig } from "@/lib/useChatConfig";
import { useChatHoverMonitor } from "@/lib/useChatHoverMonitor";
import { useSubagentMessageMirror } from "@/lib/useSubagentMessageMirror";
import { useChatAsyncOverlayEffects } from "@/lib/useChatAsyncOverlayEffects";
import { saveChatStoresToStorage, useChatRunStream } from "@/lib/useChatRunStream";
import { useChatQueueDrain } from "@/lib/useChatQueueDrain";
import { useChatSseSubscriptions } from "@/lib/useChatSseSubscriptions";
import { useChatDerivedQueues } from "@/lib/useChatDerivedQueues";
import { useChatTabs } from "@/lib/useChatTabs";
import { sessionLabel } from "@/lib/displayLabels";
import {
  COMPOSE_STORAGE_KEY,
  LIFECYCLE_STORAGE_KEY,
  NEW_STREAM_KEY,
  TAB_TITLE_CACHE_KEY,
} from "@/lib/chatKeys";
import type { ChatSessionConfig } from "@knowpilot/shared";

/* ─── Main ─── */

export function ChatView() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const agentFromUrl = searchParams.get("agentId");
  const sessionFromUrl = searchParams.get("sessionId");
  const splitFromUrl = searchParams.get("split");

  const {
    tabs,
    focusedSessionId,
    visibleSessionIds,
    tabsHydrated,
    openTab,
    openInOtherPane,
    focusTab,
    focusPane,
    closeTab,
    enterSplit,
    exitSplit,
    startNewChatInTabs,
    ensureFocusedSession,
    ensureSplitWith,
  } = useChatTabs();

  /** 与旧单焦点 API 对齐：焦点 pane 的 session；runStream 新建会话时 openTab */
  const sessionId = focusedSessionId;
  const setSessionId = useCallback(
    (id: string | null) => {
      if (id) openTab(id);
      else startNewChatInTabs();
    },
    [openTab, startNewChatInTabs],
  );

  const [agentId, setAgentId] = useState("");
  const [userSelectedWorkspaceId, setUserSelectedWorkspaceId] = useState<string | null>(null);
  // 视图级非流式错误（侧栏重命名等）；中栏流式 error 在 ChatSessionPane
  const [, setViewError] = useState<string | null>(null);
  /** 焦点 pane 上报的配置（runStream + Prompt overlay） */
  const [focusedPaneConfig, setFocusedPaneConfig] = useState<ChatSessionConfig | null>(null);
  const [focusedConfigApi, setFocusedConfigApi] = useState<{
    updateConfig: (patch: Partial<ChatSessionConfig>) => void;
    resetPromptToAgent: () => void;
  } | null>(null);
  // 左栏 UI 偏好收拢于 useChatUiPrefs：读写 localStorage
  const {
    leftOpen,
    setLeftOpen,
    leftTab,
    setLeftTab,
    historySubTab,
    setHistorySubTab,
    prefsReady,
  } = useChatUiPrefs(searchParams);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [showCreateSubagent, setShowCreateSubagent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // toast 自动消失：showToast 内联重置定时器（重复调用重新计时、传 null 停表）。
  // 与原「toast state 变化 → useEffect 重置计时」相比：不同文案路径逐点等价；
  // 相同文案连续触发时行为改善——原实现 setToast(同值) 被 React bailout、effect 不重跑、
  // 定时不重置，第二条相同 toast 会随第一条的定时提前消失；内联后每次调用都重新计时。
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string | null) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(msg);
    if (msg !== null) {
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, 2500);
    }
  }, []);
  /** session_rotate 后的跳转提示（不自动切换会话） */
  const [rotateBanner, setRotateBanner] = useState<{
    newSessionId: string;
    newTitle: string;
  } | null>(null);
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
  const streamSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** INV-2：streaming|done 均占用，Compose 不得开新流 */
  const isSessionRunOccupied = useCallback(
    (sid: string | null): boolean => streamLifecycleStore.isRunOccupied(sid),
    [],
  );

  // 流式 token rAF 合并：onToken 每字符触发一次会让 ChatView 高频重渲染。
  const pendingStreamDeltaRef = useRef<Map<string, string>>(new Map());
  const streamRafRef = useRef<Map<string, number>>(new Map());


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
  const ensureMainSessionMutation = trpc.session.ensureMain.useMutation();
  const ensureMainMutateAsync = ensureMainSessionMutation.mutateAsync;
  const openNewSessionMutation = trpc.session.openNew.useMutation();
  const openNewSessionMutateAsync = openNewSessionMutation.mutateAsync;
  const defaultAgentId = useMemo(() => {
    const items = agentsQuery.data?.items;
    if (!items?.length) return "";
    const assistant = items.find((a: Agent) => a.name === "assistant");
    return assistant?.id ?? items[0].id;
  }, [agentsQuery.data?.items]);

  // 焦点 session 只跟 tabs，禁止回退到 URL：
  // startNewChat 后 router.replace 清 URL 是异步的，若 effectiveSessionId = focused ?? url，
  // 会短暂仍指向旧会话，导致 NEW_STREAM_KEY 入队却 runStream 打到旧 sid（第二会话无回复）。
  // 深链由下方 URL→tabs effect 的 ensureFocusedSession 灌入 tabs。
  const effectiveSessionId = focusedSessionId;
  const prevFocusedRef = useRef<string | null>(null);

  const watchedSessionIds = useMemo(() => {
    const ids = new Set<string>([...tabs.openTabIds, ...visibleSessionIds]);
    if (effectiveSessionId) ids.add(effectiveSessionId);
    return [...ids];
  }, [tabs.openTabIds, visibleSessionIds, effectiveSessionId]);

  // 【悬停预览域】hover preview 开关、监控窗 state、防抖定时器与四个 handler
  // 收拢于 useChatHoverMonitor（含原开关清理 effect 与卸载定时器清理）
  const {
    sessionHoverPreviewEnabled,
    hoverMonitorSessionId,
    setHoverMonitorSessionId,
    handleSessionHover,
    handleSessionHoverEnd,
    handleHoverMonitorEnter,
    handleHoverMonitorLeave,
  } = useChatHoverMonitor({ effectiveSessionId });

  const syncChatUiToUrl = useCallback(
    (patch: { view?: "main" | "sub"; panel?: "history" | "runtime" }) => {
      const params = new URLSearchParams(searchParams.toString());
      let changed = false;
      if (patch.view === "sub" || patch.view === "main") {
        // 主/子都显式写入 URL，刷新后恢复的是用户最后一次切换的值
        if (params.get("view") !== patch.view) {
          params.set("view", patch.view);
          changed = true;
        }
      }
      if (patch.panel === "runtime") {
        if (params.get("panel") !== "runtime") {
          params.set("panel", "runtime");
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

  // 【URL 同步群】
  // 不变量：URL→tabs 只响应「URL 本身变化」（深链 / 前进后退 / 外链），
  // 绝不把 focusedSessionId / layout 放进 deps——否则会与下方 tabs→URL 乒乓：
  //   焦点刚切到 B、URL 仍是 A → URL 效应抢回 A，同时 tabs 效应把 URL 写成 B → 下一帧再反过来。
  // 运行时读 ref，避免闭包陈旧；焦点被冲成 null 时另有恢复效应（只在空焦点时 ensure）。
  const focusedSessionIdRef = useRef(focusedSessionId);
  focusedSessionIdRef.current = focusedSessionId;

  useEffect(() => {
    if (sessionFromUrl && sessionFromUrl !== focusedSessionIdRef.current) {
      ensureFocusedSession(sessionFromUrl);
      void utils.session.listRunning.invalidate();
      consumeRef.current(sessionFromUrl);
    }
  }, [sessionFromUrl, ensureFocusedSession, utils.session.listRunning]);

  useEffect(() => {
    if (!splitFromUrl || splitFromUrl === sessionFromUrl) return;
    ensureSplitWith(splitFromUrl);
  }, [splitFromUrl, sessionFromUrl, ensureSplitWith]);

  // 深链 ensure 被其它 effect 冲成空焦点时补一次（有焦点绝不抢——避免与用户点标签打架）
  useEffect(() => {
    if (!tabsHydrated) return;
    if (sessionFromUrl && !focusedSessionId) {
      ensureFocusedSession(sessionFromUrl);
    }
  }, [tabsHydrated, sessionFromUrl, focusedSessionId, ensureFocusedSession]);

  // 子 Agent 任务会话已终态时从标签栏摘掉（当前正在看的除外，避免读报告时被踢走）
  useEffect(() => {
    if (!tabsHydrated) return;
    const items = sessionsQuery.data?.items;
    if (!items?.length || tabs.openTabIds.length === 0) return;
    const byId = new Map(items.map((s) => [s.id, s]));
    const terminal = new Set(["completed", "failed", "archived", "deleted"]);
    for (const id of tabs.openTabIds) {
      if (id === focusedSessionId) continue;
      const s = byId.get(id);
      if (!s) continue;
      const isSub = s.kind === "subagent" || !!s.parentSessionId;
      if (isSub && terminal.has(String(s.status))) {
        closeTab(id);
      }
    }
  }, [
    tabsHydrated,
    tabs.openTabIds,
    focusedSessionId,
    sessionsQuery.data?.items,
    closeTab,
  ]);

  // tabs 焦点 / 分屏 → URL（本地操作的唯一写回通道；selectSession 等也可先写 URL，本效应幂等对齐）
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    let changed = false;
    const focus = focusedSessionId;
    if (focus) {
      if (params.get("sessionId") !== focus) {
        params.set("sessionId", focus);
        changed = true;
      }
    } else if (params.has("sessionId") && prevFocusedRef.current) {
      // 仅在从有焦点变为新对话时清 URL（避免首帧清空深链）
      params.delete("sessionId");
      changed = true;
    }
    if (tabs.layout === "split" && tabs.secondarySessionId) {
      if (params.get("split") !== tabs.secondarySessionId) {
        params.set("split", tabs.secondarySessionId);
        changed = true;
      }
    } else if (params.has("split")) {
      params.delete("split");
      changed = true;
    }
    prevFocusedRef.current = focus;
    if (changed) {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [
    focusedSessionId,
    tabs.layout,
    tabs.secondarySessionId,
    searchParams,
    pathname,
    router,
  ]);

  // 焦点 session 仍订阅三层 store：供右栏 token/队列派生、SSE/drain、hydrate 兜底
  // （中栏展示由 ChatSessionPane 各自订阅，允许与焦点切片重复订阅）
  const lifecycleKey = effectiveSessionId ?? NEW_STREAM_KEY;
  const { messages, hydrateFromServer } = useSessionMessages(effectiveSessionId);
  const { state: lifecycleState } = useStreamLifecycle(lifecycleKey);
  const setError = setViewError;
  const { state: composeState } = useSessionComposeState(lifecycleKey);
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

  // 推优先 + 错误时 15s 轮询兜底：SSE 正常即时推送，query 出错时降级为 15s 轮询
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
    {
      enabled: !!effectiveSessionId && !backendDown,
      // 推优先（session_queue_update）+ 短轮询兜底：EventSource 晚连 / 漏推时不靠刷新
      refetchInterval: 3_000,
      refetchOnWindowFocus: true,
    },
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

  // 【异步 overlay 域】poll 补触发 / 过期 overlay 节拍清理 / consumedDeliveries 读写合一
  // 三个 effect 收拢于 useChatAsyncOverlayEffects（体未改，读写合一归并见该文件头注）
  useChatAsyncOverlayEffects({
    effectiveSessionId,
    asyncOverlays,
    consumedDeliveries,
    asyncQueueQuery,
  });

  const cancelAsyncJobMutation = trpc.agent.cancelAsyncJob.useMutation({
    onSuccess: () => {
      void asyncQueueQuery.refetch();
      showToast("已请求取消任务");
    },
    onError: (err) => {
      showToast(err.message || "取消失败：后端不可用或任务已结束");
    },
  });
  const cancelAsyncJobMutateFn = cancelAsyncJobMutation.mutate;
  const cancelAsyncJobMutate = useCallback(
    (input: { jobId: string }) => {
      if (backendDown) {
        showToast("后端未连接，无法取消任务。请先运行 pnpm dev");
        return;
      }
      cancelAsyncJobMutateFn(input);
    },
    [backendDown, cancelAsyncJobMutateFn, showToast],
  );

  const pinAsyncJobMutation = trpc.agent.toggleAsyncJobPinned.useMutation({
    onSuccess: () => {
      void asyncQueueQuery.refetch();
    },
  });

  // 【队列水合 · INV-8 ④】DB 为事实源：切会话全量替换；同会话按 dbId 幂等 merge（含删除）。
  // 不再「每会话只灌一次」——否则 superior/child_notify 入队后不刷新永远看不见。
  const queueHydrateSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!effectiveSessionId) {
      queueHydrateSessionRef.current = null;
      return;
    }
    if (!sessionQueueQuery.data) return;
    const sessionChanged = queueHydrateSessionRef.current !== effectiveSessionId;
    queueHydrateSessionRef.current = effectiveSessionId;
    if (sessionChanged) {
      sessionComposeActions.setUserQueue(
        effectiveSessionId,
        sessionQueueQuery.data.map(sessionQueueItemToChatItem),
      );
    } else {
      sessionComposeActions.patchUserQueue(effectiveSessionId, (prev) =>
        mergeUserQueueFromDb(prev, sessionQueueQuery.data!),
      );
    }
    // INV-8 ④：发送队列 hydrate/merge 完成 → 显式 drain（仅 user/child_notify；superior 由服务端起流）
    streamLifecycleActions.hydrateDone(effectiveSessionId);
  }, [effectiveSessionId, sessionQueueQuery.data]);

  // 【子 Agent 镜像域】pending AgentMessage 幂等镜像入队收拢于 useSubagentMessageMirror（体未改）
  useSubagentMessageMirror({
    effectiveSessionId,
    isSubagentSession,
    pendingAgentMessages: pullAgentMessagesQuery.data,
    messages,
    refetchSessionQueue: sessionQueueQuery.refetch,
  });

  // 【SSE 订阅与事件分发 · 心脏区】推优先：通过 store 统一监听 async-stream SSE（当前会话 + 父会话）。
  // 不再自建 EventSource——复用 useSessionMessages 的 watchSession 连接，消除双连接浪费。
  // 事件回调里 watchSession 的子 Agent session 在 cleanup 时统一 close。
  // effect 体逐字迁入 useChatSseSubscriptions（W13e），调用位置即原 effect 位置，
  // 挂载顺序与 cleanup 的 closeSessionWatch 引用计数时序不变。
  useChatSseSubscriptions({
    effectiveSessionId,
    mainSessionId,
    watchedSessionIds,
    backendDown,
    asyncQueueQuery,
    asyncQueueStatsQuery,
    pullAgentMessagesQuery,
    isSubagentSession,
    setRotateBanner,
  });

  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 【派生队列群】asyncResultQueue / runtime 三组（TP-3）/ 显示队列的 useMemo 派生收拢于
  // useChatDerivedQueues（W13e 拆出；useMemo 体与 deps 逐字未改）
  const {
    asyncResultQueue,
    runtimeActiveItems,
    runtimeToConsumeItems,
    runtimeConsumedItems,
    syncTaskItems,
  } = useChatDerivedQueues({ asyncOverlays, asyncQueueQuery, consumedDeliveries, userQueue });
  // W-A 右栏「状态」一级分组：异步队列可消费 / 同步任务只展示；不持久化到 URL
  const [runtimeGroupTab, setRuntimeGroupTab] = useState<"async" | "sync">("async");

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

  // 【会话配置域】模型 / systemPrompt 的加载、派生与持久化收拢于 useChatConfig
  const { chatConfig, setChatConfig, updateConfig } = useChatConfig({
    effectiveSessionId,
    selectedAgent,
    sessionDetailModel: sessionDetail?.model,
    sessionDetailSystemPrompt: sessionDetail?.systemPrompt,
  });

  const handleOpenPromptEditor = useCallback(() => setShowPromptEditor(true), []);
  const overlayUpdateConfig = focusedConfigApi?.updateConfig ?? updateConfig;

  // W16b：ChatOverlays memo 屏障要求 props 引用稳定，内联箭头每渲染新建会击穿 memo
  const handleSubagentCreated = useCallback(
    () => showToast("子 Agent 任务已启动，结果完成后自动进入对话"),
    [showToast],
  );

  // 【runStream 流式编排内核】runStream + rAF token 合帧三件套 + 持久化调度收拢于
  // useChatRunStream（W13e 拆出；useCallback 体与 deps 逐字未改）。rAF/定时器 refs 留在
  // 本文件，供【页面生命周期与全局监听群】的 unmount 清理 effect 统一回收。
  const runStreamChatConfig = focusedPaneConfig ?? chatConfig;
  const { runStream } = useChatRunStream({
    effectiveSessionId,
    effectiveAgentId,
    chatConfig: runStreamChatConfig,
    selectedWorkspaceId,
    selectedAgent,
    updateConfig,
    createSessionQueueItemMutation,
    hydrateSessionMessagesFallback,
    effectiveSessionIdRef,
    isPageUnloadingRef,
    pendingStreamDeltaRef,
    streamRafRef,
    streamSaveTimeoutRef,
    setSessionId,
    setEditingUserId: () => {},
    searchParams,
    pathname,
    router,
  });

  // 用 ref 保存最新的 runStream，供 mount 自动续传使用（避免把 runStream 本身放进 mount effect deps）
  // 镜像赋值已归并进下方【ref 镜像群】；mount 批读到的是 useRef(runStream) 首帧初始值，
  // 与原实现（原镜像 effect 在 mount 批内赋的也是首帧 runStream）完全一致。
  const runStreamRef = useRef(runStream);

  // 【mount 恢复与续传 · 心脏区】从 sessionStorage 恢复 compose + lifecycle，并自动续传
  // 刷新前正在运行的会话（INV-8 ④ drain 请求源；续传时序经 chat-resume/subagent-resume e2e 覆盖；effect 体未改）
  useEffect(() => {
    try {
      const composeRaw = sessionStorage.getItem(COMPOSE_STORAGE_KEY);
      if (composeRaw) {
        const parsed = JSON.parse(composeRaw) as Record<string, Parameters<typeof sessionComposeStore.hydrate>[0][string]>;
        sessionComposeStore.hydrate(parsed);
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
            // runStreamRef.current 此时读到的是 useRef(runStream) 首帧初始值
            // （镜像 effect 声明在下方、mount 批内此时尚未执行，但它要赋的也是同一个首帧 runStream）；
            // 事件处理内同步续传，无需 microtask
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

  // 【页面生命周期与全局监听群】beforeunload 持久化 + visibilitychange 断流续传 +
  // Ctrl+Shift+S 快捷键 + unmount 清理（原 4 个 deps [] 独立 effect 归并为 1 个）。
  // 原四者注册只发生在 mount、清理只发生在 unmount，两边界互不交互；
  // 合并后注册/清理逐条一一对应，时序语义不变。
  useEffect(() => {
    // 卸载 / 刷新前持久化，并标记正在卸载以阻止 finally 清掉 streaming phase
    const onBeforeUnload = () => {
      isPageUnloadingRef.current = true;
      saveChatStoresToStorage();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // 切回浏览器标签页时：若后台有流式会话连接断开，自动续传；切出时持久化状态
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

    // Ctrl+Shift+S 快捷键打开新建子代理弹窗
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        setShowCreateSubagent(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // 捕获 ref 值到 effect 局部变量，供卸载清理（react-hooks/exhaustive-deps）
    const rafMap = streamRafRef.current;
    const deltaMap = pendingStreamDeltaRef.current;
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", onKeyDown);
      saveChatStoresToStorage();
      // 流式 rAF / 残留定时器清理：组件卸载时取消所有待处理动画帧，避免 setState after unmount
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
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  // 【listRunning 挂接 · INV-5 · 心脏区】后端主动发现运行中会话并续传：
  // 覆盖 sessionStorage 丢失、跨标签、切换 Agent 等场景。
  // 仅信任 StreamHub.listRunning()（含 spawn_subagent / prepareAgentRun 的流式运行）。
  // 挂接进度一致性（INV-5）所在，effect 体一行未改。
  useEffect(() => {
    const items = runningSessionsQuery.data?.items;
    if (!items || items.length === 0) return;
    for (const item of items) {
      const sid = item.sessionId;
      if (!sid || sid === NEW_STREAM_KEY) continue;
      // 已存在 active stream（abort 非空）说明已自行恢复或在运行中，无需重复 resume
      if (sessionComposeActions.getActiveAbortController(sid)) continue;
      // 架构不变量：挂接进度必须与本地状态一致。
      // - 本地无该运行任何进度（服务端启动的运行：子 Agent prepareAgentRun / report_back 后父会话 autoConsume）：
      //   必须 resumeAfter=0 从头重放事件缓冲重建完整 liveTimeline。
      //   若从尾巴（item.lastEventId）接，thinking/tool 事件全被跳过 → 空 Thinking 卡住、
      //   done 后只有正式回复文本、hydrate 再闪烁重建完整时间线。
      // - 本地已有进度（断线重连）：接在本地 lastEventId 之后，避免重放重复拼接。
      const st = streamLifecycleStore.get(sid);
      const hasLocalProgress =
        st.phase === "streaming" && (st.lastEventId > 0 || st.liveTimeline.some((s) => s.type !== "thinking" || s.content));
      const resumeAfter = hasLocalProgress ? st.lastEventId : 0;
      // runStreamRef.current 读到 useRef 首帧初始值（mount 首跑时镜像 effect 尚未执行，
      // 其镜像赋值也是同一个首帧 runStream）；同步挂接，无需 microtask
      void runStreamRef.current({ targetSessionId: sid, resumeAfter, isResume: true });
    }
  }, [runningSessionsQuery.data]);

  // 【队列 drain 编排簇】consumeQueue + drainAllPendingQueues 收拢于 useChatQueueDrain
  // （W13e 拆出；useCallback 体与 deps 逐字未改，仅解构重命名）。drain 触发链唯一钩子
  // 仍是下方【drain 订阅 · INV-8 ②④】effect，经 consumeRef 镜像调用。
  const { drainAllPendingQueues } = useChatQueueDrain({
    effectiveSessionId,
    visibleSessionIds,
    asyncResultQueue,
    chatConfigModel: (focusedPaneConfig ?? chatConfig).model,
    isSessionRunOccupied,
    sessionsItems: sessionsQuery.data?.items,
    consumeSessionQueueItemMutation,
    ackAsyncDeliveryMutation,
    asyncQueueQuery,
    runStream,
    consumeRef,
  });

  // 【ref 镜像群】latest-ref 模式：把 render 期值镜像到 ref，供 mount-once 编排
  // （mount 恢复 / visibilitychange 续传 / drain 消费）在事件处理内运行时读取。
  // 原 3 个镜像 effect（effectiveSessionIdRef / runStreamRef / consumeRef）归并为 1 个：
  // 三处赋值互不依赖、均幂等；本 effect 仍在 mount 批内先于 drain 订阅的
  // queueMicrotask 消费点执行（microtask 在全部 mount effects 之后），时序等价。
  useEffect(() => {
    effectiveSessionIdRef.current = effectiveSessionId;
    runStreamRef.current = runStream;
    consumeRef.current = drainAllPendingQueues;
  }, [effectiveSessionId, runStream, drainAllPendingQueues]);

  // 【drain 订阅 · INV-8 ②④ · 心脏区】drain 的 ②（onStreamCommitted）④（HYDRATE_DONE）消费点。
  // ① 用户入队 / ③ 会话切换在各自事件处理里直接调 consumeRef，不再有任何
  // 「useEffect 监听状态变化 → drain」的兑底驱动。effect 体未改：drain 触发链唯一钩子。
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

  // enqueueMessage 在各 ChatSessionPane 内自行挂载（含 /goal|/research 闸）

  // R16：稳定 skills 引用，避免 ChatInputArea memo 因 ?? [] 新数组失效
  const skills = useMemo(() => skillsQuery.data?.items ?? [], [skillsQuery.data]);

  const onFocusedChatConfigChange = useCallback(
    (_sid: string | null, config: ChatSessionConfig) => {
      setFocusedPaneConfig(config);
    },
    [],
  );
  const onFocusedChatConfigApiChange = useCallback(
    (
      _sid: string | null,
      api: {
        updateConfig: (patch: Partial<ChatSessionConfig>) => void;
        resetPromptToAgent: () => void;
      },
    ) => {
      setFocusedConfigApi(api);
    },
    [],
  );

  /** 绑定当前 Agent 的主会话（有则复用、无则创建空会话），保证始终有真实 sessionId */
  const bindAgentMainSession = useCallback(
    async (aid: string): Promise<string | null> => {
      if (!aid || backendDown) return null;
      try {
        const res = await ensureMainMutateAsync({ agentId: aid });
        openTab(res.id);
        try {
          const prev = JSON.parse(sessionStorage.getItem(TAB_TITLE_CACHE_KEY) || "{}") as Record<
            string,
            string
          >;
          if (res.title && prev[res.id] !== res.title) {
            sessionStorage.setItem(
              TAB_TITLE_CACHE_KEY,
              JSON.stringify({ ...prev, [res.id]: res.title }),
            );
          }
        } catch {
          /* ignore */
        }
        void utils.session.list.invalidate();
        return res.id;
      } catch {
        return null;
      }
    },
    [backendDown, ensureMainMutateAsync, openTab, utils.session.list],
  );

  // 水合后若仍无焦点会话：落到当前 Agent 主会话（禁止长期停在 NEW_STREAM_KEY / 无 id）
  useEffect(() => {
    if (!tabsHydrated || backendDown) return;
    if (focusedSessionId || sessionFromUrl) return;
    if (!effectiveAgentId) return;
    void bindAgentMainSession(effectiveAgentId);
  }, [
    tabsHydrated,
    backendDown,
    focusedSessionId,
    sessionFromUrl,
    effectiveAgentId,
    bindAgentMainSession,
  ]);

  const startNewChat = useCallback(() => {
    const aid = agentId || effectiveAgentId;
    setAgentId((prev) => prev || effectiveAgentId);
    setEditingSessionId(null);
    setChatConfig(resolveNewChatConfig(loadDefaultChatConfig(), selectedAgent));
    setHistorySubTab("main");
    const params = new URLSearchParams(searchParams.toString());
    let changed = false;
    if (params.get("split")) {
      params.delete("split");
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
    void (async () => {
      if (!aid || backendDown) {
        // 后端不可用时仍允许本地空态，避免按钮完全失灵
        startNewChatInTabs();
        streamLifecycleActions.resetSession(NEW_STREAM_KEY);
        sessionComposeActions.resetComposeSession(NEW_STREAM_KEY);
        const p = new URLSearchParams(searchParams.toString());
        if (p.get("sessionId")) {
          p.delete("sessionId");
          router.replace(`${pathname}?${p.toString()}`, { scroll: false });
        }
        return;
      }
      try {
        const res = await openNewSessionMutateAsync({
          agentId: aid,
          focusedSessionId: focusedSessionId,
          model: selectedAgent?.model,
        });
        if (res.action === "already_here") {
          showToast("当前已在新会话中");
          return;
        }
        openTab(res.id);
        try {
          const prev = JSON.parse(sessionStorage.getItem(TAB_TITLE_CACHE_KEY) || "{}") as Record<
            string,
            string
          >;
          if (res.title && prev[res.id] !== res.title) {
            sessionStorage.setItem(
              TAB_TITLE_CACHE_KEY,
              JSON.stringify({ ...prev, [res.id]: res.title }),
            );
          }
        } catch {
          /* ignore */
        }
        void utils.session.list.invalidate();
      } catch {
        showToast("创建新会话失败");
      }
    })();
  }, [
    agentId,
    selectedAgent,
    effectiveAgentId,
    backendDown,
    focusedSessionId,
    searchParams,
    pathname,
    router,
    setChatConfig,
    setHistorySubTab,
    startNewChatInTabs,
    openNewSessionMutateAsync,
    openTab,
    showToast,
    utils.session.list,
  ]);

  const selectSession = useCallback(
    (id: string) => {
      openTab(id);
      setAgentId("");
      setUserSelectedWorkspaceId(null);
      setEditingSessionId(null);
      void utils.session.listRunning.invalidate();
      const targetSt = streamLifecycleStore.get(id);
      if (
        targetSt.phase === "streaming" &&
        !targetSt.connected &&
        !sessionComposeActions.getActiveAbortController(id)
      ) {
        void runStreamRef.current({
          targetSessionId: id,
          resumeAfter: targetSt.lastEventId,
          isResume: true,
        });
      }
      consumeRef.current(id);
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
    },
    [
      openTab,
      searchParams,
      pathname,
      router,
      sessionsQuery.data?.items,
      utils.session.listRunning,
      setHistorySubTab,
    ],
  );

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
  }, [agentsQuery.data?.items, effectiveAgentId, searchParams, pathname, router, setSessionId]);

  // 标签标题：优先列表 autoName/title；列表缺失时用 sessionStorage 缓存，避免只显示 CUID 前缀
  useEffect(() => {
    const items = sessionsQuery.data?.items;
    if (!items?.length) return;
    try {
      const prev = JSON.parse(sessionStorage.getItem(TAB_TITLE_CACHE_KEY) || "{}") as Record<
        string,
        string
      >;
      let changed = false;
      const next = { ...prev };
      for (const s of items) {
        const label = (s.autoName || s.title || "").trim();
        if (label && next[s.id] !== label) {
          next[s.id] = label;
          changed = true;
        }
      }
      if (changed) sessionStorage.setItem(TAB_TITLE_CACHE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [sessionsQuery.data?.items]);

  const tabBarItems = useMemo(() => {
    let cache: Record<string, string> = {};
    if (typeof window !== "undefined") {
      try {
        cache = JSON.parse(sessionStorage.getItem(TAB_TITLE_CACHE_KEY) || "{}") as Record<
          string,
          string
        >;
      } catch {
        cache = {};
      }
    }
    const items = sessionsQuery.data?.items ?? [];
    const fromList = new Map(items.map((s) => [s.id, sessionLabel(s)]));
    const byId = new Map(items.map((s) => [s.id, s]));
    return tabs.openTabIds.map((id) => {
      const base = fromList.get(id) || cache[id] || "新对话";
      const s = byId.get(id);
      const isSub = !!s && (s.kind === "subagent" || !!s.parentSessionId);
      const status = s ? String(s.status) : "";
      // 标题常冻住「任务排队等待中」，终态时补后缀避免误以为还在排队
      if (isSub && status === "completed" && !/已完成/.test(base)) {
        return { id, title: `${base} · 已完成` };
      }
      if (isSub && status === "failed" && !/失败/.test(base)) {
        return { id, title: `${base} · 失败` };
      }
      return { id, title: base };
    });
  }, [tabs.openTabIds, sessionsQuery.data?.items]);

  const overlayChatConfig = focusedPaneConfig ?? chatConfig;

  const paneShared = {
    backendDown,
    leftOpen,
    setLeftOpen,
    skills,
    selectedAgent,
    hasWorkspaces,
    runStream,
    consumeRef,
    createSessionQueueItemMutation,
    submitInjectMutation,
    deleteSessionQueueItemMutation,
    reorderSessionQueueItemsMutation,
    asyncQueueStats: asyncQueueStatsQuery.data,
    rotateBanner,
    setRotateBanner,
    showToast,
    selectSession,
    onOpenPromptEditor: handleOpenPromptEditor,
  } as const;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ChatSidebar
        leftOpen={leftOpen}
        setLeftOpen={setLeftOpen}
        leftTab={leftTab}
        setLeftTab={setLeftTab}
        historySubTab={historySubTab}
        setHistorySubTab={setHistorySubTab}
        prefsReady={prefsReady}
        syncChatUiToUrl={syncChatUiToUrl}
        effectiveSessionId={effectiveSessionId}
        effectiveAgentId={effectiveAgentId}
        mainSessionId={mainSessionId}
        mainAgentId={mainAgentId}
        isSubagentSession={isSubagentSession}
        parentSessionId={parentSessionId}
        selectedWorkspaceId={selectedWorkspaceId}
        selectedAgent={selectedAgent}
        asyncResultQueue={asyncResultQueue}
        selectSession={selectSession}
        openInOtherPane={openInOtherPane}
        openTabIds={tabs.openTabIds}
        closeTab={closeTab}
        selectWorkspace={selectWorkspace}
        startNewChat={startNewChat}
        editingSessionId={editingSessionId}
        setEditingSessionId={setEditingSessionId}
        renameDraft={renameDraft}
        setRenameDraft={setRenameDraft}
        handleSessionHover={handleSessionHover}
        handleSessionHoverEnd={handleSessionHoverEnd}
        setShowCreateSubagent={setShowCreateSubagent}
        setError={setError}
        setToast={showToast}
        refetchSession={refetchSession}
        cancelAsyncJobMutate={cancelAsyncJobMutate}
        pinAsyncJobMutate={pinAsyncJobMutation.mutate}
        runtimeGroupTab={runtimeGroupTab}
        setRuntimeGroupTab={setRuntimeGroupTab}
        syncTaskItems={syncTaskItems}
        runtimeActiveItems={runtimeActiveItems}
        runtimeToConsumeItems={runtimeToConsumeItems}
        runtimeConsumedItems={runtimeConsumedItems}
      />

      {sessionHoverPreviewEnabled && (
        <ChatHoverMonitor
          sessionId={hoverMonitorSessionId}
          onMouseEnter={handleHoverMonitorEnter}
          onMouseLeave={handleHoverMonitorLeave}
          onClose={() => setHoverMonitorSessionId(null)}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatTabBar
          tabs={tabs}
          items={tabBarItems}
          onFocusTab={focusTab}
          onCloseTab={closeTab}
          onEnterSplit={() => enterSplit()}
          onExitSplit={exitSplit}
          canEnterSplit={tabs.openTabIds.length >= 2}
          onPrefetchTab={(id) => {
            void sessionMessagesStore.prefetchSessionMessages(id, (opts) =>
              utils.message.listForChat.fetch(opts),
            );
          }}
        />
        <div
          className={cn(
            "flex min-h-0 flex-1",
            tabs.layout === "split" ? "flex-row" : "flex-col",
          )}
        >
          {/* 稳定 key：切会话只换 sessionId，禁止整树 remount 造成空白闪一下 */}
          <ChatSessionPane
            key="primary"
            sessionId={tabs.primarySessionId}
            isFocused={tabs.focusedPane === "primary"}
            onFocus={() => focusPane("primary")}
            onChatConfigChange={onFocusedChatConfigChange}
            onChatConfigApiChange={onFocusedChatConfigApiChange}
            {...paneShared}
          />
          {tabs.layout === "split" && tabs.secondarySessionId && (
            <>
              <div className="w-px shrink-0 bg-[var(--kp-divider)]" />
              <ChatSessionPane
                key="secondary"
                sessionId={tabs.secondarySessionId}
                isFocused={tabs.focusedPane === "secondary"}
                onFocus={() => focusPane("secondary")}
                onChatConfigChange={onFocusedChatConfigChange}
                onChatConfigApiChange={onFocusedChatConfigApiChange}
                {...paneShared}
              />
            </>
          )}
        </div>
      </div>

      <ChatOverlays
        showPromptEditor={showPromptEditor}
        setShowPromptEditor={setShowPromptEditor}
        systemPrompt={overlayChatConfig.systemPrompt}
        updateConfig={overlayUpdateConfig}
        showCreateSubagent={showCreateSubagent}
        setShowCreateSubagent={setShowCreateSubagent}
        parentSessionId={mainSessionId ?? undefined}
        parentAgentId={mainAgentId}
        parentAgentTools={selectedAgent?.tools}
        onSubagentCreated={handleSubagentCreated}
        toast={toast}
      />
    </div>
  );
}
