/**
 * SessionStreamHub — 把 Agent 运行与 SSE 连接解耦。
 *
 * 每个 session 的 Agent 运行在独立的 Promise 中（不随客户端断开而 abort），
 * 运行期间产生的事件进入环形缓冲并广播给所有订阅者。前端断线后可通过
 * `resumeAfter` 续传，只把漏掉的事件补回来。
 */

import type { AgentStreamEvent } from "./agentStream.js";
import type { AgentChatInput } from "@knowpilot/shared";

export type BufferedEvent = {
  id: number;
  event: AgentStreamEvent;
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
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

export class SessionStreamHub {
  private runs = new Map<string, RunState>();

  constructor(private maxBufferSize = 2000) {}

  isRunning(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    return !!run && !run.completed;
  }

  getLastEventId(sessionId: string): number {
    return this.runs.get(sessionId)?.nextId ?? 0;
  }

  getStatus(sessionId: string): { running: boolean; lastEventId: number } {
    const run = this.runs.get(sessionId);
    return {
      running: !!run && !run.completed,
      lastEventId: run?.nextId ?? 0,
    };
  }

  /**
   * 启动一次新的 Agent 运行。若该 session 已有运行中的任务，则抛出异常。
   * runner 负责调用 emit 产生事件；signal 由本 Hub 提供，stop() 会触发它。
   */
  start(
    sessionId: string,
    input: AgentChatInput,
    runner: (emit: (event: AgentStreamEvent) => void, signal: AbortSignal) => Promise<void>,
  ): void {
    if (this.isRunning(sessionId)) {
      throw new Error(`会话 ${sessionId} 已有运行中的 Agent 流`);
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
      nextId: 1,
    };
    this.runs.set(sessionId, state);

    const emit = (event: AgentStreamEvent) => {
      if (state.completed) return;
      const buffered: BufferedEvent = { id: state.nextId++, event };
      state.buffer.push(buffered);
      if (state.buffer.length > this.maxBufferSize) {
        state.buffer.shift();
      }
      for (const sub of state.subscribers) {
        try {
          sub(buffered);
        } catch {
          // 单个订阅者失败不打扰其他订阅者
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
        state.cleanupTimer = setTimeout(() => {
          this.runs.delete(sessionId);
        }, 5 * 60 * 1000);
      }
    })();
  }

  /**
   * 订阅指定 session 的事件流。会立即重放 buffer 中 afterEventId 之后的事件。
   * 返回取消订阅函数；取消订阅不会中止运行。
   */
  subscribe(
    sessionId: string,
    afterEventId: number,
    onEvent: (event: BufferedEvent) => void,
  ): () => void {
    const state = this.runs.get(sessionId);
    if (!state) {
      return () => {};
    }

    // 先重放已有事件
    for (const ev of state.buffer) {
      if (ev.id > afterEventId) {
        onEvent(ev);
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

  /**
   * 显式停止某个 session 的运行。返回是否成功触发 abort。
   */
  stop(sessionId: string): boolean {
    const state = this.runs.get(sessionId);
    if (!state || state.completed) return false;
    state.abortController.abort();
    return true;
  }

  /**
   * 强制清理某个 session（主要用于测试或特殊管理）。
   */
  clear(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (state) {
      if (!state.completed) {
        state.abortController.abort();
      }
      if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
      this.runs.delete(sessionId);
    }
  }
}
