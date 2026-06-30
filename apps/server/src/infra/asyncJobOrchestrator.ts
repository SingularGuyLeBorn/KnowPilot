/**
 * 异步 Agent 任务编排 — 全局 /  per-session 并发池（MetaBlog 式后台任务中间层）
 */

import type { AppConfig } from "./config.js";

export interface AsyncJobRunSpec {
  jobId: string;
  sessionId: string;
  execute: () => Promise<void>;
}

export class AsyncJobOrchestrator {
  private readonly queue: AsyncJobRunSpec[] = [];
  private runningGlobal = 0;
  private readonly runningBySession = new Map<string, number>();

  constructor(
    private readonly limits: { maxGlobal: number; maxPerSession: number },
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
    this.runningGlobal++;
    this.runningBySession.set(spec.sessionId, (this.runningBySession.get(spec.sessionId) ?? 0) + 1);
    void spec.execute().finally(() => {
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
    });
  }
  return _orchestrator;
}

/** 单测重置 */
export function resetAsyncJobOrchestratorForTests(): void {
  _orchestrator = null;
}
