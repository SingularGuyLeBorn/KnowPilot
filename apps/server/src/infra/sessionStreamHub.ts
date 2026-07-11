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

  constructor(private config: StreamConfig = { ringSize: 500, persist: true, eventTtlMs: 300_000, cleanupIntervalMs: 60_000 }) {
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
    };
    this.runs.set(sessionId, state);

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
   * 显式停止某个 session 的运行（触发 abort）。
   */
  stop(sessionId: string): boolean {
    const state = this.runs.get(sessionId);
    if (!state || state.completed) return false;
    state.abortController.abort();
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
        state.abortController.abort();
      }
      if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
      this.runs.delete(sessionId);
    }
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
    await this.flushPersistQueue();
  }

  /* ─── 持久化 ─── */

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
