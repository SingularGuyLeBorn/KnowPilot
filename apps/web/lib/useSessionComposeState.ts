"use client";

/**
 * useSessionComposeState —— 发送队列 / 乐观气泡 / abort 等「尚未进 DB」的会话编排状态。
 *
 * 不进 MessageStore（DB 消息），也不进 StreamLifecycle（流式 phase）。
 * 公开 API 全部语义化，禁止 ssSet。
 */

import { useSyncExternalStore, useMemo } from "react";
import type { ChatImageAttachment } from "@knowpilot/shared";
import type { ChatQueueItem } from "@/lib/chatQueueTypes";

export type OptimisticUserBubble = {
  id: string;
  content: string;
  attachments?: ChatImageAttachment[];
  createdAt?: number;
};

export interface SessionComposeState {
  optimistic: OptimisticUserBubble[];
  abort: AbortController | null;
  userQueue: ChatQueueItem[];
  asyncOverlays: ChatQueueItem[];
  consumedDeliveries: Set<string>;
  queueDraining: boolean;
  activeQueueTaskId: string | null;
}

const EMPTY_COMPOSE: SessionComposeState = {
  optimistic: [],
  abort: null,
  userQueue: [],
  asyncOverlays: [],
  consumedDeliveries: new Set(),
  queueDraining: false,
  activeQueueTaskId: null,
};

type ComposeMap = Map<string, SessionComposeState>;
type Listener = () => void;

type Action =
  | { type: "SET_OPTIMISTIC"; sessionId: string; optimistic: OptimisticUserBubble[] }
  | { type: "ADD_OPTIMISTIC"; sessionId: string; bubble: OptimisticUserBubble }
  | { type: "REMOVE_OPTIMISTIC"; sessionId: string; bubbleId: string }
  | { type: "SET_ABORT"; sessionId: string; abort: AbortController | null }
  | { type: "SET_USER_QUEUE"; sessionId: string; userQueue: ChatQueueItem[] }
  | { type: "PATCH_USER_QUEUE"; sessionId: string; updater: (q: ChatQueueItem[]) => ChatQueueItem[] }
  | { type: "SET_ASYNC_OVERLAYS"; sessionId: string; asyncOverlays: ChatQueueItem[] }
  | { type: "PATCH_ASYNC_OVERLAYS"; sessionId: string; updater: (q: ChatQueueItem[]) => ChatQueueItem[] }
  | { type: "SET_CONSUMED_DELIVERIES"; sessionId: string; consumed: Set<string> }
  | { type: "MARK_DELIVERY_CONSUMED"; sessionId: string; jobId: string }
  | { type: "UNMARK_DELIVERY_CONSUMED"; sessionId: string; jobId: string }
  | { type: "SET_QUEUE_DRAINING"; sessionId: string; draining: boolean }
  | { type: "SET_ACTIVE_QUEUE_TASK"; sessionId: string; taskId: string | null }
  | { type: "MIGRATE"; fromKey: string; toSessionId: string }
  | { type: "RESET"; sessionId: string }
  | { type: "DELETE"; sessionId: string };

function ensure(state: ComposeMap, sessionId: string): SessionComposeState {
  return state.get(sessionId) ?? { ...EMPTY_COMPOSE, consumedDeliveries: new Set() };
}

function reducer(state: ComposeMap, action: Action): ComposeMap {
  const set = (sid: string, next: SessionComposeState): ComposeMap => {
    const map = new Map(state);
    map.set(sid, next);
    return map;
  };

  switch (action.type) {
    case "SET_OPTIMISTIC":
      return set(action.sessionId, { ...ensure(state, action.sessionId), optimistic: action.optimistic });
    case "ADD_OPTIMISTIC": {
      const cur = ensure(state, action.sessionId);
      return set(action.sessionId, { ...cur, optimistic: [...cur.optimistic, action.bubble] });
    }
    case "REMOVE_OPTIMISTIC": {
      const cur = ensure(state, action.sessionId);
      return set(action.sessionId, {
        ...cur,
        optimistic: cur.optimistic.filter((b) => b.id !== action.bubbleId),
      });
    }
    case "SET_ABORT":
      return set(action.sessionId, { ...ensure(state, action.sessionId), abort: action.abort });
    case "SET_USER_QUEUE":
      return set(action.sessionId, { ...ensure(state, action.sessionId), userQueue: action.userQueue });
    case "PATCH_USER_QUEUE": {
      const cur = ensure(state, action.sessionId);
      return set(action.sessionId, { ...cur, userQueue: action.updater(cur.userQueue) });
    }
    case "SET_ASYNC_OVERLAYS":
      return set(action.sessionId, {
        ...ensure(state, action.sessionId),
        asyncOverlays: action.asyncOverlays,
      });
    case "PATCH_ASYNC_OVERLAYS": {
      const cur = ensure(state, action.sessionId);
      return set(action.sessionId, { ...cur, asyncOverlays: action.updater(cur.asyncOverlays) });
    }
    case "SET_CONSUMED_DELIVERIES":
      return set(action.sessionId, {
        ...ensure(state, action.sessionId),
        consumedDeliveries: action.consumed,
      });
    case "MARK_DELIVERY_CONSUMED": {
      const cur = ensure(state, action.sessionId);
      const next = new Set(cur.consumedDeliveries);
      next.add(action.jobId);
      return set(action.sessionId, { ...cur, consumedDeliveries: next });
    }
    case "UNMARK_DELIVERY_CONSUMED": {
      const cur = ensure(state, action.sessionId);
      if (!cur.consumedDeliveries.has(action.jobId)) return state;
      const next = new Set(cur.consumedDeliveries);
      next.delete(action.jobId);
      return set(action.sessionId, { ...cur, consumedDeliveries: next });
    }
    case "SET_QUEUE_DRAINING":
      return set(action.sessionId, {
        ...ensure(state, action.sessionId),
        queueDraining: action.draining,
      });
    case "SET_ACTIVE_QUEUE_TASK":
      return set(action.sessionId, {
        ...ensure(state, action.sessionId),
        activeQueueTaskId: action.taskId,
      });
    case "MIGRATE": {
      const from = state.get(action.fromKey);
      if (!from) return state;
      const map = new Map(state);
      map.delete(action.fromKey);
      map.set(action.toSessionId, from);
      return map;
    }
    case "RESET":
      return set(action.sessionId, { ...EMPTY_COMPOSE, consumedDeliveries: new Set() });
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

class SessionComposeStore {
  private state: ComposeMap = new Map();
  private listeners = new Set<Listener>();

  getState = (): ComposeMap => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch = (action: Action): void => {
    this.state = reducer(this.state, action);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  };

  get = (sessionId: string): SessionComposeState =>
    this.state.get(sessionId) ?? { ...EMPTY_COMPOSE, consumedDeliveries: new Set() };
}

let globalStore: SessionComposeStore | null = null;

function getStore(): SessionComposeStore {
  if (!globalStore) globalStore = new SessionComposeStore();
  return globalStore;
}

/** 单测重置（勿在生产路径调用） */
export function __resetSessionComposeStoreForTests(): void {
  globalStore = null;
}

/** 语义化写操作 */
export const sessionComposeActions = {
  addOptimisticUserBubble(sessionId: string, bubble: OptimisticUserBubble) {
    getStore().dispatch({ type: "ADD_OPTIMISTIC", sessionId, bubble });
  },
  removeOptimisticUserBubble(sessionId: string, bubbleId: string) {
    getStore().dispatch({ type: "REMOVE_OPTIMISTIC", sessionId, bubbleId });
  },
  setOptimisticUserBubbles(sessionId: string, optimistic: OptimisticUserBubble[]) {
    getStore().dispatch({ type: "SET_OPTIMISTIC", sessionId, optimistic });
  },
  setActiveAbortController(sessionId: string, abort: AbortController | null) {
    getStore().dispatch({ type: "SET_ABORT", sessionId, abort });
  },
  getActiveAbortController(sessionId: string | null): AbortController | null {
    if (!sessionId) return null;
    return getStore().get(sessionId).abort;
  },
  setUserQueue(sessionId: string, userQueue: ChatQueueItem[]) {
    getStore().dispatch({ type: "SET_USER_QUEUE", sessionId, userQueue });
  },
  patchUserQueue(sessionId: string, updater: (q: ChatQueueItem[]) => ChatQueueItem[]) {
    getStore().dispatch({ type: "PATCH_USER_QUEUE", sessionId, updater });
  },
  enqueueUserQueueItem(sessionId: string, item: ChatQueueItem) {
    getStore().dispatch({
      type: "PATCH_USER_QUEUE",
      sessionId,
      updater: (q) => [...q, item],
    });
  },
  removeUserQueueItem(sessionId: string, itemId: string) {
    getStore().dispatch({
      type: "PATCH_USER_QUEUE",
      sessionId,
      updater: (q) => q.filter((i) => i.id !== itemId),
    });
  },
  setAsyncOverlays(sessionId: string, asyncOverlays: ChatQueueItem[]) {
    getStore().dispatch({ type: "SET_ASYNC_OVERLAYS", sessionId, asyncOverlays });
  },
  patchAsyncOverlays(sessionId: string, updater: (q: ChatQueueItem[]) => ChatQueueItem[]) {
    getStore().dispatch({ type: "PATCH_ASYNC_OVERLAYS", sessionId, updater });
  },
  setConsumedDeliveries(sessionId: string, consumed: Set<string>) {
    getStore().dispatch({ type: "SET_CONSUMED_DELIVERIES", sessionId, consumed });
  },
  markDeliveryConsumed(sessionId: string, jobId: string) {
    getStore().dispatch({ type: "MARK_DELIVERY_CONSUMED", sessionId, jobId });
  },
  /** E1：ACK 未 claimed / 瞬态失败时回滚本地标记，允许 delivery 再出现 */
  unmarkDeliveryConsumed(sessionId: string, jobId: string) {
    getStore().dispatch({ type: "UNMARK_DELIVERY_CONSUMED", sessionId, jobId });
  },
  setQueueDraining(sessionId: string, draining: boolean) {
    getStore().dispatch({ type: "SET_QUEUE_DRAINING", sessionId, draining });
  },
  setActiveQueueTaskId(sessionId: string, taskId: string | null) {
    getStore().dispatch({ type: "SET_ACTIVE_QUEUE_TASK", sessionId, taskId });
  },
  migrateComposeSession(fromKey: string, toSessionId: string) {
    getStore().dispatch({ type: "MIGRATE", fromKey, toSessionId });
  },
  resetComposeSession(sessionId: string) {
    getStore().dispatch({ type: "RESET", sessionId });
  },
  deleteComposeSession(sessionId: string) {
    getStore().dispatch({ type: "DELETE", sessionId });
  },
};

export const sessionComposeStore = {
  get: (sessionId: string) => getStore().get(sessionId),
  actions: sessionComposeActions,
  /** 所有已有 compose 切片的 sessionId（含 NEW_STREAM_KEY） */
  listSessionIds(): string[] {
    return [...getStore().getState().keys()];
  },
  /** 持久化用（不含 abort） */
  serialize(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of getStore().getState()) {
      const { abort: _a, ...rest } = v;
      void _a;
      obj[k] = { ...rest, consumedDeliveries: [...rest.consumedDeliveries] };
    }
    return obj;
  },
  hydrate(data: Record<string, Partial<SessionComposeState>>) {
    for (const [k, v] of Object.entries(data)) {
      getStore().dispatch({
        type: "SET_OPTIMISTIC",
        sessionId: k,
        optimistic: v.optimistic ?? [],
      });
      getStore().dispatch({
        type: "SET_USER_QUEUE",
        sessionId: k,
        userQueue: v.userQueue ?? [],
      });
      getStore().dispatch({
        type: "SET_ASYNC_OVERLAYS",
        sessionId: k,
        asyncOverlays: v.asyncOverlays ?? [],
      });
      getStore().dispatch({
        type: "SET_CONSUMED_DELIVERIES",
        sessionId: k,
        consumed: new Set(
          Array.isArray(v.consumedDeliveries)
            ? (v.consumedDeliveries as string[])
            : [...(v.consumedDeliveries ?? [])],
        ),
      });
    }
  },
};

export function useSessionComposeState(sessionId: string | null | undefined): {
  state: SessionComposeState;
  actions: typeof sessionComposeActions;
} {
  const store = getStore();
  const key = sessionId ?? "";
  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState().get(key) ?? EMPTY_COMPOSE,
    () => EMPTY_COMPOSE,
  );
  const actions = useMemo(() => sessionComposeActions, []);
  return { state, actions };
}
