/**
 * SessionStreamHub —— 把 Agent 运行与 SSE 连接解耦，并支持持久化续传。
 *
 * 架构：
 * - 每个 session 的 Agent 运行在独立 Promise 中，客户端断线不 abort。
 * - 事件同时进入「内存环形缓冲」（热数据、低延迟推送）和「SQLite 事件日志」
 *   （持久化、服务端重启后可按 sessionId 续传）。
 * - 订阅时优先重放内存缓冲；若运行已结束或进程已重启，则从 SQLite 重放。
 */

import type { AgentStreamEvent } from "./agentStream.js";
import type { AgentChatInput } from "@knowpilot/shared";
import type { AppConfig } from "./config.js";
import { prisma } from "../db.js";

export type BufferedEvent = {
  id: number;
  event: AgentStreamEvent;
};

type StreamConfig = AppConfig["stream"];

/** 运行中注入的用户消息（Steering / Follow-up） */
export type RunInjectMessage = {
  id: string;
  content: string;
  createdAt: number;
};

type RunState = {
  sessionId: string;
  input: AgentChatInput;
  abortController: AbortController;
  buffer: BufferedEvent[];
  subscribers: Set<(event: BufferedEvent) => void>;
  promise: Promise<void>;
  completed: boolean;
  nextId: number;
  runningSince: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  /** tool_batch 结束后、下一轮 LLM 前注入 */
  steeringQueue: RunInjectMessage[];
  /** 本会停止时注入并续轮 */
  followUpQueue: RunInjectMessage[];
};

type PersistItem = {
  sessionId: string;
  eventType: string;
  payload: AgentStreamEvent;
};

export type RunningSessionInfo = {
  sessionId: string;
  lastEventId: number;
  runningSince: number;
};

export class SessionStreamHub {
  private runs = new Map<string, RunState>();
  private persistQueue: PersistItem[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** 独立于 Agent 运行流的外部事件订阅者（如 async_delivery） */
  private externalSubs = new Map<string, Set<(event: AgentStreamEvent) => void>>();
  /**
   * 外部事件短环形缓冲：EventSource 尚未连上时 pushExternalEvent 会丢事件
   * （无活跃 Agent run 时也不进 runs.buffer）。subscribeExternal 时重放，
   * 让 session_queue_update 等幂等事件不依赖「先连上再推」时序。
   */
  private externalRing = new Map<string, AgentStreamEvent[]>();
  private static readonly EXTERNAL_RING_SIZE = 32;
  private config: StreamConfig;

  constructor(config: Partial<StreamConfig> = {}) {
    this.config = {
      ringSize: 500,
      persist: true,
      eventTtlMs: 300_000,
      cleanupIntervalMs: 60_000,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      ...config,
    };
    if (this.config.persist && this.config.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.deleteExpired(), this.config.cleanupIntervalMs);
      // 启动时先清理一轮，避免上次崩溃残留过期数据
      void this.deleteExpired();
    }
  }

  private async maxEventIdFor(sessionId: string): Promise<number> {
    if (!this.config.persist) return 0;
    try {
      const agg = await prisma.sessionStreamEvent.aggregate({
        where: { sessionId },
        _max: { id: true },
      });
      return agg._max.id ?? 0;
    } catch (err) {
      console.warn(`[SessionStreamHub] 查询 ${sessionId} 最大事件 id 失败:`, err);
      return 0;
    }
  }

  isRunning(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    return !!run && !run.completed;
  }

  /** drain 已认领、prepare 段尚未起流的会话（S2）：同步等待类轮询的空闲判定必须把它算作「忙」 */
  private startingSessions = new Set<string>();

  /** drain 认领队列项后同步宣告「即将起流」，闭合「consume 删行 → prepare 段 DB 工作 → hub.start」
   *  间隙被 spawn waitForResult 轮询误判空闲（抓前轮旧 assistant 当本轮结果）的窗口 */
  markRunStarting(sessionId: string): void {
    this.startingSessions.add(sessionId);
  }

  unmarkRunStarting(sessionId: string): void {
    this.startingSessions.delete(sessionId);
  }

  isRunStarting(sessionId: string): boolean {
    return this.startingSessions.has(sessionId);
  }

  getLastEventId(sessionId: string): number {
    const run = this.runs.get(sessionId);
    if (run) return run.nextId - 1;
    // 运行不在内存时，从持久化取最后 id（供客户端判断是否需要续传）
    if (!this.config.persist) return 0;
    // 同步接口不适合 await；调用方若需要精确值可改为 getLastEventIdAsync
    return 0;
  }

  getStatus(sessionId: string): { running: boolean; lastEventId: number } {
    const run = this.runs.get(sessionId);
    return {
      running: !!run && !run.completed,
      lastEventId: run ? run.nextId - 1 : 0,
    };
  }

  /** 运行中流总数（全部活跃 run；Q2「交互 running」口径由任务池用 occupancy claim 过滤，见 asyncJobOrchestrator） */
  runningCount(): number {
    let n = 0;
    for (const run of this.runs.values()) {
      if (!run.completed) n++;
    }
    return n;
  }

  listRunning(): RunningSessionInfo[] {
    const result: RunningSessionInfo[] = [];
    for (const [sessionId, run] of this.runs) {
      if (!run.completed) {
        result.push({ sessionId, lastEventId: run.nextId - 1, runningSince: run.runningSince });
      }
    }
    return result;
  }

  /**
   * 推送外部事件（非 Agent 运行产生的事件，如异步任务完成）。
   * - 始终推给 async-stream 的 externalSubs（否则 autoConsume 开跑后
   *   session_run_started / async_job_update 会只进 Agent 流，前端 EventSource 收不到、只能刷新才续上）。
   * - 若该 session 有活跃 Agent 流，同时写入环形缓冲并推给流 subscribers。
   */
  pushExternalEvent(sessionId: string, event: AgentStreamEvent): void {
    const ring = this.externalRing.get(sessionId) ?? [];
    ring.push(event);
    if (ring.length > SessionStreamHub.EXTERNAL_RING_SIZE) ring.shift();
    this.externalRing.set(sessionId, ring);

    const subs = this.externalSubs.get(sessionId);
    if (subs) {
      for (const sub of subs) {
        try {
          sub(event);
        } catch {
          /* ignore */
        }
      }
    }

    const run = this.runs.get(sessionId);
    if (run && !run.completed) {
      const buffered: BufferedEvent = { id: run.nextId++, event };
      run.buffer.push(buffered);
      if (run.buffer.length > this.config.ringSize) run.buffer.shift();
      this.enqueuePersist(buffered, run.sessionId);
      for (const sub of run.subscribers) {
        try {
          Promise.resolve(sub(buffered)).catch(() => {});
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** 订阅外部事件（独立于 Agent 运行流）。返回 unsubscribe 函数。 */
  subscribeExternal(sessionId: string, onEvent: (event: AgentStreamEvent) => void): () => void {
    // 先重放短环（幂等：前端 session_queue_update / async_* 均以 refetch+merge 消化）
    const ring = this.externalRing.get(sessionId) ?? [];
    for (const event of ring) {
      try {
        onEvent(event);
      } catch {
        /* ignore */
      }
    }

    let subs = this.externalSubs.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.externalSubs.set(sessionId, subs);
    }
    subs.add(onEvent);
    return () => {
      subs!.delete(onEvent);
      if (subs!.size === 0) this.externalSubs.delete(sessionId);
    };
  }

  /**
   * 幂等启动：若该 session 已在运行则返回 false；否则启动并返回 true。
   */
  async startIfNotRunning(
    sessionId: string,
    input: AgentChatInput,
    runner: (emit: (event: AgentStreamEvent) => void, signal: AbortSignal) => Promise<void>,
  ): Promise<boolean> {
    if (this.isRunning(sessionId)) return false;
    try {
      await this.start(sessionId, input, runner);
      return true;
    } catch (err) {
      // 并发竞态：start 内同步占位后，第二个调用方的 isRunning 检查会抛「已运行」→ 视作未启动
      if (err instanceof Error && /已有运行中的 Agent 流/.test(err.message)) return false;
      throw err;
    }
  }

  /**
   * 启动一次新的 Agent 运行。若已有运行中的任务则抛异常。
   */
  async start(
    sessionId: string,
    input: AgentChatInput,
    runner: (emit: (event: AgentStreamEvent) => void, signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.isRunning(sessionId)) {
      throw new Error(`会话 ${sessionId} 已有运行中的 Agent 流`);
    }

    // TOCTOU 修复：先同步占位 runs.set，再 await maxEventIdFor。
    // 原实现 isRunning 检查 → await maxEventId（DB 异步）→ runs.set 之间有窗口，
    // 两个并发调用方（autoConsume + 用户发消息 / 多个异步投递）都能过 isRunning 检查，
    // 第二个 start 覆盖第一个 runs.set，第一个 run 被孤立泄漏、信号/队列状态错乱。
    // nextId 占位 0，await 后再赋值；runner 在 nextId 赋值后才启动，期间不会发事件，安全。
    //
    // cleanupTimer 覆盖竞态：上一轮 run 完成后设了 cleanupTimer（eventTtlMs 后 runs.delete），
    // 若本轮 start 在 cleanupTimer 触发前覆盖 runs 条目，旧 timer 触发时会删掉本轮 run。
    // 必须先清掉旧 run 的 cleanupTimer。
    const prevRun = this.runs.get(sessionId);
    if (prevRun?.cleanupTimer) {
      clearTimeout(prevRun.cleanupTimer);
      prevRun.cleanupTimer = undefined;
    }

    const abortController = new AbortController();
    const state: RunState = {
      sessionId,
      input,
      abortController,
      buffer: [],
      subscribers: new Set(),
      promise: Promise.resolve(),
      completed: false,
      nextId: 0,
      runningSince: Date.now(),
      steeringQueue: [],
      followUpQueue: [],
    };
    this.runs.set(sessionId, state);
    // 起流占位成功后「忙」由 isRunning 接管，清除 drain 宣告的「即将起流」标记（S2）
    this.startingSessions.delete(sessionId);

    const maxId = await this.maxEventIdFor(sessionId);
    state.nextId = maxId + 1;

    const emit = (event: AgentStreamEvent) => {
      if (state.completed) return;
      const buffered: BufferedEvent = { id: state.nextId++, event };
      state.buffer.push(buffered);
      if (state.buffer.length > this.config.ringSize) {
        state.buffer.shift();
      }
      this.enqueuePersist(buffered, state.sessionId);
      for (const sub of state.subscribers) {
        try {
          Promise.resolve(sub(buffered)).catch(() => {
            // 单个订阅者失败不打扰其他订阅者
          });
        } catch {
          /* ignore */
        }
      }
    };

    state.promise = (async () => {
      try {
        await runner(emit, abortController.signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message, sessionId });
      } finally {
        state.completed = true;
        // completed 置位后立即通知（listRunning 已不含本流）：订阅方按新口径重排
        emitHubRunSettled(sessionId);
        // 运行结束后保留一段时间，方便刚断线的前端重连取到 done/error
        await this.flushPersistQueue();
        state.cleanupTimer = setTimeout(() => {
          this.runs.delete(sessionId);
        }, this.config.eventTtlMs);
      }
    })();
  }

  /**
   * 等待指定 session 运行结束。
   */
  waitFor(sessionId: string): Promise<void> {
    const run = this.runs.get(sessionId);
    if (!run) return Promise.resolve();
    return run.promise;
  }

  /**
   * 订阅事件流。先重放历史（内存或 SQLite），再接入实时推送。
   */
  async subscribe(
    sessionId: string,
    afterEventId: number,
    onEvent: (event: BufferedEvent) => void,
  ): Promise<() => void> {
    const state = this.runs.get(sessionId);

    if (state) {
      const replayed = state.buffer.filter((ev) => ev.id > afterEventId);
      for (const ev of replayed) onEvent(ev);

      if (state.completed && replayed.length === 0 && state.buffer.length > 0) {
        const last = state.buffer[state.buffer.length - 1];
        // 订阅方错过了最终事件：补发 done/error，否则前端会卡在重连循环等不到 streaming→idle 归位
        if (last.event.type === "done" || last.event.type === "error") {
          onEvent(last);
        }
      }

      if (state.completed) {
        return () => {};
      }

      state.subscribers.add(onEvent);
      return () => {
        state.subscribers.delete(onEvent);
      };
    }

    // 内存中无运行：从持久化日志重放（服务端重启场景）
    if (this.config.persist) {
      try {
        const rows = await prisma.sessionStreamEvent.findMany({
          where: { sessionId, id: { gt: afterEventId } },
          orderBy: { id: "asc" },
        });
        for (const row of rows) {
          onEvent({ id: row.id, event: row.payload as AgentStreamEvent });
        }
      } catch (err) {
        console.warn(`[SessionStreamHub] 重放 ${sessionId} 持久化事件失败:`, err);
      }
    }

    return () => {};
  }

  /**
   * 迁移运行中的 sessionId（POST 占位场景）。同时迁移已持久化事件。
   */
  async migrateSessionId(oldId: string, newId: string): Promise<boolean> {
    const state = this.runs.get(oldId);
    if (!state) return false;

    state.sessionId = newId;
    this.runs.set(newId, state);
    this.runs.delete(oldId);

    // 已入队但尚未 flush 的事件也迁移 sessionId
    for (const item of this.persistQueue) {
      if (item.sessionId === oldId) item.sessionId = newId;
    }

    if (this.config.persist) {
      try {
        await prisma.sessionStreamEvent.updateMany({
          where: { sessionId: oldId },
          data: { sessionId: newId },
        });
        const maxId = await this.maxEventIdFor(newId);
        if (state.nextId <= maxId) state.nextId = maxId + 1;
      } catch (err) {
        console.warn(`[SessionStreamHub] 迁移持久化事件 ${oldId} -> ${newId} 失败:`, err);
      }
    }
    return true;
  }

  /**
   * 运行中注入 Steering / Follow-up。
   * @returns false 若 session 无活跃 run
   */
  enqueueInject(
    sessionId: string,
    kind: "steer" | "follow_up",
    content: string,
  ): { ok: true; id: string; kind: "steer" | "follow_up"; queued: number } | { ok: false; reason: string } {
    const state = this.runs.get(sessionId);
    if (!state || state.completed) {
      return { ok: false, reason: "会话当前没有运行中的 Agent，无法注入。请使用普通发送。" };
    }
    const text = content.trim();
    if (!text) return { ok: false, reason: "内容不能为空" };
    const item: RunInjectMessage = {
      id: `inj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      content: text,
      createdAt: Date.now(),
    };
    const queue = kind === "steer" ? state.steeringQueue : state.followUpQueue;
    queue.push(item);
    return { ok: true, id: item.id, kind, queued: queue.length };
  }

  /**
   * 取出待注入消息（按 config mode）。
   * one-at-a-time：只取队首一条；all：取全部。
   */
  takeInject(
    sessionId: string,
    kind: "steer" | "follow_up",
  ): RunInjectMessage[] {
    const state = this.runs.get(sessionId);
    if (!state) return [];
    const queue = kind === "steer" ? state.steeringQueue : state.followUpQueue;
    if (queue.length === 0) return [];
    const mode = kind === "steer" ? this.config.steeringMode : this.config.followUpMode;
    if (mode === "all") {
      return queue.splice(0, queue.length);
    }
    return [queue.shift()!];
  }

  /** abort 时清空未注入队列（已落库消息不删） */
  clearInjectQueues(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (!state) return;
    state.steeringQueue.length = 0;
    state.followUpQueue.length = 0;
  }

  /**
   * 显式停止某个 session 的运行（触发 abort）。
   * @param reason AbortSignal.reason：user=用户点停止；session_stop=级联清理
   */
  stop(sessionId: string, reason: "user" | "session_stop" = "user"): boolean {
    const state = this.runs.get(sessionId);
    if (!state || state.completed) return false;
    this.clearInjectQueues(sessionId);
    state.abortController.abort(reason);
    return true;
  }

  /** 进程退出时清理：停 cleanup interval，避免句柄泄漏阻止退出 */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    void this.flushPersistQueue().catch(() => undefined);
  }

  /**
   * 强制清理某个 session（包括内存运行与持久化事件）。
   */
  async clear(sessionId: string): Promise<void> {
    const state = this.runs.get(sessionId);
    if (state) {
      if (!state.completed) {
        state.abortController.abort("session_stop");
      }
      if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
      this.runs.delete(sessionId);
    }
    // 清理外部订阅者，避免已删除 session 的 EventSource listener 残留
    this.externalSubs.delete(sessionId);
    if (this.config.persist) {
      try {
        await prisma.sessionStreamEvent.deleteMany({ where: { sessionId } });
      } catch (err) {
        console.warn(`[SessionStreamHub] 清理 ${sessionId} 持久化事件失败:`, err);
      }
    }
  }

  /**
   * 优雅关闭：停止清理定时器并刷盘剩余事件。
   */
  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    // 显式清除 flushTimer：flushPersistQueue 在队列为空时提前 return 不清 timer，
    // 若异步 flush 刚 drain 完队列、新 timer 又被 enqueue 但尚未触发，dispose 会漏清。
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushPersistQueue();
  }

  /* 持久化：事件双写内存缓冲与 SQLite，支持断线续传和服务端重启恢复 */

  private enqueuePersist(buffered: BufferedEvent, sessionId: string) {
    if (!this.config.persist) return;
    this.persistQueue.push({
      sessionId,
      eventType: buffered.event.type,
      payload: buffered.event,
    });
    if (this.persistQueue.length >= 50) {
      void this.flushPersistQueue();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flushPersistQueue(), 50);
    }
  }

  private async flushPersistQueue(): Promise<void> {
    if (!this.config.persist || this.persistQueue.length === 0) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.persistQueue.splice(0, this.persistQueue.length);
    try {
      await prisma.sessionStreamEvent.createMany({
        data: batch.map((item) => ({
          sessionId: item.sessionId,
          eventType: item.eventType,
          payload: item.payload as unknown as import("@prisma/client").Prisma.InputJsonValue,
        })),
      });
    } catch (err) {
      console.warn(`[SessionStreamHub] 持久化 ${batch.length} 条事件失败:`, err);
      // 失败时丢回队列，避免无限丢失；但注意顺序可能乱
      this.persistQueue.unshift(...batch);
    }
  }

  private async deleteExpired(): Promise<void> {
    if (!this.config.persist || this.config.eventTtlMs <= 0) return;
    const cutoff = new Date(Date.now() - this.config.eventTtlMs);
    try {
      const result = await prisma.sessionStreamEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        console.log(`[SessionStreamHub] 清理 ${result.count} 条过期流式事件`);
      }
    } catch (err) {
      console.warn("[SessionStreamHub] 清理过期事件失败:", err);
    }
  }
}

let globalStreamHub: SessionStreamHub | null = null;

export function setStreamHub(hub: SessionStreamHub | null): void {
  globalStreamHub = hub;
}

export function getStreamHub(): SessionStreamHub | null {
  return globalStreamHub;
}

/**
 * hub 运行结束事件（模块级订阅，与 globalStreamHub 同生命周期模式）。
 * 典型订阅方：全局任务池——Q2 pull 口径解决「怎么算占用」，不解决「何时重排」；
 * 交互流结束必须显式通知池重新调度，否则 queued 任务在下一次池事件前无人唤醒（TP-4 暴露）。
 */
type HubRunSettledListener = (sessionId: string) => void;
const runSettledListeners = new Set<HubRunSettledListener>();

export function onHubRunSettled(listener: HubRunSettledListener): () => void {
  runSettledListeners.add(listener);
  return () => runSettledListeners.delete(listener);
}

/** 运行收尾时触发（completed 已置位，此刻 listRunning 已不含本流） */
export function emitHubRunSettled(sessionId: string): void {
  for (const listener of runSettledListeners) {
    try {
      listener(sessionId);
    } catch {
      /* 监听失败不阻塞 hub 收尾 */
    }
  }
}
