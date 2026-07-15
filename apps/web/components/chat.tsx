"use client";

/**
 * Agent Chat — 三栏布局 · 多版本 · 消息编辑 · Skill / 触发
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useAgent } from "@/lib/hooks";
import { stopAgentChat, copyToClipboard } from "@/lib/agentStream";
import {
  getModelOption,
  loadDefaultChatConfig,
  resolveNewChatConfig,
} from "@/lib/chatConfig";
import { buildMessageGroups } from "@/lib/chatMessageUtils";
import { type Agent, type ChatMessage } from "@knowpilot/shared";
import { type SelectedSkill } from "@/components/chatInput";
import { buildTokenBudget } from "@/components/tokenBudgetBar";
import {
  type ChatQueueItem,
  createUserQueueItem,
  sessionQueueItemToChatItem,
} from "@/lib/chatQueueTypes";
import { ChatHoverMonitor } from "@/components/chatHoverMonitor";
import { type ChatMessageListProps } from "@/components/chatMessageList";
import { ChatCenterPane } from "@/components/chatCenterPane";
import { ChatOverlays } from "@/components/chatOverlays";
import { ChatRightPanel } from "@/components/chatRightPanel";
import { ChatSidebar } from "@/components/chatSidebar";
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
import { useChatEnqueue } from "@/lib/useChatEnqueue";
import { useChatSseSubscriptions } from "@/lib/useChatSseSubscriptions";
import { useChatDerivedQueues } from "@/lib/useChatDerivedQueues";

/* ─── 模块级常量与 UI 偏好持久化 ─── */

const NEW_STREAM_KEY = "__new__"; // 新会话首条消息发起时尚无 sessionId 时的临时键
const LIFECYCLE_STORAGE_KEY = "kp:chat-lifecycle-states";
const COMPOSE_STORAGE_KEY = "kp:chat-compose-states";


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
  // 【存储持久化群】三栏 UI 偏好（localStorage 读写合一）收拢于 useChatUiPrefs
  const {
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    leftTab,
    setLeftTab,
    historySubTab,
    setHistorySubTab,
    rightTab,
    setRightTab,
  } = useChatUiPrefs(searchParams);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SelectedSkill | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [showCreateSubagent, setShowCreateSubagent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // toast 自动消失：showToast 内联重置定时器（重复调用重新计时、传 null 停表），
  // 与原「toast state 变化 → useEffect 重置计时」逐点等价，替代独立 effect。
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

  // 【URL 同步群】URL → state（外部跳转 / 浏览器前进后退；反向 state → URL 在
  // selectSession / startNewChat / onSessionStart 事件处理内）。含 INV-8 ③ drain 调用
  // 与 listRunning 挂接发现，属编排主干，保留在 chat.tsx。
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
  // 同步当前视图 session 到 ref（见下方【ref 镜像群】，赋值幂等、归并为一个 effect）

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

  // 【队列水合 · INV-8 ④】从 DB 水合发送队列（仅在切换会话时一次，避免覆盖本地编辑）；
  // hydrateDone 显式 drain 请求是 INV-8 ④ 触发链关键节点，保留在编排层。
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
    backendDown,
    asyncQueueQuery,
    asyncQueueStatsQuery,
    pullAgentMessagesQuery,
    isSubagentSession,
    setRotateBanner,
  });

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

  // 【派生队列群】asyncResultQueue / runtime 三态 / 显示队列的 useMemo 派生收拢于
  // useChatDerivedQueues（W13e 拆出；useMemo 体与 deps 逐字未改）
  const { asyncResultQueue, runtimePendingItems, runtimeHeldItems, runtimeConsumedItems, queue } =
    useChatDerivedQueues({ asyncOverlays, asyncQueueQuery, consumedDeliveries, userQueue });
  const [runtimeSubTab, setRuntimeSubTab] = useState<"pending" | "consumed">("pending");

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
  const { chatConfig, setChatConfig, updateConfig, resetPromptToAgent } = useChatConfig({
    effectiveSessionId,
    selectedAgent,
    sessionDetailModel: sessionDetail?.model,
    sessionDetailSystemPrompt: sessionDetail?.systemPrompt,
  });
  const modelOpt = getModelOption(chatConfig.model);

  const messageGroups = useMemo(
    () => buildMessageGroups(messages),
    [messages],
  );

  const tokenBudget = useMemo(
    () => buildTokenBudget(messages, chatConfig.maxTokens, lastRoundTokens, chatConfig.model),
    [messages, chatConfig.maxTokens, chatConfig.model, lastRoundTokens],
  );

  const lastUserMessageId = useMemo(() => {
    if (messageGroups.length === 0) return null;
    return messageGroups[messageGroups.length - 1].userMessage.id;
  }, [messageGroups]);

  const handleOpenPromptEditor = useCallback(() => setShowPromptEditor(true), []);

  // 【runStream 流式编排内核】runStream + rAF token 合帧三件套 + 持久化调度收拢于
  // useChatRunStream（W13e 拆出；useCallback 体与 deps 逐字未改）。rAF/定时器 refs 留在
  // 本文件，供【页面生命周期与全局监听群】的 unmount 清理 effect 统一回收。
  const { runStream } = useChatRunStream({
    effectiveSessionId,
    effectiveAgentId,
    chatConfig,
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
    setEditingUserId,
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
  // 仅信任 StreamHub.listRunning()（含 spawn_subagent / triggerAgentRun 的流式运行）。
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

  // 【队列 drain 编排簇】consumeQueue + drainAllPendingQueues 收拢于 useChatQueueDrain
  // （W13e 拆出；useCallback 体与 deps 逐字未改，仅解构重命名）。drain 触发链唯一钩子
  // 仍是下方【drain 订阅 · INV-8 ②④】effect，经 consumeRef 镜像调用。
  const { drainAllPendingQueues } = useChatQueueDrain({
    effectiveSessionId,
    asyncResultQueue,
    chatConfigModel: chatConfig.model,
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

  // R16：useCallback 稳定化，使 ChatInputArea memo 后流式期间跳过重渲染
  // 【enqueue 编排簇】enqueueMessage + 500ms 防重 lastEnqueueRef 收拢于 useChatEnqueue
  // （W13e 拆出；useCallback 体与 deps 逐字未改，仅 sessionDetail?.status 解构重命名为
  // sessionStatus）。INV-8 ① 用户入队显式 drain 仍经 consumeRef 调用。
  const { enqueueMessage } = useChatEnqueue({
    backendDown,
    effectiveSessionId,
    sessionStatus: sessionDetail?.status,
    createSessionQueueItemMutation,
    submitInjectMutation,
    isSessionRunOccupied,
    showToast,
    consumeRef,
  });

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

  // 错误条「转后台重试」：把上一条用户消息包装成 async_task_run 请求重新入队
  const handleTimeoutRetryInBackground = (lastText: string) => {
    sessionComposeActions.patchUserQueue(effectiveSessionId ?? NEW_STREAM_KEY, (prev) => [
      ...prev,
      createUserQueueItem(`请用 async_task_run 在后台执行这个任务（避免前台超时）：\n${lastText}`),
    ]);
    streamLifecycleActions.clearError(effectiveSessionId ?? NEW_STREAM_KEY);
    setViewError(null);
    // INV-8 ①：用户点击入队 → 显式 drain
    // （clearError 在已是 idle 时无转移，不会触发 ②）
    consumeRef.current(effectiveSessionId ?? NEW_STREAM_KEY);
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
  }, [selectedAgent, effectiveAgentId, searchParams, pathname, router, setChatConfig, setHistorySubTab]);

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
  }, [effectiveSessionId, searchParams, pathname, router, sessionsQuery.data?.items, utils.session.listRunning, setHistorySubTab]);

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

  // ChatMessageList 的 props 打包（W13e 随中栏外提至 ChatCenterPane，字段与原内联 JSX 一致）
  const messageListProps: ChatMessageListProps = {
    messageGroups,
    messages,
    optimistic,
    liveTimeline,
    streamingContent,
    isStreaming,
    streamTargetUserId,
    inFlightAssistantId,
    isSubagentSession,
    copiedId,
    editingUserId,
    editDraft,
    isMessagesHydrated,
    effectiveSessionId,
    backendDown,
    hasWorkspaces,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderMessages,
    onCopy: handleCopy,
    onShare: handleShare,
    onRegenerate: handleRegenerate,
    onSwitchVersion: handleSwitchVersion,
    onEditConfirm: handleEditConfirm,
    onRetry: handleRetry,
    setEditingUserId,
    setEditDraft,
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ChatSidebar
        leftOpen={leftOpen}
        leftTab={leftTab}
        setLeftTab={setLeftTab}
        historySubTab={historySubTab}
        setHistorySubTab={setHistorySubTab}
        syncChatUiToUrl={syncChatUiToUrl}
        effectiveSessionId={effectiveSessionId}
        effectiveAgentId={effectiveAgentId}
        mainSessionId={mainSessionId}
        mainAgentId={mainAgentId}
        isSubagentSession={isSubagentSession}
        parentSessionId={parentSessionId}
        selectedWorkspaceId={selectedWorkspaceId}
        selectedAgent={selectedAgent}
        chatConfigModel={chatConfig.model}
        asyncResultQueue={asyncResultQueue}
        selectSession={selectSession}
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
        cancelAsyncJobMutation={cancelAsyncJobMutation}
        retryAsyncJobMutation={retryAsyncJobMutation}
      />

      {sessionHoverPreviewEnabled && (
        <ChatHoverMonitor
          sessionId={hoverMonitorSessionId}
          onMouseEnter={handleHoverMonitorEnter}
          onMouseLeave={handleHoverMonitorLeave}
          onClose={() => setHoverMonitorSessionId(null)}
        />
      )}
      <ChatCenterPane
        effectiveSessionId={effectiveSessionId}
        sessionDetail={sessionDetail}
        isLoadingOlderMessages={isLoadingOlderMessages}
        isStreaming={isStreaming}
        selectedAgentName={selectedAgent?.name}
        chatConfigModel={chatConfig.model}
        chatConfigSystemPrompt={chatConfig.systemPrompt}
        queueLength={queue.length}
        compactPending={isSessionRunOccupied(effectiveSessionId ?? "")}
        onCompact={() => enqueueMessage("请压缩当前会话上下文")}
        setLeftOpen={setLeftOpen}
        setRightOpen={setRightOpen}
        isSubagentSession={isSubagentSession}
        parentSessionId={parentSessionId}
        parentSessionTitle={parentSession?.title}
        backendDown={backendDown}
        rotateBanner={rotateBanner}
        setRotateBanner={setRotateBanner}
        selectSession={selectSession}
        messageListProps={messageListProps}
        error={error}
        lastUserMessageId={lastUserMessageId}
        onRetry={handleRetry}
        onTimeoutRetryInBackground={handleTimeoutRetryInBackground}
        userQueue={userQueue}
        asyncQueueData={asyncQueueQuery.data}
        asyncStats={asyncQueueStatsQuery.data}
        persistQueueOrder={persistQueueOrder}
        deleteSessionQueueItemMutation={deleteSessionQueueItemMutation}
        onSend={enqueueMessage}
        onStop={handleStop}
        skills={skills}
        selectedSkill={selectedSkill}
        onSkillChange={setSelectedSkill}
        modelHint={modelOpt.inputHint ?? (modelOpt.supportsVision ? "多模态 · 支持图片" : "纯文本 · 图片将 OCR 后发送")}
        supportsVision={!!modelOpt.supportsVision}
        onOpenConfig={() => {
          setRightOpen(true);
          setRightTab("config");
        }}
      />

      <ChatRightPanel
        rightOpen={rightOpen}
        setRightOpen={setRightOpen}
        rightTab={rightTab}
        setRightTab={setRightTab}
        chatConfig={chatConfig}
        updateConfig={updateConfig}
        resetPromptToAgent={resetPromptToAgent}
        onOpenPromptEditor={handleOpenPromptEditor}
        skills={skills}
        selectedSkill={selectedSkill}
        setSelectedSkill={setSelectedSkill}
        modelSupportsReasoning={!!modelOpt.supportsThinking}
        modelReasoningRequired={!!modelOpt.reasoningRequired}
        tokenBudget={tokenBudget}
        runtimeSubTab={runtimeSubTab}
        setRuntimeSubTab={setRuntimeSubTab}
        runtimePendingItems={runtimePendingItems}
        runtimeConsumedItems={runtimeConsumedItems}
        runtimeHeldItems={runtimeHeldItems}
        cancelAsyncJobMutation={cancelAsyncJobMutation}
        pinAsyncJobMutation={pinAsyncJobMutation}
      />

      <ChatOverlays
        showPromptEditor={showPromptEditor}
        setShowPromptEditor={setShowPromptEditor}
        systemPrompt={chatConfig.systemPrompt}
        updateConfig={updateConfig}
        showCreateSubagent={showCreateSubagent}
        setShowCreateSubagent={setShowCreateSubagent}
        parentSessionId={mainSessionId ?? undefined}
        parentAgentId={mainAgentId}
        parentAgentTools={selectedAgent?.tools}
        onSubagentCreated={() => showToast("子 Agent 任务已启动，结果完成后自动进入对话")}
        toast={toast}
      />
    </div>
  );
}
