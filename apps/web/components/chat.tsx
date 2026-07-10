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
import { useAgent } from "@/lib/hooks";
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
  splitQueueByKind,
  sortQueueItems,
} from "@/lib/chatQueueTypes";
import { MessageQueue } from "@/components/chatQueue";
import { SubsessionPanel } from "@/components/subsessionPanel";
import { AsyncTaskPanel } from "@/components/asyncTaskPanel";
import { SubagentCreateDialog } from "@/components/subagentCreateDialog";
import { ChatHoverMonitor } from "@/components/chatHoverMonitor";
import { WorkspaceTree } from "@/components/workspaceTree";
import { AgentTreeSelect } from "@/components/agentTreeSelect";
import { MessageNavRail, type NavItem } from "@/components/messageNavRail";
import { ThinkingTimeline } from "@/components/chatTimelineSteps";
import { MessageActions, MessageSourceLabel, MessageVersions } from "@/components/chatMessageBits";
import { SessionListItem } from "@/components/chatSessionListItem";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

/* ─── 模块级类型与流式状态持久化 ─── */

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
  // 断线续传状态
  lastEventId: number;
  lastEventAt: number;
  connected: boolean;
  // 按 session 隔离的两个物理独立队列 + 异步投递消费记录
  userQueue: ChatQueueItem[];
  asyncOverlays: ChatQueueItem[];
  consumedDeliveries: Set<string>;
  queueDraining: boolean;
  activeQueueTaskId: string | null;
}

const NEW_STREAM_KEY = "__new__"; // 新会话首条消息发起时尚无 sessionId 时的临时键
const STREAM_STATES_STORAGE_KEY = "kp:chat-stream-states";

function serializeStreamStates(map: Map<string, SessionStreamState>): string {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of map) {
    if (k === NEW_STREAM_KEY) continue; // 不持久化临时新会话状态
    const { abort, ...rest } = v;
    void abort;
    obj[k] = { ...rest, consumedDeliveries: [...rest.consumedDeliveries] };
  }
  return JSON.stringify(obj);
}

function deserializeStreamStates(raw: string): Map<string, SessionStreamState> {
  const map = new Map<string, SessionStreamState>();
  try {
    const parsed = JSON.parse(raw) as Record<string, SessionStreamState>;
    for (const [k, v] of Object.entries(parsed)) {
      map.set(k, {
        ...v,
        abort: null,
        consumedDeliveries: new Set(v.consumedDeliveries ?? []),
      });
    }
  } catch {
    // ignore
  }
  return map;
}

function saveStreamStatesToStorage(map: Map<string, SessionStreamState>) {
  try {
    sessionStorage.setItem(STREAM_STATES_STORAGE_KEY, serializeStreamStates(map));
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
  // 左栏顶层标签页：history=对话历史，async=异步任务
  const [leftTab, setLeftTab] = useState<"history" | "async">("history");
  // 对话历史下的子标签页：main=主 Agent，sub=子 Agent
  const [historySubTab, setHistorySubTab] = useState<"main" | "sub">("main");
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
  const [hoverMonitorSessionId, setHoverMonitorSessionId] = useState<string | null>(null);
  const hoverMonitorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // 虚拟列表句柄：用于导航条按索引滚动 + 结构变化时强制滚到底部
  const virtuosoRef = useRef<VirtuosoHandle>(null);
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
  const streamStatesRef = useRef<Map<string, SessionStreamState>>(new Map());
  const effectiveSessionIdRef = useRef<string | null>(null);
  // 页面刷新/关闭时阻止 runStream finally 把 isStreaming 清为 false，保证下次 mount 能续传
  const isPageUnloadingRef = useRef(false);

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
        lastEventId: 0,
        lastEventAt: 0,
        connected: false,
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

  // 流式状态防抖持久化：每次状态变更后 100ms 内无新变更则写入 sessionStorage，
  // 确保刷新、崩溃、异常关闭时尽可能不丢状态。isStreaming 等关键状态会立即保存。
  const streamSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleStreamSave = useCallback((immediate?: boolean) => {
    if (streamSaveTimeoutRef.current) clearTimeout(streamSaveTimeoutRef.current);
    if (immediate) {
      saveStreamStatesToStorage(streamStatesRef.current);
      return;
    }
    streamSaveTimeoutRef.current = setTimeout(() => {
      saveStreamStatesToStorage(streamStatesRef.current);
      streamSaveTimeoutRef.current = null;
    }, 100);
  }, []);

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
      scheduleStreamSave();
    },
    [getStreamState, scheduleStreamSave],
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
  useEffect(() => {
    if (sessionFromUrl && sessionFromUrl !== sessionId && sessionFromUrl !== prevSessionFromUrlRef.current) {
      // 同步 URL 到 state：用 queueMicrotask 避免在 effect 同步阶段触发级联渲染
      queueMicrotask(() => {
        setSessionId(sessionFromUrl);
        applyView(sessionFromUrl);
      });
    }
    prevSessionFromUrlRef.current = sessionFromUrl;
  }, [sessionFromUrl, sessionId, applyView]);
  // 同步当前视图 session 到 ref，供 runStream 回调判断"是否当前视图"
  useEffect(() => {
    effectiveSessionIdRef.current = effectiveSessionId;
  }, [effectiveSessionId]);

  const { data: sessionDetail, refetch: refetchSession } = trpc.session.getById.useQuery(
    { id: effectiveSessionId! },
    { enabled: !!effectiveSessionId },
  );
  // P0-1 彻底解耦：消息独立走 message.listForChat 无限查询（cursor 分页），session.getById 只返元数据。
  // 第一页 = 最近 limit 条；向上滚（startReached）fetchNextPage 加载更早，Virtuoso 稳定 key 保持滚动位置。
  const messagesInfinite = trpc.message.listForChat.useInfiniteQuery(
    { sessionId: effectiveSessionId!, limit: 50 },
    {
      enabled: !!effectiveSessionId,
      getNextPageParam: (last) => last.nextCursor,
      refetchOnMount: false,
    },
  );
  // 切回某个 session 时强制刷新消息：确保子 Agent 在后台完成写入的消息能立刻出现，
  // 同时避免 useInfiniteQuery 缓存导致切换会话时显示旧 session 的空白/过期消息。
  useEffect(() => {
    if (!effectiveSessionId) return;
    void messagesInfinite.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSessionId]);
  // pages 顺序为 [最近页, 更早页, ...]，展示需倒序拼接（更早在前 + 最近在后）成时间正序
  // cast ChatMessage[]：listForChat 返 MessageEntity(role:string)，运行时 role 为合法联合值，与 ChatMessage 同形
  const messages = useMemo(
    () => ((messagesInfinite.data?.pages ?? []).slice().reverse().flatMap((p) => p.items) as ChatMessage[]),
    [messagesInfinite.data],
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

  // 子 Agent 会话下，所有「主 Agent」视角的过滤/创建都应以父会话/父 Agent 为锚点，
  // 否则左栏主会话列表会显示为空，用户无法切回父会话。
  const mainAgentId = isSubagentSession
    ? (parentSession?.agentId ?? effectiveAgentId)
    : effectiveAgentId;
  const mainSessionId = isSubagentSession ? parentSessionId : effectiveSessionId;
  const subSessionsQuery = trpc.session.listChildren.useQuery(
    { parentSessionId: mainSessionId! },
    { enabled: !!mainSessionId, refetchInterval: 3000 },
  );

  const backendDown = agentsQuery.isError || sessionsQuery.isError || providers.isError;

  // 轮询后端正在运行的 Agent 流式会话：即使 sessionStorage 被清空/跨标签，也能自动发现并续传
  const runningSessionsQuery = trpc.session.listRunning.useQuery(undefined, {
    enabled: !backendDown,
    refetchInterval: 5000,
  });

  const asyncQueueStatsQuery = trpc.agent.asyncQueueStats.useQuery(undefined, {
    enabled: !backendDown,
    // R9：自适应轮询——有活跃任务（running/queued）时 5s，无任务时 15s（仅用于探测新任务），
    // 错误时 30s。减少 Chat 长驻页面无任务时的空轮询，同时保持新任务探测延迟可接受。
    refetchInterval: (query) => {
      if (query.state.error) return 30000;
      const stats = query.state.data as { runningGlobal?: number; queued?: number } | undefined;
      const hasActive = !!stats && ((stats.runningGlobal ?? 0) > 0 || (stats.queued ?? 0) > 0);
      return hasActive ? 5000 : 15000;
    },
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

  // A8：仅在有活跃异步任务（running/queued）时才轮询 pullAsyncQueue，无任务时停止轮询，
  // 避免每个会话固定 2.5s 空 poll（含 raw UPDATE + findMany）。参照 listChildren 的 running 判断。
  // 同时监听本地 async-running overlay：任务可能在全球 stats 刷新前就已开始并完成，
  // 必须靠 overlay 触发至少一次 poll，否则结果可能永远投递不到前端。
  const asyncQueueQuery = trpc.agent.pullAsyncQueue.useQuery(
    { sessionId: effectiveSessionId! },
    {
      enabled: !!effectiveSessionId && !backendDown,
      refetchInterval: (query) => {
        if (query.state.error) return 10000;
        const data = query.state.data as { running?: unknown[]; queued?: unknown[] } | undefined;
        const hasActive =
          !!data &&
          ((data.running?.length ?? 0) > 0 || (data.queued?.length ?? 0) > 0);
        return hasActive ? 2500 : false;
      },
    },
  );

  // 当工具调用产生 async-running overlay 时立即触发一次 poll，防止任务在 stats 轮询间隙完成而漏投。
  const asyncPollTriggerRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!effectiveSessionId) return;
    const runningIds = asyncOverlays
      .filter(
        (o) =>
          o.kind === "async-running" &&
          (o.status === "running" || o.status === "queued") &&
          o.jobId,
      )
      .map((o) => o.jobId!);
    let shouldPoll = false;
    for (const id of runningIds) {
      if (!asyncPollTriggerRef.current.has(id)) {
        asyncPollTriggerRef.current.add(id);
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

  // 父会话实时任务进度：从合并后的 asyncResultQueue 派生，
  // run_async / async_task_run / spawn_subagent 返回 running 时立即显示，
  // 任务完成后显示 done/failed，并在 DOM 中保留 5 秒后再由 removeAt 定时器清理。
  const asyncProgressSteps = useMemo<TimelineStep[]>(() => {
    const steps: TimelineStep[] = [];
    for (const item of asyncResultQueue) {
      if (item.kind === "async-running") {
        steps.push({
          type: "progress",
          jobId: item.jobId ?? item.id,
          label: item.taskLabel || `后台任务 ${item.jobId?.slice(0, 6) ?? ""}`,
          round: 1,
          status: item.status === "queued" ? "queued" : "running",
        });
      } else if (item.kind === "async-result" && item.status) {
        steps.push({
          type: "progress",
          jobId: item.jobId ?? item.id,
          label: item.taskLabel || `后台任务 ${item.jobId?.slice(0, 6) ?? ""}`,
          round: 1,
          status: item.status === "failed" ? "failed" : "done",
          content: item.status === "failed" ? item.asyncResult : undefined,
        });
      }
    }
    return steps;
  }, [asyncResultQueue]);

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
    () => buildTokenBudget(messages, chatConfig.maxTokens, lastRoundTokens),
    [messages, chatConfig.maxTokens, lastRoundTokens],
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

  // 流式最终答案已写入 DB 后，用真实 assistant 气泡替换临时流式气泡，防止重复。
  useEffect(() => {
    if (isStreaming || !effectiveSessionId) return;
    const current = streamStatesRef.current.get(effectiveSessionId)?.streamingContent;
    if (!current) return;
    const lastGroup = messageGroups[messageGroups.length - 1];
    if (!lastGroup?.assistantMessage) return;
    const active = getActiveVersion(lastGroup);
    if (active && active.content.trim() === current.trim()) {
      ssSet(effectiveSessionId, "streamingContent", "");
      ssSet(effectiveSessionId, "liveTimeline", []);
    }
  }, [messageGroups, isStreaming, effectiveSessionId, ssSet]);

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
    }) => {
      // 捕获本次流式所属的 session（新会话首条消息时为 null，onDone 拿到 sessionId 后迁移键）
      let originSid = opts.targetSessionId ?? effectiveSessionId ?? NEW_STREAM_KEY;
      // 仅中止同一 session 上已有的流式（支持多 session 并发流式，互不干扰）
      getAbort(originSid)?.abort();
      const ac = new AbortController();
      getStreamState(originSid).abort = ac;

      const isResume = opts.isResume === true;
      ssSet(originSid, "isStreaming", true);
      // 流式一开始立即持久化，避免极快刷新/崩溃时状态未落盘
      saveStreamStatesToStorage(streamStatesRef.current);
      if (!isResume) {
        ssSet(originSid, "streamingContent", "");
        ssSet(originSid, "liveTimeline", [{ type: "thinking", content: "", round: 1 }]);
        // 重试/重生成/编辑：定位到原 user 消息所在 group 原位流式，替换旧 assistant 气泡；
        // 新消息：null，流式气泡落列表底部。
        ssSet(originSid, "streamTargetUserId",
          opts.retryFromMessageId ?? opts.regenerateUserMessageId ?? opts.editMessageId ?? null,
        );
        ssSet(originSid, "lastRoundTokens", 0);
      }
      ssSet(originSid, "error", null);
      // 断线续传状态初始化（resume 时保留 lastEventId / streamingContent / liveTimeline）
      const st = getStreamState(originSid);
      if (!isResume) {
        st.lastEventId = 0;
      }
      st.lastEventAt = Date.now();
      st.connected = true;
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
            agentId: effectiveAgentId || undefined,
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
            ...streamConfig,
          },
          {
            onSessionStart: (sid) => {
              if (originSid === NEW_STREAM_KEY && sid) {
                // 把待写 delta 先冲刷到 NEW_STREAM_KEY 状态，再整体迁移到真实 sessionId
                flushStreamNow(NEW_STREAM_KEY);
                const prev = streamStatesRef.current.get(NEW_STREAM_KEY);
                if (prev) {
                  streamStatesRef.current.set(sid, prev);
                  streamStatesRef.current.delete(NEW_STREAM_KEY);
                }
                originSid = sid;
              }
              // 后台续传（refresh/切 tab/切 session）时不应抢占当前视图；
              // 只有用户主动在当前视图发起的新流才需要把 URL/状态切到新 session。
              if (!opts.isResume) {
                // flushSync 保证 setSessionId 立即落盘，避免后续 onDone/invalidate
                // 因 effectiveSessionId 还是 null 而刷到错误 session（或根本未启用查询）。
                flushSync(() => setSessionId(sid));
                applyView(sid);
                // 同步 URL sessionId，刷新后仍能回到当前会话
                const params = new URLSearchParams(searchParams.toString());
                params.set("sessionId", sid);
                if (params.get("agentId")) params.delete("agentId");
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
              }
              // 立即持久化，确保刷新前状态已落在真实 sessionId 下
              saveStreamStatesToStorage(streamStatesRef.current);
            },
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
              if (
                (name === "run_async" || name === "async_task_run" || name === "spawn_subagent") &&
                result &&
                typeof result === "object"
              ) {
                const r = result as {
                  jobId?: string;
                  status?: string;
                  message?: string;
                  subagentSessionId?: string;
                  subagentName?: string;
                };
                if (r.jobId && (r.status === "running" || r.status === "queued")) {
                  const jobId = r.jobId;
                  const status = r.status;
                  ssSet(originSid, "asyncOverlays", (prev) => {
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
                }
              }
            },
            onEventId: (id) => {
              const sst = getStreamState(originSid);
              sst.lastEventId = id;
              sst.lastEventAt = Date.now();
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
              // 后台续传完成时只更新状态，不抢占用户当前视图
              if (!opts.isResume) {
                flushSync(() => setSessionId(data.sessionId));
                applyView(data.sessionId);
              }
              if (data.tokenUsage?.total) ssSet(originSid, "lastRoundTokens", data.tokenUsage.total);
              if (opts.skillPrompt) {
                updateConfig({ systemPrompt: opts.skillPrompt, customSystemPrompt: true });
              }
              // P0-1 解耦：session.getById 不再含 messages。流结束后刷新会话元数据 + 消息无限查询
              // （invalidate listForChat → 重拉最近页，新 user/assistant 消息出现；已加载的更早页保留）。
              if (data.sessionId) {
                void utils.session.getById.invalidate({ id: data.sessionId }).catch(() => undefined);
                void utils.message.listForChat.invalidate().catch(() => undefined);
              }
              // 子 Agent / 普通对话：最终答案写入 DB 后，消息查询会刷新出真实 assistant 气泡。
              // 在此之前保留最终内容作为流式气泡，避免中间时间线/内容被清空后页面出现空白闪烁。
              setTimeout(() => {
                ssSet(originSid, "liveTimeline", []);
                if (data.content) {
                  ssSet(originSid, "streamingContent", data.content);
                }
              }, 0);
              if (opts.optimisticUser) {
                ssSet(originSid, "optimistic", (prev) => prev.filter((m) => m.id !== opts.optimisticUser!.id));
              }
              ssSet(originSid, "isStreaming", false);
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
              // 后台续传出错时只更新状态，不抢占用户当前视图
              if (sid && !opts.isResume) {
                flushSync(() => setSessionId(sid));
                applyView(sid);
              }
              ssSet(originSid, "isStreaming", false);
              ssSet(originSid, "liveTimeline", []);
              ssSet(originSid, "streamingContent", "");
            },
          },
          ac.signal,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // 页面刷新/关闭导致的 abort：保留 isStreaming，让下次 mount 能续传
          if (isPageUnloadingRef.current) {
            return;
          }
          // 用户点击停止：先把待写 token 落地（保留中断前的部分内容），再延后清空
          flushStreamNow(originSid);
          ssSet(originSid, "isStreaming", false);
          // 保持当前流式 UI，等后端保存中断消息并刷新消息查询后再清空
          setTimeout(() => {
            // P0-1：刷新消息无限查询以显示中断后的 assistant 消息
            void utils.message.listForChat.invalidate();
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
        const finSt = getStreamState(originSid);
        finSt.connected = false;
        // 页面卸载时保留 isStreaming，让刷新后 mount 能识别并续传
        if (!isPageUnloadingRef.current) {
          ssSet(originSid, "isStreaming", false);
        }
        ssSet(originSid, "streamTargetUserId", null);
        const st = getStreamState(originSid);
        st.abort = null;
        st.queueDraining = false;
        const finishedTaskId = st.activeQueueTaskId;
        if (finishedTaskId) {
          st.activeQueueTaskId = null;
          // 不在这里删除 overlay：consumeQueue 已将 running 转为 done/failed 并设置 removeAt，
          // 由专门的定时器在展示 5 秒后清理，保证父会话进度条稳定可见。
          void finishedTaskId;
        }
        consumeRef.current();
      }
    },
    [effectiveAgentId, chatConfig, effectiveSessionId, updateConfig, utils.session.list, utils.session.getById, utils.message.listForChat, selectedAgent, getStreamState, ssSet, getAbort, scheduleStreamFlush, flushStreamNow, discardStreamFlush, applyView, pathname, router, searchParams],
  );

  // 用 ref 保存最新的 runStream，供 mount 自动续传使用（避免把 runStream 本身放进 mount effect deps）
  const runStreamRef = useRef(runStream);
  useEffect(() => {
    runStreamRef.current = runStream;
  }, [runStream]);

  // mount：从 sessionStorage 恢复流式状态，并自动续传刷新前正在运行的会话
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STREAM_STATES_STORAGE_KEY);
      console.log("[mount] restored raw:", raw?.slice(0, 200));
      if (raw) {
        const restored = deserializeStreamStates(raw);
        for (const [sid, st] of restored) {
          streamStatesRef.current.set(sid, st);
        }
        applyView(effectiveSessionId);
        for (const [sid, st] of streamStatesRef.current) {
          // 只要刷新前仍在运行（即使还没收到第一个事件 lastEventId=0）也尝试续传
          if (sid !== NEW_STREAM_KEY && st.isStreaming) {
            console.log("[mount] resuming", sid, "lastEventId", st.lastEventId);
            queueMicrotask(() => {
              runStreamRef.current({ targetSessionId: sid, resumeAfter: st.lastEventId, isResume: true });
            });
          }
        }
      }
    } catch (e) {
      console.error("[mount] restore error", e);
    }
    // 只在 mount 执行一次；依赖项故意不写全
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载 / 刷新前持久化流式状态，并标记正在卸载以阻止 runStream finally 清掉 isStreaming
  useEffect(() => {
    const states = streamStatesRef.current;
    const onBeforeUnload = () => {
      isPageUnloadingRef.current = true;
      saveStreamStatesToStorage(states);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      saveStreamStatesToStorage(states);
    };
  }, []);

  // 切回浏览器标签页时：若后台有流式会话连接断开，自动续传；切出时持久化状态
  useEffect(() => {
    const onVisibilityChange = () => {
      const states = streamStatesRef.current;
      if (document.hidden) {
        saveStreamStatesToStorage(states);
        return;
      }
      // 可见性恢复：任何 isStreaming 但没有 active abort 的会话都可能是连接丢失，尝试续传
      for (const [sid, st] of states) {
        if (sid !== NEW_STREAM_KEY && st.isStreaming && !st.abort) {
          queueMicrotask(() => {
            runStreamRef.current({ targetSessionId: sid, resumeAfter: st.lastEventId, isResume: true });
          });
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // 后端主动发现运行中会话并续传：覆盖 sessionStorage 丢失、跨标签、切换 Agent 等场景
  useEffect(() => {
    const items = runningSessionsQuery.data?.items;
    if (!items || items.length === 0) return;
    for (const item of items) {
      const sid = item.sessionId;
      if (!sid || sid === NEW_STREAM_KEY) continue;
      const st = getStreamState(sid);
      // 已存在 active stream（abort 非空）说明已自行恢复或在运行中，无需重复 resume
      if (st.abort) continue;
      queueMicrotask(() => {
        runStreamRef.current({ targetSessionId: sid, resumeAfter: item.lastEventId, isResume: true });
      });
    }
  }, [runningSessionsQuery.data, getStreamState]);

  // 进入运行中的子会话时立即续传，避免等 runningSessionsQuery 的 5 秒轮询
  useEffect(() => {
    if (!effectiveSessionId || sessionDetail?.kind !== "subagent") return;
    if (sessionDetail?.status !== "running") return;
    const st = getStreamState(effectiveSessionId);
    // 未连接且无 active abort 时尝试 resume；若 Hub 尚未启动，streamAgentChat 会快速失败，
    // 随后 runningSessionsQuery 轮询到会再次尝试。
    if (!st.connected && !st.abort) {
      queueMicrotask(() => {
        runStreamRef.current({
          targetSessionId: effectiveSessionId,
          resumeAfter: st.lastEventId,
          isResume: true,
        });
      });
    }
  }, [effectiveSessionId, sessionDetail?.kind, sessionDetail?.status, getStreamState]);

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
      // async-result：把本地 running overlay 转为 done/failed 并保留 5 秒，
      // 让用户在父会话时间线看到「运行中 → 已完成/失败」的完整状态流转，避免一闪而过。
      if (task.jobId) {
        const finishedJobId = task.jobId;
        const finishedStatus = task.status ?? "done";
        const finishedResult = task.asyncResult ?? "";
        ssSet(sid, "asyncOverlays", (prev) => {
          const existing = prev.find((o) => o.jobId === finishedJobId);
          if (!existing) {
            st.activeQueueTaskId = task.id;
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
          st.activeQueueTaskId = updated.id;
          return prev.map((o) => (o.jobId === finishedJobId ? updated : o));
        });
      } else {
        st.activeQueueTaskId = task.id;
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
    // 异步结果不再显示占位用户气泡（如「后台任务完成」），直接由 assistant 总结真实结果。
    // 只有用户主动发送的消息才需要乐观占位。
    const isAsyncResult = task.kind === "async-result";
    const optimisticText = task.text.trim() || (task.attachments?.length ? "（见附件）" : "");
    const optimisticAttachments = streamAttachments?.length ? streamAttachments : undefined;
    if (!isAsyncResult && (optimisticText || optimisticAttachments)) {
      ssSet(sid, "optimistic", (o) =>
        o.some((m) => m.id === optimisticId)
          ? o
          : [...o, { id: optimisticId, content: optimisticText, attachments: optimisticAttachments }],
      );
    }
    void runStream({
      message: streamMessage,
      attachments: streamAttachments?.length ? streamAttachments : undefined,
      skillId: task.skillId,
      skillPrompt: task.skillPrompt,
      source: isAsyncResult ? "sub" : "user",
      toolResults: isAsyncResult
        ? {
            subagentResult: {
              jobId: task.jobId,
              subagentSessionId: task.subagentSessionId,
              subagentName: task.subagentName ?? `子 Agent ${task.jobId?.slice(0, 6) ?? ""}`,
            },
          }
        : undefined,
      optimisticUser: isAsyncResult ? undefined : { id: optimisticId, text: optimisticText },
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

  // 清理已过期的已完成 async overlay，让进度条稳定展示 5 秒后自动消失
  useEffect(() => {
    if (!effectiveSessionId) return;
    const timer = setInterval(() => {
      const sid = effectiveSessionId;
      const current = streamStatesRef.current.get(sid)?.asyncOverlays ?? [];
      const now = Date.now();
      const hasExpired = current.some((o) => o.kind === "async-result" && o.removeAt && o.removeAt <= now);
      if (hasExpired) {
        ssSet(sid, "asyncOverlays", (prev) =>
          prev.filter((o) => !(o.kind === "async-result" && o.removeAt && o.removeAt <= now)),
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [effectiveSessionId, ssSet]);

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
      if (streamSaveTimeoutRef.current) {
        clearTimeout(streamSaveTimeoutRef.current);
        streamSaveTimeoutRef.current = null;
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
    },
    [backendDown, ssSet, effectiveSessionId],
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
    getAbort(effectiveSessionId)?.abort();
  }, [getAbort, effectiveSessionId]);

  // R16：稳定 skills 引用，避免 ChatInputArea memo 因 ?? [] 新数组失效
  const skills = useMemo(() => skillsQuery.data?.items ?? [], [skillsQuery.data]);

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
    // P0-1：版本切换改变 assistant 消息内容，刷新消息无限查询
    void utils.message.listForChat.invalidate();
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
  }, [selectedAgent, effectiveAgentId, searchParams, pathname, router, applyView]);

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
    // 如果目标 session 正在流式但连接已断开（切走期间网络/反代关闭 SSE），
    // 立即触发续传，保证点回来时流式输出恢复。
    const targetSt = streamStatesRef.current.get(id);
    if (targetSt?.isStreaming && !targetSt.connected && !targetSt.abort) {
      queueMicrotask(() => {
        runStreamRef.current({ targetSessionId: id, resumeAfter: targetSt.lastEventId, isResume: true });
      });
    }
    // 切换会话后同步 URL sessionId，移除 agentId，避免 URL 参数覆盖用户选择
    const params = new URLSearchParams(searchParams.toString());
    params.set("sessionId", id);
    if (params.get("agentId")) params.delete("agentId");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [effectiveSessionId, applyView, searchParams, pathname, router]);

  const selectAgent = useCallback((id: string) => {
    setAgentId(id);
    // R19：systemPrompt 不再从 list 取（已裁剪），由 chatConfig effect 在 agent.getById 加载后自动设。
    // model 仍从 list metadata 取。
    const agent = agentsQuery.data?.items.find((a: Agent) => a.id === id);
    if (agent && !chatConfig.customSystemPrompt) {
      updateConfig({ model: agent.model });
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

  // 悬停会话时预加载消息并显示右上角监控小窗口
  const handleSessionHover = useCallback(
    (id: string) => {
      if (!id || id === effectiveSessionId) return;
      if (hoverMonitorTimeoutRef.current) clearTimeout(hoverMonitorTimeoutRef.current);
      setHoverMonitorSessionId(id);
      void utils.message.listForChat.prefetchInfinite({ sessionId: id, limit: 8 });
    },
    [utils, effectiveSessionId],
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

  // 单个消息组渲染（用户气泡 + 思考时间线/中间步骤 + assistant 气泡 或 原位流式块）
  // 提取为函数供虚拟列表 itemContent 调用，仅可见项会执行。
  const renderMessageGroup = (group: MessageGroup, groupIdx: number) => {
    const isLastUser = groupIdx === lastGroupIndex;
    const isEditing = editingUserId === group.userMessage.id;
    const msgSource = (group.userMessage as { source?: string }).source ?? "user";
    const msgToolResults = (group.userMessage as { toolResults?: unknown }).toolResults;
    const subagentName =
      msgSource === "sub"
        ? (msgToolResults as { subagentResult?: { subagentName?: string } } | undefined)?.subagentResult
            ?.subagentName
        : undefined;
    // #24 子代理会话中，父 Agent 下发的任务消息视觉上像用户消息（右侧），
    // source=sub（子 Agent 返回结果）也在右侧，模拟「子 Agent 发送」的消息。
    // 其他非 user 来源显示在左侧。
    const isParentAgentTask = isSubagentSession && msgSource === "super";
    const isUserLike = msgSource === "user" || msgSource === "sub" || isParentAgentTask;
    const isAgentMessage = !isUserLike;
    return (
      <div className="flex flex-col">
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
              "relative w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl px-4 py-3 text-sm shadow-sm",
              isAgentMessage
                ? "bg-[var(--kp-bg-alt)] text-[var(--kp-text-1)] border border-[var(--kp-divider)]"
                : "bg-[var(--kp-brand)] text-white",
            )}>
              <MessageSourceLabel
                source={msgSource}
                isSubagentSession={isSubagentSession}
                align={isUserLike ? "right" : "left"}
                subagentName={subagentName}
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
              showRetry={isLastUser && !isEditing}
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
        <div className="w-fit max-w-full min-w-[min(100%,6rem)] rounded-2xl bg-[var(--kp-brand)] px-4 py-3 text-sm text-white opacity-80">
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    </div>
  );

  // 统一虚拟列表数据：消息组 + 乐观消息 + 尾部流式块（仅 !streamTargetUserId 时）
  type ChatItem =
    | { kind: "group"; key: string; group: MessageGroup; index: number }
    | { kind: "optimistic"; key: string; msg: { id: string; content: string; attachments?: ChatImageAttachment[] } }
    | { kind: "live"; key: "live-trailing" };
  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = messageGroups.map((group, index) => ({
      kind: "group",
      key: group.userMessage.id,
      group,
      index,
    }));
    for (const msg of optimistic) {
      items.push({ kind: "optimistic", key: msg.id, msg });
    }
    if (showLiveStream && !streamTargetUserId) {
      items.push({ kind: "live", key: "live-trailing" });
    }
    return items;
  }, [messageGroups, optimistic, showLiveStream, streamTargetUserId]);

  const handleNavScrollToIndex = useCallback((index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
  }, []);

  // 左栏内容：避免 JSX 内嵌多层三元表达式导致解析/维护困难
  const leftPanelBody = useMemo(() => {
    if (leftTab === "async") {
      return <AsyncTaskPanel parentSessionId={mainSessionId ?? undefined} />;
    }
    return (
      <>
        {/* 对话历史子标签页：主 Agent + 子 Agent */}
        <div className="flex gap-1 border-b border-[var(--kp-divider)] px-3 py-2">
          <button
            type="button"
            onClick={() => setHistorySubTab("main")}
            data-testid="history-subtab-main"
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              historySubTab === "main"
                ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
            )}
          >
            主 Agent
          </button>
          <button
            type="button"
            onClick={() => setHistorySubTab("sub")}
            data-testid="history-subtab-sub"
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              historySubTab === "sub"
                ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
            )}
          >
            子 Agent
            {(subSessionsQuery.data?.items?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--kp-bg-mute)] px-1 py-0 text-[9px] font-semibold text-[var(--kp-text-2)]">
                {subSessionsQuery.data?.items?.length}
              </span>
            )}
          </button>
        </div>
        {historySubTab === "sub" ? (
          <div className="flex flex-col">
            <div className="flex w-64 items-center justify-between border-b border-[var(--kp-divider)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">子 Agent 会话</h2>
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
            </div>
            <SubsessionPanel
              parentSessionId={mainSessionId ?? undefined}
              activeSessionId={effectiveSessionId}
              onSelectSession={selectSession}
            />
          </div>
        ) : (
          <>
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
                <button
                  type="button"
                  onClick={startNewChat}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}
                  aria-label="新建对话"
                  title="新建对话（发送首条消息时创建）"
                >
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
                  agents={agentsQuery.data?.items ?? []}
                  onSelectSession={selectSession}
                  onHoverSession={handleSessionHover}
                  onHoverSessionEnd={handleSessionHoverEnd}
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
        )}
      </>
    );
  }, [
    leftTab,
    historySubTab,
    mainSessionId,
    effectiveSessionId,
    selectSession,
    subSessionsQuery.data?.items,
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
    handleCancelRename,
    handleRequestDelete,
    editingSessionId,
    renameDraft,
    agentsQuery.data?.items,
    selectAgent,
    startNewChat,
  ]);

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
          {/* 左栏顶层标签页：对话历史 + 异步任务 */}
          <div className="mt-2 flex gap-1 rounded-lg bg-[var(--kp-bg-mute)] p-0.5">
            <button
              type="button"
              onClick={() => setLeftTab("history")}
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
              onClick={() => setLeftTab("async")}
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
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--kp-brand-soft)] px-1 py-0 text-[9px] font-semibold text-[var(--kp-brand-dark)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--kp-brand)]" />
                  {asyncTaskActiveCount}
                </span>
              )}
            </button>
          </div>
        </div>
        {leftPanelBody}
      </aside>

      <ChatHoverMonitor
        sessionId={hoverMonitorSessionId}
        onMouseEnter={handleHoverMonitorEnter}
        onMouseLeave={handleHoverMonitorLeave}
        onClose={() => setHoverMonitorSessionId(null)}
      />

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
              messages={messages}
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
            <span className="font-medium text-[var(--kp-brand-dark)]">子 Agent 任务</span>
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
              messages={messages}
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
          {messagesInfinite.isLoading && !hasMessages ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--kp-text-3)]" />
            </div>
          ) : !hasMessages && !backendDown ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-4 text-center text-[var(--kp-text-3)] md:px-6">
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
                  messagesInfinite.isFetchingNextPage ? (
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
                if (messagesInfinite.hasNextPage && !messagesInfinite.isFetchingNextPage) {
                  void messagesInfinite.fetchNextPage();
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
          asyncStats={asyncQueueStatsQuery.data}
          settingsPanelOpen={rightOpen}
          settingsPanelWidth={360}
        />

        {asyncProgressSteps.length > 0 && (
          <div className="flex w-full justify-start px-4 pb-3 md:px-6" data-testid="async-progress-block">
            <ThinkingTimeline steps={asyncProgressSteps} isLive />
          </div>
        )}

        <div className="border-t border-[var(--kp-divider)] px-4 py-3 md:px-6">
          <ChatInputArea
            key={effectiveSessionId ?? "new"}
            onSend={enqueueMessage}
            onStop={handleStop}
            disabled={backendDown}
            isStreaming={isStreaming}
            queueLength={queue.filter((q) => q.kind === "user").length}
            skills={skills}
            selectedSkill={selectedSkill}
            onSkillChange={setSelectedSkill}
            modelHint={modelOpt.inputHint ?? (modelOpt.supportsVision ? "多模态 · 支持图片" : "纯文本 · 图片将 OCR 后发送")}
            modelId={chatConfig.model}
            supportsVision={!!modelOpt.supportsVision}
            sessionHint={
              isSubagentSession
                ? "这是子 Agent 任务会话。你直接发送的消息只在本会话内处理，不会回传父会话；只有父 Agent 下发的任务结果才会投递回父会话。"
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
                onOpenPromptEditor={handleOpenPromptEditor}
                skills={skills}
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
        parentSessionId={mainSessionId ?? undefined}
        parentAgentId={mainAgentId}
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
