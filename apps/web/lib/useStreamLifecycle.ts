"use client";

/**
 * useStreamLifecycle —— 流式生命周期显式状态机。
 *
 * phase: idle → streaming → done | error → idle
 *
 * 不变量（INV）：
 * - INV-1：done → idle 只能经 commitStream（MessageStore 已承接本轮 assistant）
 * - INV-2：Compose 仅当 phase === idle 才可 beginStream（streaming|done = isRunOccupied）
 * - INV-3：过渡 UI（streamingContent/liveTimeline）在 commit 前不得被新 BEGIN_STREAM 清掉
 * - INV-4：渲染单一所有权 —— 一条 assistant 消息任一时刻只能有一个渲染源。
 *   流式期间（phase !== idle）本轮 assistant 由 liveTimeline 独占渲染；
 *   message_upserted 先于 done 到达时记入 inFlightAssistantId，渲染层据此屏蔽
 *   MessageStore 里的同一条消息，直到 commit 后才由 MessageStore 独占。
 *   否则会出现「正式回复先出现 → done 后闪烁重建完整时间线」的双渲染竞态。
 *
 * 公开 API 全部语义化（beginStream / appendTokenDelta / completeStream / commitStream …），禁止 ssSet。
 * 队列、optimistic、abort 不进本 store（见 useSessionComposeState）。
 */

import { useSyncExternalStore, useMemo } from "react";
import type { TimelineStep } from "@/lib/chatMessageUtils";

export type StreamPhase = "idle" | "streaming" | "done" | "error";

export interface StreamLifecycleState {
  phase: StreamPhase;
  streamingContent: string;
  liveTimeline: TimelineStep[];
  streamTargetUserId: string | null;
  error: string | null;
  lastRoundTokens: number;
  lastEventId: number;
  lastEventAt: number;
  connected: boolean;
  /** completeStream 后等待 MessageStore 对齐的 assistant id */
  pendingAssistantMessageId: string | null;
  /** completeStream 后等待 MessageStore 对齐的正文（无 id 时用 content 匹配） */
  pendingAssistantContent: string | null;
  /** INV-4：本轮流式期间 message_upserted 提前到达的 assistant id，渲染层屏蔽其 stored 渲染 */
  inFlightAssistantId: string | null;
}

const IDLE_STATE: StreamLifecycleState = {
  phase: "idle",
  streamingContent: "",
  liveTimeline: [],
  streamTargetUserId: null,
  error: null,
  lastRoundTokens: 0,
  lastEventId: 0,
  lastEventAt: 0,
  connected: false,
  pendingAssistantMessageId: null,
  pendingAssistantContent: null,
  inFlightAssistantId: null,
};

type LifecycleMap = Map<string, StreamLifecycleState>;
type Listener = () => void;
type CommitListener = (sessionId: string) => void;

type Action =
  | { type: "BEGIN_STREAM"; sessionId: string; streamTargetUserId: string | null; resume: boolean }
  | { type: "REPLACE_TIMELINE"; sessionId: string; steps: TimelineStep[] }
  | { type: "APPEND_THINKING_DELTA"; sessionId: string; delta: string; round: number }
  | { type: "SET_STREAMING_CONTENT"; sessionId: string; content: string }
  | { type: "APPEND_TOKEN_DELTA"; sessionId: string; delta: string }
  | { type: "CLEAR_STREAMING_CONTENT"; sessionId: string }
  | { type: "APPEND_TIMELINE_STEP"; sessionId: string; step: TimelineStep }
  | { type: "UPDATE_TIMELINE_STEP"; sessionId: string; predicate: (s: TimelineStep) => boolean; patch: Partial<TimelineStep> }
  | { type: "MOVE_STREAMING_CONTENT_TO_TIMELINE"; sessionId: string; round: number }
  | { type: "SET_LAST_EVENT"; sessionId: string; eventId: number }
  | { type: "SET_CONNECTED"; sessionId: string; connected: boolean }
  | { type: "SET_LAST_ROUND_TOKENS"; sessionId: string; tokens: number }
  | {
      type: "COMPLETE_STREAM";
      sessionId: string;
      content: string;
      assistantMessageId: string | null;
    }
  | { type: "FAIL_STREAM"; sessionId: string; message: string }
  | { type: "CLEAR_ERROR"; sessionId: string }
  | { type: "COMMIT_STREAM"; sessionId: string }
  | { type: "CLEAR_STREAMING_UI"; sessionId: string }
  | { type: "MARK_INFLIGHT_ASSISTANT"; sessionId: string; messageId: string }
  | { type: "MIGRATE_STREAM_SESSION"; fromKey: string; toSessionId: string }
  | { type: "RESET"; sessionId: string }
  | { type: "DELETE"; sessionId: string };

function isOccupiedPhase(phase: StreamPhase): boolean {
  return phase === "streaming" || phase === "done";
}

function reducer(state: LifecycleMap, action: Action): LifecycleMap {
  const get = (sid: string): StreamLifecycleState => state.get(sid) ?? IDLE_STATE;
  const set = (sid: string, next: StreamLifecycleState): LifecycleMap => {
    const map = new Map(state);
    map.set(sid, next);
    return map;
  };

  switch (action.type) {
    case "BEGIN_STREAM": {
      const prev = get(action.sessionId);
      if (action.resume) {
        return set(action.sessionId, {
          ...prev,
          phase: "streaming",
          error: null,
          connected: true,
          pendingAssistantMessageId: null,
          pendingAssistantContent: null,
          streamTargetUserId: action.streamTargetUserId ?? prev.streamTargetUserId,
        });
      }
      // INV-2/3：非 idle 时拒绝开新流，避免抹掉尚未 commit 的过渡 UI
      if (isOccupiedPhase(prev.phase)) {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[StreamLifecycle] beginStream blocked: session ${action.sessionId} still ${prev.phase}`,
          );
        }
        return state;
      }
      return set(action.sessionId, {
        ...IDLE_STATE,
        phase: "streaming",
        streamTargetUserId: action.streamTargetUserId,
        liveTimeline: [{ type: "thinking", content: "", round: 1 }],
        connected: true,
        lastEventId: 0,
        lastEventAt: Date.now(),
      });
    }
    case "REPLACE_TIMELINE":
      return set(action.sessionId, { ...get(action.sessionId), liveTimeline: action.steps });
    case "APPEND_THINKING_DELTA": {
      const s = get(action.sessionId);
      const copy = [...s.liveTimeline];
      for (let i = copy.length - 1; i >= 0; i--) {
        const step = copy[i];
        if (step.type === "thinking") {
          copy[i] = { type: "thinking", content: step.content + action.delta, round: step.round };
          return set(action.sessionId, { ...s, liveTimeline: copy });
        }
      }
      return set(action.sessionId, {
        ...s,
        liveTimeline: [...copy, { type: "thinking", content: action.delta, round: action.round }],
      });
    }
    case "SET_STREAMING_CONTENT":
      return set(action.sessionId, { ...get(action.sessionId), streamingContent: action.content });
    case "APPEND_TOKEN_DELTA": {
      const s = get(action.sessionId);
      return set(action.sessionId, { ...s, streamingContent: s.streamingContent + action.delta });
    }
    case "CLEAR_STREAMING_CONTENT":
      return set(action.sessionId, { ...get(action.sessionId), streamingContent: "" });
    case "APPEND_TIMELINE_STEP": {
      const s = get(action.sessionId);
      return set(action.sessionId, { ...s, liveTimeline: [...s.liveTimeline, action.step] });
    }
    case "UPDATE_TIMELINE_STEP": {
      const s = get(action.sessionId);
      const nextTimeline = s.liveTimeline.map((step) =>
        action.predicate(step) ? ({ ...step, ...action.patch } as TimelineStep) : step,
      );
      return set(action.sessionId, { ...s, liveTimeline: nextTimeline });
    }
    case "MOVE_STREAMING_CONTENT_TO_TIMELINE": {
      const s = get(action.sessionId);
      const leftover = s.streamingContent.trim();
      if (!leftover) return state;
      if (s.liveTimeline.some((t) => t.type === "content" && t.round === action.round)) {
        return set(action.sessionId, { ...s, streamingContent: "" });
      }
      return set(action.sessionId, {
        ...s,
        liveTimeline: [...s.liveTimeline, { type: "content", content: leftover, round: action.round }],
        streamingContent: "",
      });
    }
    case "SET_LAST_EVENT":
      return set(action.sessionId, {
        ...get(action.sessionId),
        lastEventId: action.eventId,
        lastEventAt: Date.now(),
      });
    case "SET_CONNECTED":
      return set(action.sessionId, { ...get(action.sessionId), connected: action.connected });
    case "SET_LAST_ROUND_TOKENS":
      return set(action.sessionId, { ...get(action.sessionId), lastRoundTokens: action.tokens });
    case "COMPLETE_STREAM": {
      const s = get(action.sessionId);
      return set(action.sessionId, {
        ...s,
        phase: "done",
        streamingContent: action.content,
        error: null,
        connected: false,
        pendingAssistantMessageId: action.assistantMessageId,
        pendingAssistantContent: action.content.trim() ? action.content : null,
      });
    }
    case "FAIL_STREAM": {
      const s = get(action.sessionId);
      return set(action.sessionId, {
        ...s,
        phase: "error",
        error: action.message,
        liveTimeline: [],
        streamingContent: "",
        connected: false,
        pendingAssistantMessageId: null,
        pendingAssistantContent: null,
        inFlightAssistantId: null,
      });
    }
    case "CLEAR_ERROR": {
      const s = get(action.sessionId);
      return set(action.sessionId, {
        ...s,
        error: null,
        phase: s.phase === "error" ? "idle" : s.phase,
      });
    }
    case "COMMIT_STREAM":
    case "CLEAR_STREAMING_UI":
      // INV-1：done→idle 的唯一清 UI 入口（CLEAR_STREAMING_UI 保留别名兼容 abort/error 路径）
      return set(action.sessionId, {
        ...get(action.sessionId),
        liveTimeline: [],
        streamingContent: "",
        phase: "idle",
        streamTargetUserId: null,
        pendingAssistantMessageId: null,
        pendingAssistantContent: null,
        inFlightAssistantId: null,
        connected: false,
      });
    case "MARK_INFLIGHT_ASSISTANT": {
      // INV-4：仅流式占用期间记录；idle 时到达的 upsert 是正常 stored 渲染，不屏蔽
      const s = get(action.sessionId);
      if (!isOccupiedPhase(s.phase)) return state;
      if (s.inFlightAssistantId === action.messageId) return state;
      return set(action.sessionId, { ...s, inFlightAssistantId: action.messageId });
    }
    case "MIGRATE_STREAM_SESSION": {
      const from = state.get(action.fromKey);
      if (!from) return state;
      const map = new Map(state);
      map.delete(action.fromKey);
      map.set(action.toSessionId, { ...from });
      return map;
    }
    case "RESET":
      return set(action.sessionId, { ...IDLE_STATE });
    case "DELETE": {
      if (!state.has(action.sessionId)) return state;
      const map = new Map(state);
      map.delete(action.sessionId);
      return map;
    }
    default:
      return state;
  }
}

class StreamLifecycleStore {
  private state: LifecycleMap = new Map();
  private listeners = new Set<Listener>();
  private commitListeners = new Set<CommitListener>();

  getState = (): LifecycleMap => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onStreamCommitted = (listener: CommitListener): (() => void) => {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  };

  private notifyCommit = (sessionId: string): void => {
    for (const listener of this.commitListeners) {
      try {
        listener(sessionId);
      } catch {
        /* ignore */
      }
    }
  };

  dispatch = (action: Action): void => {
    const occupiedBefore = new Map<string, StreamPhase>();
    for (const [sid, st] of this.state) {
      occupiedBefore.set(sid, st.phase);
    }
    this.state = reducer(this.state, action);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
    // 任意 session 进入 idle 时通知 Compose drain（INV-2）
    for (const [sid, st] of this.state) {
      if (st.phase === "idle" && occupiedBefore.get(sid) !== "idle") {
        this.notifyCommit(sid);
      }
    }
    // MIGRATE：新 sessionId 若为 idle 且 from 曾占用，也已在 map 中
    if (action.type === "MIGRATE_STREAM_SESSION") {
      const to = this.state.get(action.toSessionId);
      if (to?.phase === "idle") {
        const fromPhase = occupiedBefore.get(action.fromKey);
        if (fromPhase && fromPhase !== "idle") this.notifyCommit(action.toSessionId);
      }
    }
  };

  get = (sessionId: string): StreamLifecycleState => this.state.get(sessionId) ?? IDLE_STATE;

  isStreaming = (sessionId: string | null | undefined): boolean =>
    !!sessionId && this.state.get(sessionId)?.phase === "streaming";

  /** streaming | done：本轮尚未提交到 MessageStore / 尚未 idle */
  isRunOccupied = (sessionId: string | null | undefined): boolean => {
    if (!sessionId) return false;
    const phase = this.state.get(sessionId)?.phase;
    return phase === "streaming" || phase === "done";
  };

  canBeginNewRun = (sessionId: string | null | undefined): boolean => {
    if (!sessionId) return true;
    return (this.state.get(sessionId)?.phase ?? "idle") === "idle";
  };
}

let globalStore: StreamLifecycleStore | null = null;

function getStore(): StreamLifecycleStore {
  if (!globalStore) globalStore = new StreamLifecycleStore();
  return globalStore;
}

const EMPTY_STATE: StreamLifecycleState = IDLE_STATE;

function matchesPending(
  s: StreamLifecycleState,
  opts: { messageId?: string; content?: string },
): boolean {
  if (s.phase !== "done") return false;
  if (opts.messageId && s.pendingAssistantMessageId) {
    return opts.messageId === s.pendingAssistantMessageId;
  }
  if (opts.messageId && !s.pendingAssistantMessageId) {
    // done 时无 pending id（abort/空回复）：任意 assistant upsert 或显式 commit 均可
    if (opts.content != null && s.pendingAssistantContent) {
      return opts.content.trim() === s.pendingAssistantContent.trim();
    }
    return true;
  }
  if (opts.content != null && s.pendingAssistantContent) {
    return opts.content.trim() === s.pendingAssistantContent.trim();
  }
  // 无 pending 可匹配（空内容）→ 允许 commit，避免队列卡住
  if (!s.pendingAssistantMessageId && !s.pendingAssistantContent) return true;
  return false;
}

/** 语义化写操作：所有流式状态变更必须走这里，禁止 ssSet */
export const streamLifecycleActions = {
  beginStream(sessionId: string, opts: { streamTargetUserId?: string | null; resume?: boolean } = {}) {
    getStore().dispatch({
      type: "BEGIN_STREAM",
      sessionId,
      streamTargetUserId: opts.streamTargetUserId ?? null,
      resume: opts.resume === true,
    });
  },
  replaceTimeline(sessionId: string, steps: TimelineStep[]) {
    getStore().dispatch({ type: "REPLACE_TIMELINE", sessionId, steps });
  },
  appendThinkingDelta(sessionId: string, delta: string, round = 1) {
    getStore().dispatch({ type: "APPEND_THINKING_DELTA", sessionId, delta, round });
  },
  setStreamingContent(sessionId: string, content: string) {
    getStore().dispatch({ type: "SET_STREAMING_CONTENT", sessionId, content });
  },
  appendTokenDelta(sessionId: string, delta: string) {
    getStore().dispatch({ type: "APPEND_TOKEN_DELTA", sessionId, delta });
  },
  clearStreamingContent(sessionId: string) {
    getStore().dispatch({ type: "CLEAR_STREAMING_CONTENT", sessionId });
  },
  appendTimelineStep(sessionId: string, step: TimelineStep) {
    getStore().dispatch({ type: "APPEND_TIMELINE_STEP", sessionId, step });
  },
  updateTimelineStep(
    sessionId: string,
    predicate: (s: TimelineStep) => boolean,
    patch: Partial<TimelineStep>,
  ) {
    getStore().dispatch({ type: "UPDATE_TIMELINE_STEP", sessionId, predicate, patch });
  },
  moveStreamingContentToTimeline(sessionId: string, round: number) {
    getStore().dispatch({ type: "MOVE_STREAMING_CONTENT_TO_TIMELINE", sessionId, round });
  },
  setLastEventId(sessionId: string, eventId: number) {
    getStore().dispatch({ type: "SET_LAST_EVENT", sessionId, eventId });
  },
  setConnected(sessionId: string, connected: boolean) {
    getStore().dispatch({ type: "SET_CONNECTED", sessionId, connected });
  },
  setLastRoundTokens(sessionId: string, tokens: number) {
    getStore().dispatch({ type: "SET_LAST_ROUND_TOKENS", sessionId, tokens });
  },
  completeStream(
    sessionId: string,
    content: string,
    opts: { assistantMessageId?: string | null } = {},
  ) {
    getStore().dispatch({
      type: "COMPLETE_STREAM",
      sessionId,
      content,
      assistantMessageId: opts.assistantMessageId ?? null,
    });
  },
  /**
   * INV-1：仅当 phase=done 且 MessageStore 对齐（id/content）时 → idle，并通知 Compose drain。
   * 返回是否成功 commit。
   */
  tryCommitStream(
    sessionId: string,
    opts: { messageId?: string; content?: string } = {},
  ): boolean {
    const s = getStore().get(sessionId);
    if (!matchesPending(s, opts)) return false;
    getStore().dispatch({ type: "COMMIT_STREAM", sessionId });
    return true;
  },
  /** 强制 done/error → idle（abort、空回复、无 assistantMessageId） */
  commitStream(sessionId: string) {
    const phase = getStore().get(sessionId).phase;
    if (phase !== "done" && phase !== "error" && phase !== "streaming") return;
    getStore().dispatch({ type: "COMMIT_STREAM", sessionId });
  },
  /**
   * INV-4：流式期间 message_upserted 提前送达本轮 assistant 时登记 id，
   * 渲染层据此屏蔽 stored 渲染直到 commit。idle 时调用为 no-op。
   */
  markInFlightAssistant(sessionId: string, messageId: string) {
    getStore().dispatch({ type: "MARK_INFLIGHT_ASSISTANT", sessionId, messageId });
  },
  failStream(sessionId: string, message: string) {
    getStore().dispatch({ type: "FAIL_STREAM", sessionId, message });
  },
  clearError(sessionId: string) {
    getStore().dispatch({ type: "CLEAR_ERROR", sessionId });
  },
  /** @deprecated 优先用 commitStream / tryCommitStream；保留给 abort 等强制清 UI */
  clearStreamingUi(sessionId: string) {
    getStore().dispatch({ type: "CLEAR_STREAMING_UI", sessionId });
  },
  migrateStreamSession(fromKey: string, toSessionId: string) {
    getStore().dispatch({ type: "MIGRATE_STREAM_SESSION", fromKey, toSessionId });
  },
  resetSession(sessionId: string) {
    getStore().dispatch({ type: "RESET", sessionId });
  },
  deleteSession(sessionId: string) {
    getStore().dispatch({ type: "DELETE", sessionId });
  },
  /** Compose 挂载 drain 的唯一钩子：Lifecycle 进入 idle 后触发 */
  onStreamCommitted(listener: CommitListener): () => void {
    return getStore().onStreamCommitted(listener);
  },
};

export const streamLifecycleStore = {
  get: (sessionId: string) => getStore().get(sessionId),
  isStreaming: (sessionId: string | null | undefined) => getStore().isStreaming(sessionId),
  isRunOccupied: (sessionId: string | null | undefined) => getStore().isRunOccupied(sessionId),
  canBeginNewRun: (sessionId: string | null | undefined) => getStore().canBeginNewRun(sessionId),
  serialize: (): Record<string, StreamLifecycleState> => {
    const obj: Record<string, StreamLifecycleState> = {};
    for (const [k, v] of getStore().getState()) {
      obj[k] = v;
    }
    return obj;
  },
  actions: streamLifecycleActions,
};

export function useStreamLifecycle(sessionId: string | null | undefined): {
  state: StreamLifecycleState;
  isStreaming: boolean;
  isRunOccupied: boolean;
  actions: typeof streamLifecycleActions;
} {
  const store = getStore();
  const key = sessionId ?? "";
  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState().get(key) ?? EMPTY_STATE,
    () => EMPTY_STATE,
  );
  const actions = useMemo(() => streamLifecycleActions, []);
  return {
    state,
    isStreaming: state.phase === "streaming",
    isRunOccupied: state.phase === "streaming" || state.phase === "done",
    actions,
  };
}
