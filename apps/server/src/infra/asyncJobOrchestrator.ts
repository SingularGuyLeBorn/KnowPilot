/**
 * 异步 Agent 任务编排 — 全局 / per-session 并发池 + 超时 + 取消
 */

import type { AppConfig } from "./config.js";

export interface AsyncJobRunSpec {
  jobId: string;
  sessionId: string;
  /** 任务级超时毫秒数；未指定时使用 orchestrator 全局超时 */
  timeoutMs?: number;
  /** 附加元数据：当前用于 subagent session 与 AbortController 关联 */
  metadata?: { subagentSessionId?: string };
  execute: (signal: AbortSignal) => Promise<void>;
}

interface RunningJob {
  spec: AsyncJobRunSpec;
  controller: AbortController;
  startedAt: number;
}

export class AsyncJobOrchestrator {
  private readonly queue: AsyncJobRunSpec[] = [];
  private runningGlobal = 0;
  private readonly runningBySession = new Map<string, number>();
  private readonly runningJobs = new Map<string, RunningJob>();
  /** subagentSessionId -> AbortController，用于 session.stop 真正中断运行中任务 */
  private readonly subagentControllers = new Map<string, AbortController>();

  constructor(
    private readonly limits: { maxGlobal: number; maxPerSession: number; taskTimeoutMs: number },
  ) {}

  /** 入队；有并发槽位时立即执行 */
  enqueue(spec: AsyncJobRunSpec): void {
    this.queue.push(spec);
    this.drain();
  }

  getStats() {
    return {
      queued: this.queue.length,
      runningGlobal: this.runningGlobal,
      limits: this.limits,
    };
  }

  /** 取消一条运行中的任务；若未运行则忽略 */
  cancel(jobId: string): boolean {
    const running = this.runningJobs.get(jobId);
    if (running) {
      running.controller.abort();
      return true;
    }
    const idx = this.queue.findIndex((s) => s.jobId === jobId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** 根据 subagent sessionId 中断其后台任务 */
  stopSubagent(subagentSessionId: string): boolean {
    const controller = this.subagentControllers.get(subagentSessionId);
    if (controller) {
      controller.abort();
      this.subagentControllers.delete(subagentSessionId);
      return true;
    }
    const idx = this.queue.findIndex((s) => s.metadata?.subagentSessionId === subagentSessionId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** 任务是否正在执行 */
  isRunning(jobId: string): boolean {
    return this.runningJobs.has(jobId);
  }

  /** 任务是否在队列等待槽位 */
  isQueued(jobId: string): boolean {
    return this.queue.some((s) => s.jobId === jobId);
  }

  private canStart(sessionId: string): boolean {
    if (this.runningGlobal >= this.limits.maxGlobal) return false;
    return (this.runningBySession.get(sessionId) ?? 0) < this.limits.maxPerSession;
  }

  private drain(): void {
    let i = 0;
    while (i < this.queue.length) {
      const spec = this.queue[i];
      if (!this.canStart(spec.sessionId)) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.start(spec);
    }
  }

  private start(spec: AsyncJobRunSpec): void {
    const controller = new AbortController();
    this.runningGlobal++;
    this.runningBySession.set(spec.sessionId, (this.runningBySession.get(spec.sessionId) ?? 0) + 1);
    this.runningJobs.set(spec.jobId, { spec, controller, startedAt: Date.now() });
    if (spec.metadata?.subagentSessionId) {
      this.subagentControllers.set(spec.metadata.subagentSessionId, controller);
    }

    const timeoutMs = spec.timeoutMs ?? this.limits.taskTimeoutMs;
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const execute = spec.execute(controller.signal);
    void execute
      .catch(() => {
        /* 执行者内部已捕获并更新 Task 状态；这里只需保证 finally 走通 */
      })
      .finally(() => {
        clearTimeout(timeout);
        if (spec.metadata?.subagentSessionId) {
          this.subagentControllers.delete(spec.metadata.subagentSessionId);
        }
        this.runningJobs.delete(spec.jobId);
        this.runningGlobal = Math.max(0, this.runningGlobal - 1);
        const left = (this.runningBySession.get(spec.sessionId) ?? 1) - 1;
        if (left <= 0) this.runningBySession.delete(spec.sessionId);
        else this.runningBySession.set(spec.sessionId, left);
        this.drain();
      });
  }
}

let _orchestrator: AsyncJobOrchestrator | null = null;

export function getAsyncJobOrchestrator(config: AppConfig): AsyncJobOrchestrator {
  if (!_orchestrator) {
    _orchestrator = new AsyncJobOrchestrator({
      maxGlobal: Math.max(1, config.asyncJobs.maxConcurrent),
      maxPerSession: Math.max(1, config.asyncJobs.maxPerSession),
      taskTimeoutMs: config.asyncJobs.taskTimeoutMs,
    });
  }
  return _orchestrator;
}

/** 单测重置 */
export function resetAsyncJobOrchestratorForTests(): void {
  _orchestrator = null;
}
