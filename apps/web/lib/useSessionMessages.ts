"use client";

/**
 * useSessionMessages —— 会话消息的单一真相源。
 *
 * 服务端 MessageService.create/update/delete → SSE message_upserted/deleted
 * → 本 store reducer 直接 patch → 组件 useSyncExternalStore 订阅。
 *
 * tRPC listForChat 仅用于：首次 hydrate、向上翻历史、断线兜底。
 * 禁止用 invalidate→refetch 作为日常刷新路径。
 */

import { useSyncExternalStore, useCallback, useRef, useEffect, useState } from "react";
import type { ChatMessage } from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { getAuthToken } from "@/lib/auth";
import { streamLifecycleActions } from "@/lib/useStreamLifecycle";

type MessageMap = Map<string, ChatMessage[]>;
type Listener = () => void;

/**
 * 消息 hydrate 意图：
 * - view：用户正在看的会话水合 → INV-8 ④ 合法 drain 源
 * - prefetch：悬停/tab 预取（只读）→ 不置 drainRequested
 */
export type MessageHydrateSource = "view" | "prefetch";

/**
 * INV-8 合法 drain 触发源（类型层枚举，新增调用方编译期可审）。
 * hydrate 仅 `hydrate_view` 可置 drainRequested；prefetch 不在此列。
 */
export type DrainTriggerSource =
  | "user_enqueue"
  | "stream_committed"
  | "session_switch"
  | "hydrate_view";

type Action =
  | { type: "hydrate"; sessionId: string; messages: ChatMessage[]; source: MessageHydrateSource }
  | { type: "upsert"; sessionId: string; message: ChatMessage }
  | { type: "delete"; sessionId: string; messageId: string }
  | { type: "clear"; sessionId: string };

function cmpByCreatedAt(a: ChatMessage, b: ChatMessage): number {
  const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : Date.parse(String(a.createdAt));
  const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : Date.parse(String(b.createdAt));
  return ta - tb;
}

function normalizeMessage(raw: ChatMessage): ChatMessage {
  if (typeof raw.createdAt === "string") {
    return { ...raw, createdAt: new Date(raw.createdAt) };
  }
  return raw;
}

/** INV-1：assistant 进 MessageStore 后尝试关闭 Lifecycle done→idle */
function tryCommitAfterAssistant(sessionId: string, message: ChatMessage): void {
  if (message.role !== "assistant") return;
  const committed = streamLifecycleActions.tryCommitStream(sessionId, {
    messageId: message.id,
    content: message.content,
  });
  // INV-4：未能 commit（phase 仍 streaming，message_upserted 先于 done 到达）
  // → 登记为本轮 in-flight assistant，渲染层屏蔽 stored 渲染，避免 live/stored 双渲染闪烁
  if (!committed) {
    streamLifecycleActions.markInFlightAssistant(sessionId, message.id);
  }
}

function tryCommitAfterHydrate(sessionId: string, messages: ChatMessage[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant") {
      if (
        streamLifecycleActions.tryCommitStream(sessionId, {
          messageId: m.id,
          content: m.content,
        })
      ) {
        return;
      }
    }
  }
}

/** upsert / hydrate 共用：内容字段全等则 skip */
function messageFieldsEqual(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.content === b.content &&
    a.toolCalls === b.toolCalls &&
    a.toolResults === b.toolResults &&
    a.tokenUsage === b.tokenUsage
  );
}

/**
 * E5：hydrate same-id 取新——后到达者幂等取新，不覆盖已更新内容。
 * 无 updatedAt 时：字段全等复用 prev；assistant 内容更长（SSE 递进）优先；
 * 元数据更丰富优先；其余取 incoming（显式刷新）。
 */
function pickFresherMessage(prev: ChatMessage, incoming: ChatMessage): ChatMessage {
  if (messageFieldsEqual(prev, incoming)) return prev;
  if (prev.role === "assistant" && incoming.role === "assistant") {
    if (prev.content.length > incoming.content.length) return prev;
    if (prev.content.length < incoming.content.length) return incoming;
  }
  const richness = (m: ChatMessage) =>
    (m.toolCalls ? 1 : 0) + (m.toolResults ? 1 : 0) + (m.tokenUsage ? 1 : 0);
  const prevR = richness(prev);
  const incR = richness(incoming);
  if (prevR > incR) return prev;
  if (incR > prevR) return incoming;
  return incoming;
}

function reducer(state: MessageMap, action: Action): MessageMap {
  switch (action.type) {
    case "hydrate": {
      const existing = state.get(action.sessionId);
      const incoming = action.messages.map(normalizeMessage);
      if (existing) {
        const existingById = new Map(existing.map((m) => [m.id, m]));
        const incomingIds = new Set(incoming.map((m) => m.id));
        const older = existing.filter((m) => !incomingIds.has(m.id));
        // same-id：逐字段 compare-skip / 取新（禁止 stale 快照覆盖 SSE v2）
        const mergedIncoming = incoming.map((msg) => {
          const prev = existingById.get(msg.id);
          return prev ? pickFresherMessage(prev, msg) : msg;
        });
        const merged = [...older, ...mergedIncoming].sort(cmpByCreatedAt);
        // 快路径：整列 id 相等且字段无变化
        if (
          merged.length === existing.length &&
          merged.every((m, i) => m.id === existing[i].id && messageFieldsEqual(m, existing[i]))
        ) {
          return state;
        }
        const next = new Map(state);
        next.set(action.sessionId, merged);
        return next;
      }
      const next = new Map(state);
      next.set(action.sessionId, incoming.sort(cmpByCreatedAt));
      return next;
    }
    case "upsert": {
      const list = state.get(action.sessionId) ?? [];
      const msg = normalizeMessage(action.message);
      const idx = list.findIndex((m) => m.id === msg.id);
      let nextList: ChatMessage[];
      if (idx >= 0) {
        const prev = list[idx];
        if (messageFieldsEqual(prev, msg)) {
          return state;
        }
        nextList = list.slice();
        nextList[idx] = msg;
      } else {
        nextList = [...list, msg].sort(cmpByCreatedAt);
      }
      const next = new Map(state);
      next.set(action.sessionId, nextList);
      return next;
    }
    case "delete": {
      const list = state.get(action.sessionId);
      if (!list) return state;
      const nextList = list.filter((m) => m.id !== action.messageId);
      if (nextList.length === list.length) return state;
      const next = new Map(state);
      next.set(action.sessionId, nextList);
      return next;
    }
    case "clear": {
      if (!state.has(action.sessionId)) return state;
      const next = new Map(state);
      next.delete(action.sessionId);
      return next;
    }
    default:
      return state;
  }
}

class SessionMessageStore {
  private state: MessageMap = new Map();
  private listeners = new Set<Listener>();
  private sessionRefcounts = new Map<string, number>();
  private eventSources = new Map<string, EventSource>();
  private upsertCallbacks = new Map<string, (event: ChatMessage) => void>();
  /** sessionId → eventType → Set<EventListener>（closeSessionWatch 时批量清理） */
  private extraListeners = new Map<string, Map<string, Set<EventListener>>>();

  getState = (): MessageMap => this.state;

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
    if (action.type === "upsert") {
      tryCommitAfterAssistant(action.sessionId, normalizeMessage(action.message));
    } else if (action.type === "hydrate") {
      tryCommitAfterHydrate(action.sessionId, action.messages.map(normalizeMessage));
      // INV-8 ④：仅 view hydrate 置 drainRequested；prefetch 只读预热不得触发 drain
      if (action.source === "view") {
        streamLifecycleActions.hydrateDone(action.sessionId);
      }
    }
  };

  getMessages = (sessionId: string | null | undefined): ChatMessage[] => {
    if (!sessionId) return [];
    return this.state.get(sessionId) ?? [];
  };

  onMessageUpserted = (sessionId: string, callback: (event: ChatMessage) => void): (() => void) => {
    this.upsertCallbacks.set(sessionId, callback);
    return () => {
      if (this.upsertCallbacks.get(sessionId) === callback) this.upsertCallbacks.delete(sessionId);
    };
  };

  /** 确保该会话的 SSE 已连接（引用计数，幂等）。多个组件 watch 同一 session 只开一个 EventSource。 */
  watchSession(sessionId: string): void {
    const count = this.sessionRefcounts.get(sessionId) ?? 0;
    this.sessionRefcounts.set(sessionId, count + 1);
    if (count > 0) return; // 已有连接，只增计数
    const token = getAuthToken();
    const qs = new URLSearchParams({ sessionId });
    if (token) qs.set("token", token);
    const es = new EventSource(`/api/agent/async-stream?${qs.toString()}`);
    es.addEventListener("message_upserted", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          sessionId: string;
          message: ChatMessage;
        };
        this.dispatch({ type: "upsert", sessionId: data.sessionId, message: data.message });
        const callback = this.upsertCallbacks.get(data.sessionId);
        if (callback) {
          try {
            callback(normalizeMessage(data.message));
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore parse */
      }
    });
    es.addEventListener("message_deleted", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          sessionId: string;
          messageId: string;
        };
        this.dispatch({ type: "delete", sessionId: data.sessionId, messageId: data.messageId });
      } catch {
        /* ignore parse */
      }
    });
    this.eventSources.set(sessionId, es);
  }

  /** 在已 watch 的 session 的 EventSource 上注册额外事件监听（如 async_delivery / session_run_started）。
   *  返回取消注册函数。chat.tsx 用此替代自建 EventSource，消除双连接。 */
  addSessionEventListener(sessionId: string, eventType: string, handler: (ev: MessageEvent) => void): () => void {
    this.watchSession(sessionId);
    const es = this.eventSources.get(sessionId);
    if (!es) return () => {};
    const listener = handler as EventListener;
    es.addEventListener(eventType, listener);
    if (!this.extraListeners.has(sessionId)) this.extraListeners.set(sessionId, new Map());
    const typeMap = this.extraListeners.get(sessionId)!;
    if (!typeMap.has(eventType)) typeMap.set(eventType, new Set());
    typeMap.get(eventType)!.add(listener);
    // cleanup 必须配对 closeSessionWatch：addSessionEventListener 内部 watchSession 做了 refcount +1，
    // 若不配对减 1，refcount 永不归零 → EventSource 永不关闭 → HTTP/1.1 6 连接耗尽 → session 转圈
    return () => {
      es.removeEventListener(eventType, listener);
      typeMap.get(eventType)?.delete(listener);
      this.closeSessionWatch(sessionId);
    };
  }

  closeSessionWatch(sessionId: string): void {
    const count = this.sessionRefcounts.get(sessionId);
    if (!count) return;
    if (count > 1) {
      this.sessionRefcounts.set(sessionId, count - 1);
      return; // 还有其他组件在用，不关
    }
    // 引用计数归零，真正关闭
    this.sessionRefcounts.delete(sessionId);
    const es = this.eventSources.get(sessionId);
    if (es) {
      es.close();
      this.eventSources.delete(sessionId);
    }
    this.extraListeners.delete(sessionId);
  }

  clearSession(sessionId: string): void {
    this.dispatch({ type: "clear", sessionId });
    this.upsertCallbacks.delete(sessionId);
    this.closeSessionWatch(sessionId);
  }

  hydrateSessionMessages(
    sessionId: string,
    messages: ChatMessage[],
    source: MessageHydrateSource = "view",
  ): void {
    this.dispatch({ type: "hydrate", sessionId, messages, source });
  }

  /**
   * onDone 幂等写入 assistant，与 message_upserted 同 id 合并。
   * 消除 agent SSE done 与 MessageStore SSE 双通道竞态，替代 listForChat hydrate 赌时序。
   */
  upsertAssistantFromDone(
    sessionId: string,
    data: {
      assistantMessageId: string;
      content: string;
      toolCalls?: ChatMessage["toolCalls"];
      tokenUsage?: ChatMessage["tokenUsage"];
      finishReason?: string | null;
    },
  ): void {
    const existing = this.getMessages(sessionId).find((m) => m.id === data.assistantMessageId);
    const message: ChatMessage = {
      id: data.assistantMessageId,
      sessionId,
      role: "assistant",
      content: data.content,
      toolCalls: data.toolCalls ?? existing?.toolCalls ?? null,
      toolResults: existing?.toolResults ?? null,
      tokenUsage: data.tokenUsage ?? existing?.tokenUsage ?? null,
      finishReason: data.finishReason ?? existing?.finishReason ?? null,
      source: existing?.source,
      attachments: existing?.attachments,
      createdAt: existing?.createdAt ?? new Date(),
    };
    this.dispatch({ type: "upsert", sessionId, message });
  }
}
let globalStore: SessionMessageStore | null = null;

function getStore(): SessionMessageStore {
  if (!globalStore) globalStore = new SessionMessageStore();
  return globalStore;
}

/** 单测重置（勿在生产路径调用） */
export function __resetSessionMessageStoreForTests(): void {
  globalStore = null;
  hydratedSessionsGlobal.clear();
  inflightHydrate.clear();
}

const EMPTY_ARRAY: ChatMessage[] = [];

/** 跨组件重挂载 / Fast Refresh 仍保留，避免偶发永久 spinner */
const hydratedSessionsGlobal = new Set<string>();

export type UseSessionMessagesResult = {
  messages: ChatMessage[];
  /** 首屏是否已从服务端 hydrate 完成 */
  isMessagesHydrated: boolean;
  /** 是否还有更早的历史页 */
  hasOlderMessages: boolean;
  /** 正在加载更早历史 */
  isLoadingOlderMessages: boolean;
  /** 向上翻页加载更早消息 */
  loadOlderMessages: () => Promise<void>;
  /** 断线/abort 后主动重拉最近一页（兜底，非日常路径） */
  hydrateFromServer: () => Promise<void>;
};

/** 进行中的预取/水合，按 session 去重 */
const inflightHydrate = new Map<string, Promise<void>>();

type ListForChatPage = {
  items: unknown[];
  nextCursor?: string | null;
};

async function fetchAndHydrateSession(
  sessionId: string,
  fetchPage: (opts: { sessionId: string; limit: number }) => Promise<ListForChatPage>,
  source: MessageHydrateSource = "view",
): Promise<{ nextCursor?: string | null }> {
  const existing = inflightHydrate.get(sessionId);
  if (existing) {
    await existing;
    return {};
  }
  const store = getStore();
  let nextCursor: string | null | undefined;
  const p = (async () => {
    const page = await fetchPage({ sessionId, limit: 50 });
    store.hydrateSessionMessages(sessionId, page.items as ChatMessage[], source);
    hydratedSessionsGlobal.add(sessionId);
    nextCursor = page.nextCursor;
  })();
  inflightHydrate.set(
    sessionId,
    p.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    await p;
    return { nextCursor };
  } finally {
    inflightHydrate.delete(sessionId);
  }
}

/**
 * 订阅某会话的消息列表。
 * 返回语义化字段，禁止伪造 messagesInfinite 外形对象。
 */

export function useSessionMessages(sessionId: string | null | undefined): UseSessionMessagesResult {
  const store = getStore();
  const sessionKey = sessionId ?? "";
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  useEffect(() => {
    utilsRef.current = utils;
  }, [utils]);

  /**
   * 仅记录「已对账完成」的 sessionId。
   * 切会话时绝不能沿用上一会话的 boolean——否则会把 hold 上一屏冲成空白。
   */
  const [hydratedForSessionId, setHydratedForSessionId] = useState<string | null>(() =>
    sessionId && (hydratedSessionsGlobal.has(sessionId) || store.getMessages(sessionId).length > 0)
      ? sessionId
      : null,
  );
  const [hasOlderMessagesState, setHasOlderMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);

  const messages = useSyncExternalStore(
    store.subscribe,
    () => store.getState().get(sessionKey) ?? EMPTY_ARRAY,
    () => EMPTY_ARRAY,
  );

  // 无 session 时派生为 false，避免 effect 里同步 setState
  const hasOlderMessages = !!sessionId && hasOlderMessagesState;

  // 同步按「当前 session」派生：缓存命中 / 全局已水合 / 本 session 对账完成
  const isMessagesHydrated =
    !!sessionId &&
    (hydratedSessionsGlobal.has(sessionId) ||
      messages.length > 0 ||
      hydratedForSessionId === sessionId);

  useEffect(() => {
    if (!sessionId) return;
    store.watchSession(sessionId);

    const cached = store.getMessages(sessionId);
    const already = hydratedSessionsGlobal.has(sessionId) || cached.length > 0;
    if (already) {
      // isMessagesHydrated 已由 global/cache 派生为 true，无需 effect 内同步 setState
      void (async () => {
        try {
          const { nextCursor } = await fetchAndHydrateSession(sessionId, (opts) =>
            utilsRef.current.message.listForChat.fetch(opts),
          );
          if (nextCursor !== undefined) {
            cursorRef.current = nextCursor ?? undefined;
            setHasOlderMessages(!!nextCursor);
          }
        } catch {
          streamLifecycleActions.hydrateDone(sessionId);
        }
      })();
      return;
    }

    // 冷会话：保持 hydratedForSessionId !== sessionId，直到 fetch 完成
    let cancelled = false;
    void (async () => {
      try {
        const { nextCursor } = await fetchAndHydrateSession(sessionId, (opts) =>
          utilsRef.current.message.listForChat.fetch(opts),
        );
        if (cancelled) return;
        cursorRef.current = nextCursor ?? undefined;
        setHasOlderMessages(!!nextCursor);
        setHydratedForSessionId(sessionId);
      } catch (err) {
        console.warn(`[useSessionMessages] hydrate ${sessionId} 失败:`, err);
        if (!cancelled) setHydratedForSessionId(sessionId);
        streamLifecycleActions.hydrateDone(sessionId);
      }
    })();
    return () => {
      cancelled = true;
      // 根因修复：切走时关闭旧 session 的 EventSource，防止 HTTP/1.1 6 连接上限耗尽
      // 导致后续 session 的 listForChat fetch 排队挂起 → 永久转圈
      store.closeSessionWatch(sessionId);
    };
  }, [sessionId, store]);

  const loadOlderMessages = useCallback(async () => {
    if (!sessionId || !cursorRef.current || isLoadingOlderMessages) return;
    setIsLoadingOlderMessages(true);
    try {
      const res = await utilsRef.current.message.listForChat.fetch({
        sessionId,
        cursor: cursorRef.current,
        limit: 50,
      });
      const items = res.items as ChatMessage[];
      const existing = store.getMessages(sessionId);
      for (const m of items) {
        if (!existing.some((e) => e.id === m.id)) {
          store.dispatch({ type: "upsert", sessionId, message: m });
        }
      }
      cursorRef.current = res.nextCursor;
      setHasOlderMessages(!!res.nextCursor);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [sessionId, store, isLoadingOlderMessages]);

  const hydrateFromServer = useCallback(async () => {
    if (!sessionId) return;
    const { nextCursor } = await fetchAndHydrateSession(sessionId, (opts) =>
      utilsRef.current.message.listForChat.fetch(opts),
    );
    cursorRef.current = nextCursor ?? undefined;
    setHasOlderMessages(!!nextCursor);
    setHydratedForSessionId(sessionId);
  }, [sessionId]);

  return {
    messages,
    isMessagesHydrated,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderMessages,
    hydrateFromServer,
  };
}

/** 模块级操作：跨组件 watch 子会话、主动 hydrate 等 */
export const sessionMessagesStore = {
  getMessages: (sessionId: string) => getStore().getMessages(sessionId),
  watchSession: (sessionId: string) => getStore().watchSession(sessionId),
  closeSessionWatch: (sessionId: string) => getStore().closeSessionWatch(sessionId),
  addSessionEventListener: (sessionId: string, eventType: string, handler: (ev: MessageEvent) => void) =>
    getStore().addSessionEventListener(sessionId, eventType, handler),
  clearSession: (sessionId: string) => getStore().clearSession(sessionId),
  forgetSession: (sessionId: string) => {
    hydratedSessionsGlobal.delete(sessionId);
  },
  onMessageUpserted: (sessionId: string, cb: (m: ChatMessage) => void) =>
    getStore().onMessageUpserted(sessionId, cb),
  hydrateSessionMessages: (
    sessionId: string,
    messages: ChatMessage[],
    source: MessageHydrateSource = "view",
  ) => getStore().hydrateSessionMessages(sessionId, messages, source),
  /** 悬停/即将切换时预热 MessageStore（prefetch：不触发 drain） */
  prefetchSessionMessages: (
    sessionId: string,
    fetchPage: (opts: { sessionId: string; limit: number }) => Promise<ListForChatPage>,
  ) => {
    if (!sessionId) return Promise.resolve();
    if (hydratedSessionsGlobal.has(sessionId) || getStore().getMessages(sessionId).length > 0) {
      return Promise.resolve();
    }
    return fetchAndHydrateSession(sessionId, fetchPage, "prefetch").then(() => undefined);
  },
  upsertAssistantFromDone: (
    sessionId: string,
    data: {
      assistantMessageId: string;
      content: string;
      toolCalls?: ChatMessage["toolCalls"];
      tokenUsage?: ChatMessage["tokenUsage"];
      finishReason?: string | null;
    },
  ) => getStore().upsertAssistantFromDone(sessionId, data),
};
