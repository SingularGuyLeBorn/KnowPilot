/**
 * 异步 Agent 任务编排 — 全局 / per-session / per-workspace 并发池 + 超时 + 取消 + 事件
 *
 * v8 TP-1/TP-2 全局任务池（容量不变量收在本执行层，不靠各入口自觉）：
 *
 * 1. 全局占用口径（Q2）：`全局占用 = 池内 running + hub 交互 running`。
 *    hub 交互 running = hub 活跃流中未被 occupancy claim 的部分——池内任务起流的会话、
 *    血缘让渡的子会话都在 admit 前 claim，因此不会被双算。
 *    活性：pull 口径只解决「怎么算」，hub 交互流结束经 `onHubRunSettled` 显式通知池
 *    重排（drain 幂等），解决「何时重排」——否则 queued 任务在下一次池事件前无人唤醒。
 * 2. 槽位血缘继承（Q4）：`waitForResult=true` 的子执行视为父槽位让渡——调用方用
 *    `claimOccupancy(子会话)` 把子会话的 hub 流从「交互 running」中剔除，子执行走 inline
 *    不占新槽。不变量一句话：同一血缘同时只有一个执行体占槽。
 * 3. 交付消费高优通道（TP-1）：`runConsumeJob` 插到队首（同类 FIFO），admit 优先级高于
 *    普通排队任务，但仍受全局占用上限约束；`queuedTimeoutMs` 内未获槽则放弃本轮
 *    （resolve false，execute 未运行）——禁止「等槽无限挂起消费链」，delivery 由调用方
 *    原样留待下次触发（不丢）。hub 交互流不依赖池槽位 ⇒ 消费任务等 hub 空闲不会与池
 *    形成循环等待。
 * 4. 准入判定链（drain 时逐条求值，首个命中的上限即排队原因）：
 *    global：`runningGlobal + hubInteractiveRunning >= maxGlobal`
 *    session：`runningBySession[sessionId] >= maxPerSession`
 *    workspace：`maxPerWorkspace > 0 且 runningByWorkspace[workspaceId] >= maxPerWorkspace`
 *    全部通过才 start；queued 记录 reason 供统计与 UI 展示。
 * 5. maxQueued 满则入池拒绝（throw），调用方负责给 LLM/UI 明确错误。
 */

import type { AppConfig } from "./config.js";
import { getStreamHub, onHubRunSettled } from "./sessionStreamHub.js";

/** 排队阻塞原因：哪个上限卡住（queuedByReason 统计与 UI「第 N 位 · 因 X 上限排队」共用） */
export type AsyncJobQueuedReason = "global" | "session" | "workspace";

export interface AsyncJobRunSpec {
  jobId: string;
  sessionId: string;
  /** per-workspace 公平配额维度（maxPerWorkspace > 0 时生效）；缺省/null = 不参与 workspace 配额 */
  workspaceId?: string | null;
  /** 任务级超时毫秒数；未指定时使用 orchestrator 全局超时 */
  timeoutMs?: number;
  /** 排队超时覆盖（毫秒）；未指定时使用全局 queuedTimeoutMs。消费类任务必传（禁止无限等槽） */
  queuedTimeoutMs?: number;
  /** high = 交付消费类任务：插到队首（同类 FIFO），admit 优先级高于普通排队任务 */
  priority?: "normal" | "high";
  /** 附加元数据：当前用于 subagent session 与 AbortController 关联 */
  metadata?: { subagentSessionId?: string };
  /** 排队期被移出队列（超时/取消）且未获槽时回调——消费通道据此放弃本轮 */
  onQueuedDrop?: () => void;
  execute: (signal: AbortSignal) => Promise<void>;
}

interface QueuedItem {
  spec: AsyncJobRunSpec;
  reason: AsyncJobQueuedReason;
}

interface RunningJob {
  spec: AsyncJobRunSpec;
  controller: AbortController;
  startedAt: number;
}

/** 交付消费任务缺省等槽时长：config queuedTimeoutMs = 0（不限）时的兜底，禁止无限等槽 */
export const DEFAULT_CONSUME_QUEUED_TIMEOUT_MS = 30_000;

/** 消费续跑的有效等槽时长：config > 0 用 config，否则兜底 30s */
export function consumeQueuedTimeoutMs(config: AppConfig): number {
  const configured = config.asyncJobs.queuedTimeoutMs;
  return configured > 0 ? configured : DEFAULT_CONSUME_QUEUED_TIMEOUT_MS;
}

type AsyncJobEventType = "queued" | "started" | "completed" | "cancelled" | "failed" | "timeout";
type AsyncJobEventListener = (event: { type: AsyncJobEventType; jobId: string; sessionId: string }) => void;

export class AsyncJobOrchestrator {
  private readonly queue: QueuedItem[] = [];
  private runningGlobal = 0;
  private readonly runningBySession = new Map<string, number>();
  private readonly runningByWorkspace = new Map<string, number>();
  private readonly runningJobs = new Map<string, RunningJob>();
  /** subagentSessionId -> AbortController，用于 session.stop 真正中断运行中任务 */
  private readonly subagentControllers = new Map<string, AbortController>();
  private readonly listeners = new Set<AsyncJobEventListener>();
  /** 排队超时句柄：jobId -> timeout */
  private readonly queuedTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * 占用认领（sessionId -> refcount）：被 claim 的会话，其 hub 流不计入「hub 交互 running」。
   * 两类调用方：池内任务起流前 claim（不双算）、血缘让渡 inline 执行 claim（Q4 不占新槽）。
   */
  private readonly occupancyClaims = new Map<string, number>();
  /** Q2 只读统计源：返回 hub 当前活跃流的 sessionId 列表（不允许 hub 反向依赖池） */
  private hubRunningSessionsProvider: (() => string[]) | null = null;
  private readonly maxPerWorkspace: number;
  private readonly maxQueued: number;

  constructor(
    private readonly limits: {
      maxGlobal: number;
      maxPerSession: number;
      /** 0 = 不限（公平策略，不是容量权威） */
      maxPerWorkspace?: number;
      /** 排队总数上限，满则入池拒绝 */
      maxQueued?: number;
      taskTimeoutMs: number;
      queuedTimeoutMs?: number;
    },
  ) {
    this.maxPerWorkspace = Math.max(0, limits.maxPerWorkspace ?? 0);
    this.maxQueued = Math.max(1, limits.maxQueued ?? 100);
  }

  /** 生命周期事件：解耦状态统计、SSE 推送与调度逻辑；listener 抛错不阻塞编排。 */
  on(event: AsyncJobEventType, listener: AsyncJobEventListener): () => void {
    const wrapper: AsyncJobEventListener = (ev) => {
      if (ev.type === event) listener(ev);
    };
    this.listeners.add(wrapper);
    return () => this.listeners.delete(wrapper);
  }

  /** 订阅所有事件（用于日志/调试） */
  onAny(listener: AsyncJobEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: { type: AsyncJobEventType; jobId: string; sessionId: string }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* 事件监听失败不阻塞编排 */
      }
    }
  }

  /** 注册 hub 活跃流只读统计源（server 启动时接线；测试可注入自定义源） */
  setHubRunningSessionsProvider(provider: (() => string[]) | null): void {
    this.hubRunningSessionsProvider = provider;
  }

  /**
   * 占用认领：claim 期间该会话的 hub 流不计入「hub 交互 running」（Q2 不双算 / Q4 血缘让渡）。
   * 返回幂等 release（必须在执行体结束处调用，泄漏会导致全局占用被低估——保守方向，可观测）。
   * refcount：嵌套 claim（父池任务 + 子血缘）各自 release，互不误伤。
   */
  claimOccupancy(sessionId: string): () => void {
    this.occupancyClaims.set(sessionId, (this.occupancyClaims.get(sessionId) ?? 0) + 1);
    // claim 改变准入判定（交互 running 减少）→ 立即重新调度
    this.drain();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.occupancyClaims.get(sessionId) ?? 1) - 1;
      if (left <= 0) this.occupancyClaims.delete(sessionId);
      else this.occupancyClaims.set(sessionId, left);
      this.drain();
    };
  }

  isOccupancyClaimed(sessionId: string): boolean {
    return this.occupancyClaims.has(sessionId);
  }

  /** Q2 口径：hub 交互 running = hub 活跃流中未被 occupancy claim 的部分 */
  private hubInteractiveRunning(): number {
    if (!this.hubRunningSessionsProvider) return 0;
    let sessions: string[];
    try {
      sessions = this.hubRunningSessionsProvider();
    } catch {
      return 0;
    }
    let n = 0;
    for (const sessionId of sessions) {
      if (!this.occupancyClaims.has(sessionId)) n++;
    }
    return n;
  }

  /** 准入判定链：返回首个卡住的上限；null = 可 start。判定只读，drain 串行调用 */
  private blockReason(spec: AsyncJobRunSpec): AsyncJobQueuedReason | null {
    if (this.runningGlobal + this.hubInteractiveRunning() >= this.limits.maxGlobal) return "global";
    if ((this.runningBySession.get(spec.sessionId) ?? 0) >= this.limits.maxPerSession) return "session";
    if (
      this.maxPerWorkspace > 0 &&
      spec.workspaceId &&
      (this.runningByWorkspace.get(spec.workspaceId) ?? 0) >= this.maxPerWorkspace
    ) {
      return "workspace";
    }
    return null;
  }

  /** 入队；有并发槽位时立即执行。maxQueued 满则拒绝（throw，调用方给 LLM/UI 明确错误） */
  enqueue(spec: AsyncJobRunSpec): void {
    if (this.queue.length >= this.maxQueued) {
      throw new Error(`任务池队列已满（maxQueued=${this.maxQueued}），请稍后再派。`);
    }
    const item: QueuedItem = { spec, reason: this.blockReason(spec) ?? "global" };
    if (spec.priority === "high") {
      // 高优通道：插到队首（同类 FIFO），admit 优先级高于普通排队任务
      let idx = 0;
      while (idx < this.queue.length && this.queue[idx].spec.priority === "high") idx++;
      this.queue.splice(idx, 0, item);
    } else {
      this.queue.push(item);
    }
    this.emit({ type: "queued", jobId: spec.jobId, sessionId: spec.sessionId });

    const queuedTimeoutMs = spec.queuedTimeoutMs ?? this.limits.queuedTimeoutMs ?? 0;
    if (queuedTimeoutMs > 0) {
      this.queuedTimeouts.set(
        spec.jobId,
        setTimeout(() => {
          const idx = this.queue.findIndex((q) => q.spec.jobId === spec.jobId);
          this.queuedTimeouts.delete(spec.jobId);
          if (idx >= 0) {
            const [dropped] = this.queue.splice(idx, 1);
            this.emit({ type: "timeout", jobId: spec.jobId, sessionId: spec.sessionId });
            dropped.spec.onQueuedDrop?.();
          }
        }, queuedTimeoutMs),
      );
    }

    this.drain();
  }

  /**
   * 交付消费高优通道（TP-1 续跑消费专用）：插到队首 + 受全局占用上限约束。
   * resolve true  = 已获槽且 execute 执行完毕（槽位已随池 finally 释放）；
   * resolve false = queuedTimeoutMs 内未获槽 / 队列满 / 排队期被取消（execute 未运行）——
   *                调用方把 delivery 原样留待下次触发（不丢），禁止等槽无限挂起消费链。
   */
  runConsumeJob(spec: {
    jobId: string;
    sessionId: string;
    workspaceId?: string | null;
    queuedTimeoutMs: number;
    execute: (signal: AbortSignal) => Promise<void>;
  }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        this.enqueue({
          jobId: spec.jobId,
          sessionId: spec.sessionId,
          workspaceId: spec.workspaceId,
          priority: "high",
          queuedTimeoutMs: spec.queuedTimeoutMs,
          onQueuedDrop: () => resolve(false),
          execute: async (signal) => {
            try {
              await spec.execute(signal);
            } finally {
              resolve(true);
            }
          },
        });
      } catch {
        // maxQueued 满：等同超时放弃——不丢 delivery，留待下次触发
        resolve(false);
      }
    });
  }

  getStats() {
    const runningByWorkspace: Record<string, number> = {};
    for (const [k, v] of this.runningByWorkspace) runningByWorkspace[k] = v;
    const queuedByReason: Record<AsyncJobQueuedReason, number> = { global: 0, session: 0, workspace: 0 };
    for (const item of this.queue) queuedByReason[item.reason]++;
    return {
      queued: this.queue.length,
      runningGlobal: this.runningGlobal,
      runningByWorkspace,
      queuedByReason,
      hubInteractiveRunning: this.hubInteractiveRunning(),
      limits: {
        ...this.limits,
        maxPerWorkspace: this.maxPerWorkspace,
        maxQueued: this.maxQueued,
      },
    };
  }

  /** 获取任务在当前队列中的位置（0-based，运行中为 -1，不在队列中为 undefined） */
  getPosition(jobId: string): number | undefined {
    const idx = this.queue.findIndex((q) => q.spec.jobId === jobId);
    return idx >= 0 ? idx : undefined;
  }

  /** 排队任务的阻塞原因（哪个上限卡住）；不在队列中为 undefined */
  getQueuedReason(jobId: string): AsyncJobQueuedReason | undefined {
    return this.queue.find((q) => q.spec.jobId === jobId)?.reason;
  }

  /** cancel 幂等：运行中 abort 信号；排队中移出队列并触发 cancelled 事件。同一 jobId 多次调用无副作用。 */
  cancel(jobId: string): boolean {
    const running = this.runningJobs.get(jobId);
    if (running) {
      running.controller.abort();
      return true;
    }
    const idx = this.queue.findIndex((q) => q.spec.jobId === jobId);
    if (idx >= 0) {
      const [dropped] = this.queue.splice(idx, 1);
      this.clearQueuedTimeout(jobId);
      this.emit({ type: "cancelled", jobId, sessionId: dropped.spec.sessionId });
      dropped.spec.onQueuedDrop?.();
      return true;
    }
    return false;
  }

  /** subagent session 停止必须同时清掉 orchestrator 槽位与 subagentControllers，否则 signal 中断不到后台任务。
   *  返回 stopped=是否命中、wasRunning=是否正在执行（否则为排队中）、jobId=关联任务 ID（用于回写 Task 状态）。 */
  stopSubagent(subagentSessionId: string): { stopped: boolean; wasRunning: boolean; jobId?: string } {
    const controller = this.subagentControllers.get(subagentSessionId);
    if (controller) {
      const running = [...this.runningJobs.entries()].find(([, r]) => r.controller === controller);
      controller.abort();
      this.subagentControllers.delete(subagentSessionId);
      return { stopped: true, wasRunning: true, jobId: running?.[0] };
    }
    const idx = this.queue.findIndex((q) => q.spec.metadata?.subagentSessionId === subagentSessionId);
    if (idx >= 0) {
      const [dropped] = this.queue.splice(idx, 1);
      this.clearQueuedTimeout(dropped.spec.jobId);
      this.emit({ type: "cancelled", jobId: dropped.spec.jobId, sessionId: dropped.spec.sessionId });
      dropped.spec.onQueuedDrop?.();
      return { stopped: true, wasRunning: false, jobId: dropped.spec.jobId };
    }
    return { stopped: false, wasRunning: false };
  }

  /** 判定 jobId 是否已获槽并正在执行（只看 runningJobs，不看 queued）。 */
  isRunning(jobId: string): boolean {
    return this.runningJobs.has(jobId);
  }

  /** 外部事件触发的重新调度（如 hub 交互流结束）。drain 幂等：无可 admit 项时无副作用。 */
  reevaluateQueue(): void {
    this.drain();
  }

  /** 判定 jobId 是否仍在排队（未获槽）。running 与 queued 互斥。 */
  isQueued(jobId: string): boolean {
    return this.queue.some((q) => q.spec.jobId === jobId);
  }

  private clearQueuedTimeout(jobId: string): void {
    const t = this.queuedTimeouts.get(jobId);
    if (t) {
      clearTimeout(t);
      this.queuedTimeouts.delete(jobId);
    }
  }

  /** 调度排水口：容量变化/新任务/占用释放/hub 流结束时触发；逐项 admit 直到 blockReason 命中。幂等。 */
  private drain(): void {
    let i = 0;
    while (i < this.queue.length) {
      const item = this.queue[i];
      const reason = this.blockReason(item.spec);
      if (reason) {
        // reason 记录「入队时首个卡住的上限」，不随容量变化改写（口径稳定，UI/统计可解释）
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this.clearQueuedTimeout(item.spec.jobId);
      this.start(item.spec);
    }
  }

  /** 获槽启动：增加全局/会话/工作区计数，execute 在 AbortSignal 下运行；finally 必须释放计数并再次 drain。 */
  private start(spec: AsyncJobRunSpec): void {
    const controller = new AbortController();
    this.runningGlobal++;
    this.runningBySession.set(spec.sessionId, (this.runningBySession.get(spec.sessionId) ?? 0) + 1);
    if (spec.workspaceId) {
      this.runningByWorkspace.set(spec.workspaceId, (this.runningByWorkspace.get(spec.workspaceId) ?? 0) + 1);
    }
    this.runningJobs.set(spec.jobId, { spec, controller, startedAt: Date.now() });
    if (spec.metadata?.subagentSessionId) {
      this.subagentControllers.set(spec.metadata.subagentSessionId, controller);
    }
    this.emit({ type: "started", jobId: spec.jobId, sessionId: spec.sessionId });

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
        if (spec.workspaceId) {
          const wsLeft = (this.runningByWorkspace.get(spec.workspaceId) ?? 1) - 1;
          if (wsLeft <= 0) this.runningByWorkspace.delete(spec.workspaceId);
          else this.runningByWorkspace.set(spec.workspaceId, wsLeft);
        }
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
      maxPerWorkspace: Math.max(0, config.asyncJobs.maxPerWorkspace),
      maxQueued: Math.max(1, config.asyncJobs.maxQueued),
      taskTimeoutMs: config.asyncJobs.taskTimeoutMs,
      queuedTimeoutMs: config.asyncJobs.queuedTimeoutMs,
    });
    // Q2 口径接线：hub 提供活跃流只读统计（hub 不反向依赖池）；
    // 读取发生在 admit 判定时刻，hub 后注册（setStreamHub）也能正确计数。
    _orchestrator.setHubRunningSessionsProvider(
      () => getStreamHub()?.listRunning().map((r) => r.sessionId) ?? [],
    );
  }
  wireHubSettledOnce();
  return _orchestrator;
}

/**
 * Q2 活性接线：hub 交互流结束 → 池重新调度（drain 幂等，重复触发无副作用）。
 * pull 口径只解决「怎么算占用」，不解决「何时重排」——没有本钩子，交互流结束后
 * queued 任务要等下一次池事件才被唤醒（TP-4 Q2 压测暴露）。
 * 闭包读模块级 _orchestrator（延迟绑定）：reset 重建实例后无需重接线。
 */
let _hubSettleWired = false;
function wireHubSettledOnce(): void {
  if (_hubSettleWired) return;
  _hubSettleWired = true;
  onHubRunSettled(() => {
    _orchestrator?.reevaluateQueue();
  });
}

/** 单测重置全局 orchestrator 单例与 hub settled 接线（状态清零，避免测试污染）。 */
export function resetAsyncJobOrchestratorForTests(): void {
  _orchestrator = null;
}
