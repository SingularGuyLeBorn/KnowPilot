"use client";

/**
 * useStreamLifecycle —— 流式生命周期显式状态机。
 *
 * phase: idle → streaming → done | error → idle
 *
 * 不变量（INV）：
 * - INV-1：done → idle 只能经 commitStream（MessageStore 已承接本轮 assistant）。
 *   COMMIT_STREAM 合法源相位：done | error。streaming 非法（dev console.error，生产 no-op）。
 *   流式中道崩殂释放占用走 ABORT_STREAM，禁止 commitStream 直跳。
 * - INV-2：Compose 仅当 phase === idle 才可 beginStream（streaming|done = isRunOccupied）
 * - INV-3：过渡 UI（streamingContent/liveTimeline）在 commit 前不得被新 BEGIN_STREAM 清掉
 * - INV-4：渲染单一所有权 —— 一条 assistant 消息任一时刻只能有一个渲染源。
 *   流式期间（phase !== idle）本轮 assistant 由 liveTimeline 独占渲染；
 *   message_upserted 先于 done 到达时记入 inFlightAssistantId，渲染层据此屏蔽
 *   MessageStore 里的同一条消息，直到 commit 后才由 MessageStore 独占。
 *   否则会出现「正式回复先出现 → done 后闪烁重建完整时间线」的双渲染竞态。
 * - INV-8（drain 单驱动）：Compose 队列的 drain 只能由四个显式事件触发——
 *   ① 用户入队（enqueueMessage / 转后台重试按钮）；
 *   ② onStreamCommitted（Lifecycle 进入 idle）；
 *   ③ 会话切换完成（selectSession / URL→state 同步，同一事件处理内同步触发）；
 *   ④ 数据 hydrate 完成（HYDRATE_DONE：消息 hydrate、发送队列 hydrate、
 *      异步队列刷新、sessionStorage 恢复）。
 *   禁止用 useEffect 监听 store 状态（queue.length / isStreaming / messages.length /
 *   isMessagesHydrated）隐式触发 drain——状态变化不是事件，时序变了就破。
 *   HYDRATE_DONE 在 reducer 转移点置 drainRequested 标记（仅 phase=idle 时置位；
 *   占用中由 ② commit 兜底），由 onStreamCommitted 同款显式钩子消费；
 *   晚于请求才订阅的钩子用 takeDrainRequests() 一次性吃掉存量，不依赖订阅时序。
 *
 * 相位合法性表（action → 合法源相位）：
 * - BEGIN_STREAM（非 resume）：idle
 * - COMPLETE_STREAM：streaming
 * - FAIL_STREAM：streaming | done
 * - ABORT_STREAM：streaming | done
 * - COMMIT_STREAM：done | error
 * - CLEAR_ERROR：error（→ idle）
 *
 * ABORT_STREAM：partialAssistantMessageId 有值 → done（abort-pending，等 upsert 对齐）；
 * null → 立即 idle（leftover/timeline 清空）。optimistic 清理由调用方 Compose 负责。
 *
 * 公开 API 全部语义化（beginStream / appendTokenDelta / completeStream / abortStream / commitStream …），禁止 ssSet。
 * 队列、optimistic、abort 不进本 store（见 useSessionComposeState）。
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
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
  /** INV-8：数据 hydrate 完成请求 drain 的标记（仅 idle 置位；进入 idle 的转移自身即驱动 drain，故 commit 时清除） */
  drainRequested: boolean;
  /** completeStream 进入 done 的单调时刻；超时未 commit 则强制释放占用 */
  doneEnteredAt: number | null;
  /** RESUME_CLAIM：true 时拒绝并发 beginStream(resume) */
  resumeClaimed: boolean;
}

/** done 相位等待 MessageStore 对齐的上限；超时强制 commit，避免发送队列永久占用 */
export const DONE_COMMIT_TIMEOUT_MS = 8_000;

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
  drainRequested: false,
  doneEnteredAt: null,
  resumeClaimed: false,
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
  | {
      type: "ABORT_STREAM";
      sessionId: string;
      /** 有 id → abort-pending（done）；null → 立即 idle */
      partialAssistantMessageId: string | null;
      leftoverContent?: string;
    }
  | { type: "CLEAR_ERROR"; sessionId: string }
  | { type: "COMMIT_STREAM"; sessionId: string }
  | { type: "MARK_INFLIGHT_ASSISTANT"; sessionId: string; messageId: string }
  | { type: "HYDRATE_DONE"; sessionId: string }
  | { type: "CLEAR_DRAIN_REQUEST"; sessionId: string }
  | { type: "RELEASE_RESUME_CLAIM"; sessionId: string }
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
        // RESUME_CLAIM：已有 resume 在途则拒绝双挂
        if (prev.resumeClaimed && prev.phase === "streaming" && prev.connected) {
          if (process.env.NODE_ENV !== "production") {
            console.error(
              `[StreamLifecycle] resume blocked: session ${action.sessionId} already claimed`,
            );
          }
          return state;
        }
        return set(action.sessionId, {
          ...prev,
          phase: "streaming",
          error: null,
          connected: true,
          resumeClaimed: true,
          doneEnteredAt: null,
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
        // 不预插空 Thinking：等首个 reasoning delta 再创建（避免多轮工具后满屏空壳）
        liveTimeline: [],
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
      const round = action.round > 0 ? action.round : 1;
      // 优先写入同 round 的 thinking；避免多轮时 delta 糊到上一轮
      for (let i = copy.length - 1; i >= 0; i--) {
        const step = copy[i];
        if (step.type === "thinking" && step.round === round) {
          copy[i] = { type: "thinking", content: step.content + action.delta, round };
          return set(action.sessionId, { ...s, liveTimeline: copy });
        }
      }
      // 复用末尾空占位（兼容旧 resume 重放）
      for (let i = copy.length - 1; i >= 0; i--) {
        const step = copy[i];
        if (step.type === "thinking" && !step.content.trim()) {
          copy[i] = { type: "thinking", content: action.delta, round };
          return set(action.sessionId, { ...s, liveTimeline: copy });
        }
      }
      return set(action.sessionId, {
        ...s,
        liveTimeline: [...copy, { type: "thinking", content: action.delta, round }],
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
      // 合法源：streaming
      const s = get(action.sessionId);
      if (s.phase !== "streaming") {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[StreamLifecycle] COMPLETE_STREAM blocked: session ${action.sessionId} phase=${s.phase}`,
          );
        }
        return state;
      }
      return set(action.sessionId, {
        ...s,
        phase: "done",
        streamingContent: action.content,
        error: null,
        connected: false,
        resumeClaimed: false,
        doneEnteredAt: Date.now(),
        pendingAssistantMessageId: action.assistantMessageId,
        pendingAssistantContent: action.content.trim() ? action.content : null,
      });
    }
    case "FAIL_STREAM": {
      // 合法源：streaming | done
      const s = get(action.sessionId);
      if (s.phase !== "streaming" && s.phase !== "done") {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[StreamLifecycle] FAIL_STREAM blocked: session ${action.sessionId} phase=${s.phase}`,
          );
        }
        return state;
      }
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
        drainRequested: false,
        doneEnteredAt: null,
        resumeClaimed: false,
      });
    }
    case "ABORT_STREAM": {
      // 合法源：streaming | done
      // 有 partialId → done（abort-pending，等 MessageStore 对齐后再 COMMIT）；
      // null → 立即 idle（leftover/timeline 清空，释放占用）
      const s = get(action.sessionId);
      if (s.phase !== "streaming" && s.phase !== "done") {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[StreamLifecycle] ABORT_STREAM blocked: session ${action.sessionId} phase=${s.phase}`,
          );
        }
        return state;
      }
      const leftover = (action.leftoverContent ?? s.streamingContent).trim();
      if (action.partialAssistantMessageId) {
        return set(action.sessionId, {
          ...s,
          phase: "done",
          streamingContent: leftover,
          error: null,
          connected: false,
          pendingAssistantMessageId: action.partialAssistantMessageId,
          pendingAssistantContent: leftover || null,
          drainRequested: false,
        });
      }
      return set(action.sessionId, {
        ...IDLE_STATE,
        // 保留 error 字段以外的清场；abort 非 error 路径
      });
    }
    case "CLEAR_ERROR": {
      const s = get(action.sessionId);
      return set(action.sessionId, {
        ...s,
        error: null,
        phase: s.phase === "error" ? "idle" : s.phase,
        // error→idle 转移自身触发 notifyCommit（INV-8 ②），存量请求视为已消费
        drainRequested: s.phase === "error" ? false : s.drainRequested,
      });
    }
    case "COMMIT_STREAM": {
      // INV-1：合法源 done | error；拒绝 streaming→idle 直跳
      const s = get(action.sessionId);
      if (s.phase !== "done" && s.phase !== "error") {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[StreamLifecycle] COMMIT_STREAM blocked: session ${action.sessionId} phase=${s.phase}（streaming 释放请用 ABORT_STREAM）`,
          );
        }
        return state;
      }
      // 进入 idle 的转移自身触发 notifyCommit（INV-8 ②），drainRequested 视为已消费
      return set(action.sessionId, {
        ...s,
        liveTimeline: [],
        streamingContent: "",
        phase: "idle",
        streamTargetUserId: null,
        pendingAssistantMessageId: null,
        pendingAssistantContent: null,
        inFlightAssistantId: null,
        connected: false,
        drainRequested: false,
        doneEnteredAt: null,
        resumeClaimed: false,
      });
    }
    case "RELEASE_RESUME_CLAIM": {
      const s = get(action.sessionId);
      if (!s.resumeClaimed) return state;
      return set(action.sessionId, { ...s, resumeClaimed: false });
    }
    case "MARK_INFLIGHT_ASSISTANT": {
      // INV-4：仅流式占用期间记录；idle 时到达的 upsert 是正常 stored 渲染，不屏蔽
      const s = get(action.sessionId);
      if (!isOccupiedPhase(s.phase)) return state;
      if (s.inFlightAssistantId === action.messageId) return state;
      return set(action.sessionId, { ...s, inFlightAssistantId: action.messageId });
    }
    case "HYDRATE_DONE": {
      // INV-8 ④：数据 hydrate 完成 = 显式 drain 请求。
      // 仅 idle 置位；占用中不置位——commit 进入 idle 时 notifyCommit 会驱动 drain（INV-8 ②）。
      const s = get(action.sessionId);
      if (s.phase !== "idle" || s.drainRequested) return state;
      return set(action.sessionId, { ...s, drainRequested: true });
    }
    case "CLEAR_DRAIN_REQUEST": {
      const s = get(action.sessionId);
      if (!s.drainRequested) return state;
      return set(action.sessionId, { ...s, drainRequested: false });
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
  /** listener → 只关心的 sessionId；null = 全局（序列化/测试） */
  private listeners = new Map<Listener, string | null>();
  private commitListeners = new Set<CommitListener>();
  /** done 超时强制 commit 的计时器（进 store，不进编排层 setTimeout 赌 hydrate） */
  private doneWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();

  getState = (): LifecycleMap => this.state;

  private clearDoneWatchdog = (sessionId: string): void => {
    const t = this.doneWatchdogs.get(sessionId);
    if (t != null) {
      clearTimeout(t);
      this.doneWatchdogs.delete(sessionId);
    }
  };

  private armDoneWatchdog = (sessionId: string): void => {
    this.clearDoneWatchdog(sessionId);
    this.doneWatchdogs.set(
      sessionId,
      setTimeout(() => {
        this.doneWatchdogs.delete(sessionId);
        const s = this.state.get(sessionId);
        if (!s || s.phase !== "done") return;
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[StreamLifecycle] done 超时 ${DONE_COMMIT_TIMEOUT_MS}ms 未对齐 MessageStore，强制 commit session=${sessionId}`,
          );
        }
        this.dispatch({ type: "COMMIT_STREAM", sessionId });
      }, DONE_COMMIT_TIMEOUT_MS),
    );
  };

  /**
   * @param filterSessionId 传入时仅该 session 的 action 触发回调（token 热路径减扇出）
   */
  subscribe = (listener: Listener, filterSessionId?: string | null): (() => void) => {
    this.listeners.set(listener, filterSessionId === undefined ? null : filterSessionId);
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

  private notifyListeners = (changedSessionIds: string[]): void => {
    for (const [listener, filter] of this.listeners) {
      if (filter == null || changedSessionIds.includes(filter)) {
        try {
          listener();
        } catch {
          /* ignore */
        }
      }
    }
  };

  dispatch = (action: Action): void => {
    const occupiedBefore = new Map<string, StreamPhase>();
    const drainBefore = new Map<string, boolean>();
    for (const [sid, st] of this.state) {
      occupiedBefore.set(sid, st.phase);
      drainBefore.set(sid, st.drainRequested);
    }
    this.state = reducer(this.state, action);

    // done watchdog：进入 done 武装；离开 done/销毁时拆除
    // ABORT_STREAM：带 partialId → 进入 done（abort-pending）需武装；null → 立即 idle 需拆除
    if (
      action.type === "COMPLETE_STREAM" ||
      (action.type === "ABORT_STREAM" && action.partialAssistantMessageId)
    ) {
      this.armDoneWatchdog(action.sessionId);
    } else if (
      action.type === "COMMIT_STREAM" ||
      (action.type === "ABORT_STREAM" && !action.partialAssistantMessageId) ||
      action.type === "FAIL_STREAM" ||
      action.type === "RESET" ||
      action.type === "DELETE" ||
      (action.type === "BEGIN_STREAM" && !action.resume)
    ) {
      this.clearDoneWatchdog(action.sessionId);
    } else if (action.type === "MIGRATE_STREAM_SESSION") {
      const t = this.doneWatchdogs.get(action.fromKey);
      if (t != null) {
        this.doneWatchdogs.delete(action.fromKey);
        this.doneWatchdogs.set(action.toSessionId, t);
      }
    }

    if (action.type === "MIGRATE_STREAM_SESSION") {
      this.notifyListeners([action.fromKey, action.toSessionId]);
    } else {
      this.notifyListeners([action.sessionId]);
    }
    // 任意 session 进入 idle 时通知 Compose drain（INV-2 / INV-8 ②）
    for (const [sid, st] of this.state) {
      if (st.phase === "idle" && occupiedBefore.get(sid) !== "idle") {
        this.notifyCommit(sid);
      }
      // INV-8 ④：drainRequested 置位（false→true）走同一显式钩子消费
      if (st.drainRequested && !drainBefore.get(sid)) {
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

  /**
   * INV-8：吃掉所有已置位但尚未被钩子消费的 drain 请求（晚订阅补偿）。
   * 钩子 mount 晚于 HYDRATE_DONE 置位时（如 sessionStorage 恢复），靠它兜底，不依赖订阅时序。
   */
  takeDrainRequests = (): string[] => {
    const sids: string[] = [];
    for (const [sid, st] of this.state) {
      if (st.drainRequested) sids.push(sid);
    }
    for (const sid of sids) {
      this.dispatch({ type: "CLEAR_DRAIN_REQUEST", sessionId: sid });
    }
    return sids;
  };
}

let globalStore: StreamLifecycleStore | null = null;

/** E3：stopAgentChat 返回的 partial id，供 AbortError 路径 abortStream 消费（无 setTimeout） */
const pendingAbortPartials = new Map<string, string | null>();

function getStore(): StreamLifecycleStore {
  if (!globalStore) globalStore = new StreamLifecycleStore();
  return globalStore;
}

/** 单测重置（勿在生产路径调用） */
export function __resetStreamLifecycleStoreForTests(): void {
  globalStore = null;
  pendingAbortPartials.clear();
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
  beginStream(
    sessionId: string,
    opts: { streamTargetUserId?: string | null; resume?: boolean } = {},
  ): boolean {
    const resume = opts.resume === true;
    const before = getStore().get(sessionId);
    if (resume && before.resumeClaimed && before.phase === "streaming" && before.connected) {
      return false;
    }
    if (!resume && isOccupiedPhase(before.phase)) {
      return false;
    }
    getStore().dispatch({
      type: "BEGIN_STREAM",
      sessionId,
      streamTargetUserId: opts.streamTargetUserId ?? null,
      resume,
    });
    const after = getStore().get(sessionId);
    return after.phase === "streaming";
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
  /**
   * 流式中道崩殂 / 用户停止：合法释放占用。
   * - partialAssistantMessageId 有值 → done（abort-pending），等 upsert 对齐后 COMMIT
   * - null → 立即 idle（清空 leftover/timeline）
   */
  abortStream(
    sessionId: string,
    opts: { partialAssistantMessageId: string | null; leftoverContent?: string },
  ) {
    getStore().dispatch({
      type: "ABORT_STREAM",
      sessionId,
      partialAssistantMessageId: opts.partialAssistantMessageId,
      leftoverContent: opts.leftoverContent,
    });
  },
  /**
   * E3：用户点停止后、abort() 前登记 stopAgentChat 返回的 partialAssistantMessageId。
   * AbortError 路径 take 后走 abortStream——有 id 等对齐，null 立即 idle；无计时器。
   */
  setPendingAbortPartial(sessionId: string, partialAssistantMessageId: string | null) {
    pendingAbortPartials.set(sessionId, partialAssistantMessageId);
  },
  /** @returns undefined = 非用户 stop（如新流 supersede）；string|null = stop 契约 */
  takePendingAbortPartial(sessionId: string): string | null | undefined {
    if (!pendingAbortPartials.has(sessionId)) return undefined;
    const v = pendingAbortPartials.get(sessionId) ?? null;
    pendingAbortPartials.delete(sessionId);
    return v;
  },
  /** done/error → idle（空回复、fail 后释放）。streaming/idle 由 reducer 拒绝（dev 报错） */
  commitStream(sessionId: string) {
    getStore().dispatch({ type: "COMMIT_STREAM", sessionId });
  },
  releaseResumeClaim(sessionId: string) {
    getStore().dispatch({ type: "RELEASE_RESUME_CLAIM", sessionId });
  },
  /**
   * INV-5：续传起点唯一判定——本地已有进度则接 lastEventId，否则 0 全量重放。
   * listRunning / selectSession / visibility / mount 必须共用，禁止各 effect 手写。
   */
  resolveResumeAfter(sessionId: string): number {
    const st = getStore().get(sessionId);
    const hasLocalProgress =
      st.phase === "streaming" &&
      (st.lastEventId > 0 ||
        st.liveTimeline.some((s) => s.type !== "thinking" || Boolean(s.content)));
    return hasLocalProgress ? st.lastEventId : 0;
  },
  /**
   * INV-4：流式期间 message_upserted 提前送达本轮 assistant 时登记 id，
   * 渲染层据此屏蔽 stored 渲染直到 commit。idle 时调用为 no-op。
   */
  markInFlightAssistant(sessionId: string, messageId: string) {
    getStore().dispatch({ type: "MARK_INFLIGHT_ASSISTANT", sessionId, messageId });
  },
  /**
   * INV-8 ④ hydrate_view：数据 hydrate 完成（消息 view / 发送队列 / 异步队列 / sessionStorage）→
   * 在 reducer 转移点置 drainRequested，由 onStreamCommitted 同款钩子消费。
   * 占用中调用为 no-op（commit 进入 idle 时自会驱动 drain）。
   * 注意：消息 prefetch 不得调用本方法（见 MessageHydrateSource）。
   */
  hydrateDone(sessionId: string) {
    getStore().dispatch({ type: "HYDRATE_DONE", sessionId });
  },
  /** INV-8：drain 钩子消费请求后清除标记，使下一次 hydrate 可再次置位 */
  clearDrainRequest(sessionId: string) {
    getStore().dispatch({ type: "CLEAR_DRAIN_REQUEST", sessionId });
  },
  failStream(sessionId: string, message: string) {
    getStore().dispatch({ type: "FAIL_STREAM", sessionId, message });
  },
  clearError(sessionId: string) {
    getStore().dispatch({ type: "CLEAR_ERROR", sessionId });
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
  takeDrainRequests: () => getStore().takeDrainRequests(),
  resolveResumeAfter: (sessionId: string) => streamLifecycleActions.resolveResumeAfter(sessionId),
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
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange, key),
    [store, key],
  );
  const state = useSyncExternalStore(
    subscribe,
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
