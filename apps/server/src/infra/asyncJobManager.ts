/**
 * 异步 Agent 任务 — 后台执行，完成后投递到会话队列（MetaBlog 风格）
 * 持久化到 Task 表；执行由 asyncJobOrchestrator 限流调度
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { runAgentLoop } from "./agentRuntime.js";
import { runAgentLoopStream, chatAgentStream, type AgentStreamEvent } from "./agentStream.js";
import {
  parseAgentTools,
  buildAgentToolSchemas,
  executeToolCallsBatch,
  createAgentToolContext,
  type ToolRegistryEntry,
} from "./agentTools.js";
import type { LlmToolCall } from "./llmClient.js";
import { getStreamHub } from "./sessionStreamHub.js";
import type { StoredToolCall } from "./chatHistory.js";
import { waitMs } from "./shellRunner.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { prisma } from "../db.js";
import { getAsyncJobOrchestrator } from "./asyncJobOrchestrator.js";
import { getSwarmOrchestrator, type SwarmTaskSpec } from "./swarmOrchestrator.js";
import { assertLlmBudget } from "./llmBudget.js";
import { getAllowedToolsForTier } from "./swarmPermissionGuard.js";
import { markAgentMessageDeliveredByTaskRef } from "./agentMessageLedger.js";

export interface AsyncTaskLogEntry {
  timestamp: number;
  level: "info" | "progress" | "error";
  message: string;
}

export interface AsyncQueueDelivery {
  id: string;
  jobId: string;
  sessionId: string;
  taskLabel: string;
  asyncResult: string;
  status: "done" | "failed";
  error?: string;
  subagentSessionId?: string;
  subagentName?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  /** pinned 的结果不被自动 CLAIM，仅供前端展示 */
  pinned?: boolean;
  sourceType?: AsyncTaskSourceType;
}

export interface AsyncRunningJob {
  jobId: string;
  sessionId: string;
  taskLabel: string;
  status: "running";
  subagentSessionId?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  sourceType?: AsyncTaskSourceType;
}

const ASYNC_KIND = "async_agent";

export type AsyncTaskSourceType = "async_task_llm" | "async_task_tool" | "subagent" | "sleep";

interface AsyncTaskInput {
  kind: typeof ASYNC_KIND;
  sessionId: string;
  task: string;
  taskLabel: string;
  agentSnapshot: { id: string; model: string; systemPrompt: string; tools: string[]; tier?: string; parentId?: string | null; workspaceId?: string | null; name?: string | null };
  retryCount?: number;
  timeoutMs?: number;
  subagentSessionId?: string;
  /** 任务来源类型（替代旧 isSubagent 布尔值，便于 UI 区分与后续扩展） */
  sourceType?: AsyncTaskSourceType;
  /** 纯工具异步任务时指定的一次性工具调用 */
  toolCall?: { tool: string; args: Record<string, unknown> };
  /** swarm 协作：任务结果额外广播到这些会话（共享给其他父会话） */
  shareToSessionIds?: string[];
  /**
   * 是否投递到会话异步队列并由服务端自动消费续跑。
   * waitForResult=true 时应为 false（结果已作为工具返回值，避免二次喂给 Agent）。
   * 默认 true。
   */
  deliverToQueue?: boolean;
}

interface AsyncTaskOutput {
  asyncResult?: string;
  error?: string;
  /** 任务 token 消耗（纳入 LLM 预算闭环，便于审计） */
  tokenUsage?: { prompt: number; completion: number; total: number };
  /** 执行过程中产生的进度/日志，供前端进度条与 LLM 状态查询使用 */
  logs?: AsyncTaskLogEntry[];
}

function parseAsyncInput(raw: unknown): AsyncTaskInput | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const o = value as AsyncTaskInput;
  if (o.kind !== ASYNC_KIND || typeof o.sessionId !== "string") return null;
  return o;
}

function parseAsyncOutput(raw: unknown): AsyncTaskOutput {
  if (typeof raw === "string") {
    try {
      return (JSON.parse(raw) ?? {}) as AsyncTaskOutput;
    } catch {
      return { asyncResult: raw };
    }
  }
  return (raw ?? {}) as AsyncTaskOutput;
}

function toDelivery(task: {
  id: string;
  input: unknown;
  output: unknown;
  status: string;
  createdAt: Date;
  pinned?: number | boolean;
}): AsyncQueueDelivery | null {
  const input = parseAsyncInput(task.input);
  if (!input) return null;
  const output = parseAsyncOutput(task.output);
  const failed = task.status === "failed";
  const pinned = task.pinned === true || task.pinned === 1;
  return {
    id: `del-${task.id}`,
    jobId: task.id,
    sessionId: input.sessionId,
    taskLabel: input.taskLabel,
    asyncResult: failed ? "" : output.asyncResult || "(无文本输出)",
    status: failed ? "failed" : "done",
    error: output.error,
    subagentSessionId: input.subagentSessionId,
    subagentName: input.agentSnapshot?.name ?? undefined,
    logs: output.logs,
    createdAt: task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime(),
    pinned,
    sourceType: input.sourceType,
  };
}

/** 同一 session 的自动续跑串行化，避免多条 delivery 并发双跑 */
const sessionAutoConsumeChains = new Map<string, Promise<void>>();

function enqueueSessionAutoConsume(sessionId: string, work: () => Promise<void>): void {
  const prev = sessionAutoConsumeChains.get(sessionId) ?? Promise.resolve();
  const next = prev.then(work, work).finally(() => {
    if (sessionAutoConsumeChains.get(sessionId) === next) {
      sessionAutoConsumeChains.delete(sessionId);
    }
  });
  sessionAutoConsumeChains.set(sessionId, next);
}

/**
 * 服务端自动消费异步结果：CLAIM → 注入消息 → 启动 Agent 续跑。
 * 不依赖前端是否打开该 session；与前端 consumeQueue 通过原子 CLAIM 竞态，先到者执行。
 */
export async function autoConsumeAsyncDelivery(options: {
  sessionId: string;
  jobId: string;
  status: "done" | "failed";
  taskLabel: string;
  services: ServiceContainer;
  config: AppConfig;
}): Promise<"skipped" | "started"> {
  const { sessionId, jobId, status, taskLabel, services, config } = options;

  const task = await prisma.task.findUnique({ where: { id: jobId } });
  if (!task) return "skipped";
  if (task.delivered || task.pinned) return "skipped";
  if (task.status !== "success" && task.status !== "failed") return "skipped";

  const input = parseAsyncInput(task.input);
  if (input?.deliverToQueue === false) return "skipped";

  const hub = getStreamHub();
  if (!hub) return "skipped";

  let session: { agentId?: string | null; status?: string | null; parentSessionId?: string | null; kind?: string | null } | null = null;
  try {
    session = await services.session.getByIdLite(sessionId);
  } catch {
    return "skipped";
  }
  if (!session?.agentId || session.status === "archived" || session.status === "deleted") {
    return "skipped";
  }

  // W14：原子 CLAIM 与 AgentMessage 投递记账（delivered）同事务——认领成功即完成对账，
  // 不存在「Task 已 delivered 但旁路邮箱仍 pending」的中间态。记账按 taskRef=jobId 幂等。
  const claimed = await prisma.$transaction(async (tx) => {
    const c = await tx.task.updateMany({
      where: { id: jobId, delivered: false, pinned: false },
      data: { delivered: true, deliveredAt: new Date() },
    });
    if (c.count > 0) {
      await markAgentMessageDeliveredByTaskRef(tx, jobId);
    }
    return c;
  });
  if (claimed.count === 0) return "skipped";

  const output = parseAsyncOutput(task.output);
  const failed = status === "failed" || task.status === "failed";
  const message = failed
    ? `任务失败：${output.error || "未知错误"}`
    : output.asyncResult || "(无文本输出)";

  // 子任务会话（有 parentSessionId）上的异步续跑视为任务血统，允许 report_back
  const runOrigin =
    session.parentSessionId || session.kind === "subagent" || input?.sourceType === "sleep"
      ? ("parent" as const)
      : ("user" as const);

  const body = {
    sessionId,
    agentId: session.agentId as string,
    message,
    source: "sub" as const,
    runOrigin,
    toolResults: {
      subagentResult: {
        jobId,
        subagentSessionId: input?.subagentSessionId,
        subagentName: input?.agentSnapshot?.name ?? taskLabel,
        sourceType: input?.sourceType ?? "async_task_llm",
        taskLabel,
      },
    },
  };

  const invokeTrpc = createTrpcInvoker({ services });

  enqueueSessionAutoConsume(sessionId, async () => {
    try {
      if (hub.isRunning(sessionId)) {
        await hub.waitFor(sessionId);
      }
      const started = await hub.startIfNotRunning(sessionId, body, (emit, signal) =>
        chatAgentStream(services, config, body, invokeTrpc, emit, signal),
      );
      if (started) {
        hub.pushExternalEvent(sessionId, {
          type: "session_run_started",
          sessionId,
          reason: "async_auto_consume",
          jobId,
        });
      }
    } catch (err) {
      console.warn(`[asyncJobManager] autoConsume 续跑失败 session=${sessionId} job=${jobId}:`, err);
    }
  });

  return "started";
}

/** 推送 async_delivery 事件，并在有 services/config 时触发服务端自动消费续跑 */
async function notifyAsyncDelivery(
  sessionId: string,
  jobId: string,
  status: "done" | "failed",
  taskLabel: string,
  services?: ServiceContainer,
  config?: AppConfig,
): Promise<void> {
  try {
    const hub = getStreamHub();
    if (hub) {
      hub.pushExternalEvent(sessionId, {
        type: "async_delivery",
        sessionId,
        jobId,
        status,
        taskLabel,
      });
    }
  } catch (err) {
    console.warn(`[asyncJobManager] notifyAsyncDelivery 失败:`, err);
  }

  if (services && config) {
    void autoConsumeAsyncDelivery({ sessionId, jobId, status, taskLabel, services, config }).catch((err) => {
      console.warn(`[asyncJobManager] autoConsumeAsyncDelivery 失败:`, err);
    });
  }
}

/** 供 report_back 等外部路径：推送 + 自动消费（与 finalizeSuccess 同源） */
export async function notifyAndAutoConsumeAsyncDelivery(options: {
  sessionId: string;
  jobId: string;
  status: "done" | "failed";
  taskLabel: string;
  services: ServiceContainer;
  config: AppConfig;
}): Promise<void> {
  await notifyAsyncDelivery(
    options.sessionId,
    options.jobId,
    options.status,
    options.taskLabel,
    options.services,
    options.config,
  );
}

/** 推送子会话状态变更到父会话 SSE */
export async function notifySubagentSessionUpdate(params: {
  parentSessionId: string;
  subagentSessionId: string;
  status: string;
  title?: string;
  agentId?: string | null;
}): Promise<void> {
  try {
    const { getStreamHub } = await import("./sessionStreamHub.js");
    const hub = getStreamHub();
    if (!hub) return;
    hub.pushExternalEvent(params.parentSessionId, {
      type: "subagent_session_update",
      parentSessionId: params.parentSessionId,
      subagentSessionId: params.subagentSessionId,
      status: params.status,
      title: params.title,
      agentId: params.agentId,
    });
  } catch (err) {
    console.warn(`[asyncJobManager] notifySubagentSessionUpdate 失败:`, err);
  }
}

let _asyncPushWired = false;

/**
 * 将 AsyncJobOrchestrator 生命周期事件桥接到 SessionStreamHub（推优先）。
 * 幂等：进程内只注册一次。
 */
export function wireAsyncJobPush(config: AppConfig): void {
  if (_asyncPushWired) return;
  _asyncPushWired = true;
  const orchestrator = getAsyncJobOrchestrator(config);
  orchestrator.onAny((ev) => {
    void (async () => {
      try {
        const { getStreamHub } = await import("./sessionStreamHub.js");
        const hub = getStreamHub();
        if (!hub) return;
        const statusMap = {
          queued: "queued",
          started: "running",
          completed: "done",
          cancelled: "cancelled",
          failed: "failed",
          timeout: "failed",
        } as const;
        const stats = getAsyncQueueStats(config);
        hub.pushExternalEvent(ev.sessionId, {
          type: "async_job_update",
          sessionId: ev.sessionId,
          jobId: ev.jobId,
          status: statusMap[ev.type],
          stats,
        });
      } catch (err) {
        console.warn(`[asyncJobManager] async_job_update 推送失败:`, err);
      }
    })();
  });
}

/** 单测重置推送接线标志 */
export function resetAsyncJobPushWireForTests(): void {
  _asyncPushWired = false;
}

/**
 * W11：服务启动时将遗留 running 的 Run 标为 interrupted（与 recoverStaleAsyncJobs 同款机制）。
 * 如实声明不假装能续跑——运行中的 ReAct 状态随进程丢失，完整 checkpoint 重建另立设计。
 */
export async function recoverStaleRuns(): Promise<number> {
  const result = await prisma.run.updateMany({
    where: { status: "running" },
    data: { status: "interrupted" },
  });
  return result.count;
}

/** 服务启动时：将遗留 async_agent running/queued 任务标为 failed，并同步其 subagent ChatSession 状态 */
export async function recoverStaleAsyncJobs(): Promise<number> {
  const stale = await prisma.task.findMany({
    where: {
      status: { in: ["running", "queued"] },
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
    },
  });
  let count = 0;
  for (const task of stale) {
    const input = parseAsyncInput(task.input);
    if (!input) continue;
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        output: { error: "服务重启，后台任务已中断" },
      },
    });
    // 同步 subagent ChatSession 状态为 failed（避免卡片永久停在 running/queued）
    if (input.subagentSessionId) {
      try {
        await prisma.chatSession.update({
          where: { id: input.subagentSessionId },
          data: { status: "failed" },
        });
      } catch {
        // subagent session 可能已删除，忽略
      }
    }
    count++;
  }
  return count;
}

/** 清理已投递且过期的异步任务，防止 Task 表无限膨胀（默认保留 7 天） */
export async function cleanupDeliveredAsyncJobs(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const before = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.task.deleteMany({
    where: {
      name: { startsWith: "[async]" },
      delivered: true,
      deliveredAt: { lt: before },
    },
  });
  return count;
}

/** 拉取未投递的异步结果（不 CLAIM）。消费时再 markAsyncDeliveryConsumed。
 *  pinned 的结果也会返回，供前端展示，但 consumeQueue 会跳过。 */
export async function pullAsyncDeliveries(sessionId: string): Promise<AsyncQueueDelivery[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      input: unknown;
      output: unknown;
      status: string;
      createdAt: Date;
      pinned: number;
    }>
  >`
    SELECT id, input, output, status, createdAt, pinned
    FROM "Task"
    WHERE sessionId = ${sessionId}
      AND (name LIKE '[async]%' OR type = 'async_agent')
      AND status IN ('success', 'failed')
      AND delivered = 0
    ORDER BY createdAt ASC
  `;

  const deliveries: AsyncQueueDelivery[] = [];
  for (const row of rows) {
    // 同步任务（deliverToQueue=false）结果走 tool return，永不进异步队列；
    // 修窗口漏洞：sync 任务完成落库到 tool return 标 delivered 之间会被误拉进队列
    if (parseAsyncInput(row.input)?.deliverToQueue === false) continue;
    const delivery = toDelivery(row);
    if (delivery) deliveries.push(delivery);
  }
  return deliveries;
}

/** 拉取已消费的异步结果（供右侧「已消费」标签追溯，默认最近 30 条） */
export async function pullConsumedAsyncDeliveries(
  sessionId: string,
  limit = 30,
): Promise<AsyncQueueDelivery[]> {
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      delivered: true,
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
      status: { in: ["success", "failed"] },
    },
    orderBy: { deliveredAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
  });
  const deliveries: AsyncQueueDelivery[] = [];
  for (const row of rows) {
    // 同步任务（deliverToQueue=false）在 tool return 时被标 delivered=true，不属于「已消费」
    if (parseAsyncInput(row.input)?.deliverToQueue === false) continue;
    const delivery = toDelivery(row);
    if (delivery) deliveries.push(delivery);
  }
  return deliveries;
}

/** 消费时标记异步结果已投递（CLAIM）。返回是否成功抢到（与服务端 autoConsume 竞态）。pinned 不可 CLAIM。 */
export async function markAsyncDeliveryConsumed(jobId: string): Promise<boolean> {
  // W14：前端认领路径与服务端 autoConsume 是同一条 Task 管道的两个竞态认领方，
  // delivered 记账必须同样落在 CLAIM 事务里，否则前端抢到 claim 时旁路邮箱又会残留 pending。
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.task.updateMany({
      where: { id: jobId, delivered: false, pinned: false },
      data: { delivered: true, deliveredAt: new Date() },
    });
    if (r.count > 0) {
      await markAgentMessageDeliveredByTaskRef(tx, jobId);
    }
    return r;
  });
  return result.count > 0;
}

export async function listRunningAsyncJobs(sessionId: string): Promise<AsyncRunningJob[]> {
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      status: "running",
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
    },
    orderBy: { createdAt: "desc" },
  });
  return rows
    .map((row): AsyncRunningJob | null => {
      const input = parseAsyncInput(row.input);
      if (!input) return null;
      const output = parseAsyncOutput(row.output);
      const base: AsyncRunningJob = {
        jobId: row.id,
        sessionId,
        taskLabel: input.taskLabel,
        status: "running",
        logs: output.logs,
        createdAt: row.createdAt.getTime(),
        sourceType: input.sourceType,
      };
      if (input.subagentSessionId) base.subagentSessionId = input.subagentSessionId;
      return base;
    })
    .filter((j): j is AsyncRunningJob => j !== null);
}

export interface AsyncQueuedJob {
  jobId: string;
  sessionId: string;
  taskLabel: string;
  status: "queued";
  position?: number;
  subagentSessionId?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  sourceType?: AsyncTaskSourceType;
}

export async function listQueuedAsyncJobs(
  sessionId: string,
  config: AppConfig,
): Promise<AsyncQueuedJob[]> {
  const orchestrator = getAsyncJobOrchestrator(config);
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      status: "queued",
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
    },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .map((row): AsyncQueuedJob | null => {
      const input = parseAsyncInput(row.input);
      if (!input) return null;
      const output = parseAsyncOutput(row.output);
      const base: AsyncQueuedJob = {
        jobId: row.id,
        sessionId,
        taskLabel: input.taskLabel,
        status: "queued",
        position: orchestrator.getPosition(row.id),
        logs: output.logs,
        createdAt: row.createdAt.getTime(),
        sourceType: input.sourceType,
      };
      if (input.subagentSessionId) base.subagentSessionId = input.subagentSessionId;
      return base;
    })
    .filter((j): j is AsyncQueuedJob => j !== null);
}

export interface SyncAsyncJob {
  jobId: string;
  taskLabel: string;
  status: "queued" | "running" | "completed" | "failed";
  elapsedMs?: number;
  asyncResult?: string;
  error?: string;
  logs?: AsyncTaskLogEntry[];
  createdAt: number;
  finishedAt?: number;
  subagentSessionId?: string;
  sourceType?: AsyncTaskSourceType;
}

/**
 * 列出会话的同步任务（waitForResult=true → deliverToQueue=false），供右栏「同步任务」区展示。
 * 同步任务结果走 tool return 返回父流，不进异步队列、不进气泡、不可 pin/consume。
 * status 判定与 getAsyncJobStatus 同源：orchestrator isRunning/isQueued 优先，DB 状态兜底。
 */
export async function listSyncAsyncJobs(
  sessionId: string,
  config: AppConfig,
  limit = 30,
): Promise<SyncAsyncJob[]> {
  const take = Math.max(1, Math.min(limit, 100));
  const rows = await prisma.task.findMany({
    where: {
      sessionId,
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
    },
    orderBy: { createdAt: "desc" },
    take: take * 2,
  });
  const orchestrator = getAsyncJobOrchestrator(config);
  const items: SyncAsyncJob[] = [];
  for (const row of rows) {
    const input = parseAsyncInput(row.input);
    if (!input || input.deliverToQueue !== false) continue;
    const output = parseAsyncOutput(row.output);
    const running = orchestrator.isRunning(row.id);
    const queued = orchestrator.isQueued(row.id);
    const createdAtMs =
      row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime();
    const status: SyncAsyncJob["status"] = running
      ? "running"
      : queued
        ? "queued"
        : row.status === "success"
          ? "completed"
          : row.status === "failed"
            ? "failed"
            : row.status === "running" || row.status === "queued"
              ? row.status
              : "failed";
    items.push({
      jobId: row.id,
      taskLabel: input.taskLabel,
      status,
      elapsedMs: running || row.status === "running" ? Date.now() - createdAtMs : undefined,
      asyncResult: output.asyncResult,
      error: output.error,
      logs: output.logs,
      createdAt: createdAtMs,
      finishedAt: row.finishedAt
        ? row.finishedAt instanceof Date
          ? row.finishedAt.getTime()
          : new Date(row.finishedAt).getTime()
        : undefined,
      subagentSessionId: input.subagentSessionId,
      sourceType: input.sourceType,
    });
    if (items.length >= take) break;
  }
  return items;
}

/** 取消一条运行中或排队中的异步任务 */
export async function cancelAsyncJob(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ cancelled: boolean; message: string }> {
  const task = await services.task.getById(jobId);
  if (!task) return { cancelled: false, message: "任务不存在" };
  // 接受 running 与 queued 两种活跃状态；已完成（success/failed）的不允许取消
  if (task.status !== "running" && task.status !== "queued") {
    return { cancelled: false, message: "任务未在运行中或排队中" };
  }

  const orchestrator = getAsyncJobOrchestrator(config);
  const cancelled = orchestrator.cancel(jobId);
  if (!cancelled) {
    // 任务可能刚好执行完但尚未被 poll，把仍标记为 running/queued 的记录置为失败，防止永久占坑
    await services.task.update({
      id: jobId,
      status: "failed",
      finishedAt: new Date(),
      output: { error: "任务已结束或丢失，取消失败" } satisfies AsyncTaskOutput,
    } as any);
    return { cancelled: true, message: "任务已结束，已标记为失败" };
  }

  // 对排队中任务，orchestrator 只清队列不会执行 finally，需要手动回写状态
  await services.task.update({
    id: jobId,
    status: "failed",
    finishedAt: new Date(),
    output: { error: "异步任务已取消" } satisfies AsyncTaskOutput,
  } as any);
  return { cancelled: true, message: "已取消异步任务" };
}

function buildAsyncExecute(
  config: AppConfig,
  services: ServiceContainer,
  jobId: string,
  task: string,
  agentSnapshot: AsyncTaskInput["agentSnapshot"],
  retryCount: number,
  subagentSessionId?: string,
  mode: "llm" | "tool" = "llm",
  toolCall?: { tool: string; args: Record<string, unknown> },
  shareToSessionIds?: string[],
  parentSessionId?: string,
): (signal: AbortSignal) => Promise<void> {
  const invokeTrpc = createTrpcInvoker({ services });
  const retryHint = retryCount > 0 ? `（第 ${retryCount} 次重试）` : "";
  const syncSubStatus = async (status: "completed" | "failed" | "paused" | "running") => {
    if (!subagentSessionId) return;
    try {
      await services.session.update({ id: subagentSessionId, status });
      if (parentSessionId) {
        await notifySubagentSessionUpdate({
          parentSessionId,
          subagentSessionId,
          status,
        });
      }
    } catch (err) {
      console.warn(`[asyncJobManager] syncSubStatus(${status}) 失败 for ${subagentSessionId}:`, err);
    }
  };
  const broadcastShare = async (status: "success" | "failed", output: AsyncTaskOutput) => {
    if (!shareToSessionIds?.length) return;
    const input = parseAsyncInput((await services.task.getById(jobId))?.input);
    if (!input) return;
    for (const targetSessionId of shareToSessionIds) {
      if (targetSessionId === input.sessionId) continue;
      try {
        await services.task.create({
          name: `[async-share] ${input.taskLabel}`,
          type: "oneshot",
          status,
          sessionId: targetSessionId,
          input: { ...input, sessionId: targetSessionId, shareToSessionIds: undefined },
        } as any);
      } catch (err) {
        console.warn(`[asyncJobManager] broadcastShare 到 ${targetSessionId} 失败:`, err);
      }
    }
  };
  const subagentOnly = agentSnapshot.tier === "sub";
  const workerTools = subagentOnly ? getAllowedToolsForTier("sub", agentSnapshot.tools) : agentSnapshot.tools;

  const subagentHint = subagentOnly
    ? "\n\n注意：你是被派来直接执行该任务的子 Agent。你可以调用 async_task_run(mode=tool) 把耗时步骤放入后台执行，但禁止调用 spawn_subagent、agent_create*、agent_send_message、agent_report_back 等再次派生或管理 Agent 的工具。请直接使用其他可用工具完成任务，不要继续追问用户。"
    : "";
  const agentSystemPrompt = `${agentSnapshot.systemPrompt}\n\n你正在执行后台异步任务${retryHint}。完成后用简洁中文汇总结果，不要继续追问用户。${subagentHint}`;
  const agentForLoop = { model: agentSnapshot.model, systemPrompt: agentSystemPrompt, tools: workerTools };
  const runLoopOptions = {
    config,
    services,
    agent: agentForLoop,
    messages: [{ role: "user", content: task } as const],
    invokeTrpc,
    sessionId: subagentSessionId,
    agentMeta: agentSnapshot,
    runOrigin: "parent" as const,
  };

  const finalizeSuccess = async (
    loop: {
      content: string;
      toolCalls: StoredToolCall[];
      tokenUsage: { prompt: number; completion: number; total: number };
      model: string;
      provider: string;
      roundsUsed: number;
    },
    emit?: (event: AgentStreamEvent) => void,
  ) => {
    const resultText = loop.content || "(无文本输出)";
    const tokenUsage = loop.tokenUsage;
    await appendAsyncJobLog(jobId, { level: "info", message: `任务完成，共 ${loop.roundsUsed} 轮` }, services);
    if (subagentSessionId) {
      try {
        await services.message.create({
          sessionId: subagentSessionId,
          role: "assistant",
          content: resultText,
          toolCalls: loop.toolCalls as any,
          tokenUsage: tokenUsage ?? undefined,
          source: "sub",
        });
      } catch (msgErr) {
        console.warn(`[asyncJobManager] 保存子 Agent 结果消息失败:`, msgErr);
      }
    }
    const existingOutput = parseAsyncOutput((await services.task.getById(jobId))?.output);
    await services.task.update({
      id: jobId,
      status: "success",
      finishedAt: new Date(),
      output: {
        asyncResult: resultText,
        tokenUsage,
        logs: existingOutput.logs,
      } satisfies AsyncTaskOutput,
    } as any);
    await syncSubStatus("completed");
    if (agentSnapshot.tier === "sub" && agentSnapshot.parentId) {
      await services.agent.update({ id: agentSnapshot.id, status: "dormant" } as any).catch((err) => {
        console.warn(`[asyncJobManager] 标记子 Agent dormant 失败 agent=${agentSnapshot.id}:`, err instanceof Error ? err.message : err);
      });
    }
    await broadcastShare("success", { asyncResult: resultText, tokenUsage });
    const parentInput = parseAsyncInput((await services.task.getById(jobId))?.input);
    if (parentInput?.sessionId && parentInput.deliverToQueue !== false) {
      await notifyAsyncDelivery(parentInput.sessionId, jobId, "done", parentInput.taskLabel, services, config);
    }
    emit?.({
      type: "done",
      sessionId: subagentSessionId!,
      agentId: agentSnapshot.id,
      content: resultText,
      toolCalls: loop.toolCalls,
      model: loop.model,
      provider: loop.provider,
      roundsUsed: loop.roundsUsed,
      tokenUsage,
    });
  };

  const finalizeFailure = async (err: unknown, emit?: (event: AgentStreamEvent) => void) => {
    const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("用户中断"));
    const isTimeout = err instanceof Error && err.message.includes("超时");
    const reason = isTimeout ? "异步任务执行超时" : isAbort ? "异步任务已取消" : undefined;
    const errorText = reason || (err instanceof Error ? err.message : String(err));
    await appendAsyncJobLog(jobId, { level: "error", message: errorText }, services);
    const existingOutputFailed = parseAsyncOutput((await services.task.getById(jobId))?.output);
    await services.task.update({
      id: jobId,
      status: "failed",
      finishedAt: new Date(),
      output: {
        error: errorText,
        logs: existingOutputFailed.logs,
      } satisfies AsyncTaskOutput,
    } as any);
    await syncSubStatus(isAbort && !isTimeout ? "paused" : "failed");
    if (subagentSessionId) {
      try {
        await services.message.create({
          sessionId: subagentSessionId,
          role: "assistant",
          content: `任务未能完成：${errorText}`,
          source: "sub",
        });
      } catch (msgErr) {
        console.warn(`[asyncJobManager] 保存子 Agent 失败消息失败:`, msgErr);
      }
    }
    await broadcastShare("failed", { error: errorText });
    const parentInputFailed = parseAsyncInput((await services.task.getById(jobId))?.input);
    if (parentInputFailed?.sessionId && parentInputFailed.deliverToQueue !== false) {
      await notifyAsyncDelivery(parentInputFailed.sessionId, jobId, "failed", parentInputFailed.taskLabel, services, config);
    }
    emit?.({ type: "error", message: errorText, sessionId: subagentSessionId });
  };

  const runToolOnly = async (signal: AbortSignal) => {
    if (!toolCall) throw new Error("mode=tool 但未提供 toolCall");
    const parsed = parseAgentTools(workerTools);
    const registry = new Map<string, ToolRegistryEntry>();
    await buildAgentToolSchemas(services, parsed, registry);
    const toolCtx = createAgentToolContext(config, services, invokeTrpc, parsed, undefined, {
      sessionId: subagentSessionId,
      agentSnapshot,
      runOrigin: "parent",
    });
    const call: LlmToolCall = {
      id: `tool-${jobId.slice(0, 8)}`,
      type: "function",
      function: { name: toolCall.tool, arguments: JSON.stringify(toolCall.args ?? {}) },
    };
    const results = await executeToolCallsBatch([call], toolCtx, registry, parsed, signal);
    const result = results[0]?.result;
    const resultText = typeof result === "string" ? result : JSON.stringify(result ?? null);
    if (subagentSessionId) {
      await services.message.create({
        sessionId: subagentSessionId,
        role: "assistant",
        content: resultText,
        source: "sub",
      }).catch(() => {});
    }
    await services.task.update({
      id: jobId,
      status: "success",
      finishedAt: new Date(),
      output: { asyncResult: resultText } satisfies AsyncTaskOutput,
    } as any);
    await syncSubStatus("completed");
    await broadcastShare("success", { asyncResult: resultText });
    const parentInputTool = parseAsyncInput((await services.task.getById(jobId))?.input);
    if (parentInputTool?.sessionId && parentInputTool.deliverToQueue !== false) {
      await notifyAsyncDelivery(parentInputTool.sessionId, jobId, "done", parentInputTool.taskLabel, services, config);
    }
  };

  return async (signal) => {
    if (subagentSessionId) {
      try {
        await services.message.create({
          sessionId: subagentSessionId,
          role: "user",
          content: task,
          source: "super",
        });
      } catch (msgErr) {
        console.warn(`[asyncJobManager] 保存子 Agent 任务消息失败:`, msgErr);
      }
    }

    try {
      if (signal.aborted) {
        throw new Error("异步任务已被取消");
      }
      await syncSubStatus("running");
      try {
        await services.task.update({ id: jobId, status: "running", startedAt: new Date() } as any);
      } catch (err) {
        console.warn(`[asyncJobManager] 标记任务 running 失败 job=${jobId}:`, err instanceof Error ? err.message : err);
      }
      await appendAsyncJobLog(jobId, { level: "info", message: "任务开始执行" }, services);

      if (mode === "tool") {
        await runToolOnly(signal);
        return;
      }

      if (subagentSessionId) {
        const hub = getStreamHub();
        if (hub) {
          const hubInput = {
            sessionId: subagentSessionId,
            agentId: agentSnapshot.id,
            message: task,
          };
          const started = await hub.startIfNotRunning(subagentSessionId, hubInput, async (emit, hubSignal) => {
            try {
              const loop = await runAgentLoopStream({
                ...runLoopOptions,
                llmOptions: {},
                emit,
                signal: hubSignal,
              });
              await finalizeSuccess(loop, emit);
            } catch (runErr) {
              await finalizeFailure(runErr, emit);
            }
          });
          if (started) {
            signal.addEventListener("abort", () => hub.stop(subagentSessionId), { once: true });
            // 通知前端挂接子会话流（切到子页时不必等刷新）
            hub.pushExternalEvent(subagentSessionId, {
              type: "session_run_started",
              sessionId: subagentSessionId,
              reason: "subagent_start",
              jobId,
            });
            if (parentSessionId) {
              hub.pushExternalEvent(parentSessionId, {
                type: "session_run_started",
                sessionId: subagentSessionId,
                reason: "subagent_start",
                jobId,
              });
            }
          }
          await hub.waitFor(subagentSessionId);
          return;
        }
      }

      const loop = await runAgentLoop({
        ...runLoopOptions,
        signal,
        onProgress: (message) => appendAsyncJobLog(jobId, { level: "progress", message }, services),
      });
      await finalizeSuccess(loop);
    } catch (err: unknown) {
      await finalizeFailure(err);
    }
  };
}

export async function startAsyncAgentTask(options: {
  sessionId: string;
  task: string;
  label?: string;
  timeoutMs?: number;
  config: AppConfig;
  services: ServiceContainer;
  agent: { id: string; model: string; systemPrompt: string; tools: string[] };
  /** 调用来源，用于 Agent.source 与审计区分 async_task_run / spawn_subagent */
  source?: string;
  /** 是否属于 spawn_subagent 派生的子 Agent（UI 显示“与之对话”） */
  isSubagent?: boolean;
  /** 异步任务模式：llm=后台 LLM 推理；tool=纯工具执行（不调用 LLM） */
  mode?: "llm" | "tool";
  /** mode=tool 时直接指定要执行的一次性工具调用 */
  toolCall?: { tool: string; args: Record<string, unknown> };
  /** swarm 协作：结果额外广播到这些会话 */
  shareToSessionIds?: string[];
  /**
   * 是否投递到会话队列并自动消费。waitForResult 场景传 false。
   * 默认 true。
   */
  deliverToQueue?: boolean;
  /** W10：中介者权限校验描述（仅 native 工具入口传入；tRPC 用户入口无调用方 tier 概念，不传） */
  guard?: SwarmTaskSpec["guard"];
}): Promise<{ jobId: string; status: "queued" | "running"; message: string; subagentSessionId?: string }> {
  const task = options.task.trim();
  if (!task) throw new Error("task 不能为空");
  if (!options.sessionId) throw new Error("async_task_run 需要有效 sessionId");

  const mode = options.mode ?? "llm";
  const isSubagent = options.isSubagent === true;

  if (mode === "tool" && options.toolCall && !options.toolCall.tool) {
    throw new Error("mode=tool 时必须提供有效的 toolCall.tool");
  }

  // 预算检查：只有 LLM 模式才需要检查 LLM 预算
  if (mode === "llm") {
    assertLlmBudget(options.config);
  }

  const taskLabel = options.label?.trim() || task.slice(0, 80);

  // 确定任务来源类型
  let sourceType: AsyncTaskSourceType;
  if (isSubagent) sourceType = "subagent";
  else if (mode === "tool") sourceType = "async_task_tool";
  else sourceType = "async_task_llm";

  const orchestrator = getAsyncJobOrchestrator(options.config);
  const stats = orchestrator.getStats();
  const willQueue = stats.runningGlobal >= stats.limits.maxGlobal;
  const initialStatus = willQueue ? "queued" : "running";

  const parentAgent = await prisma.agent.findUnique({ where: { id: options.agent.id } }).catch(() => null);

  // async_task_run：不创建新的 Agent/会话，直接复用父 Agent 身份跑后台任务。
  // spawn_subagent：才创建独立的 tier=sub 子 Agent 和 subagent ChatSession。
  let subAgentId: string | undefined;
  let subagentSessionId: string | undefined;
  let agentSnapshot: AsyncTaskInput["agentSnapshot"];

  if (isSubagent) {
    // 数量上限：防止同一父会话失控开太多 subagent
    const activeCount = await prisma.chatSession.count({
      where: {
        parentSessionId: options.sessionId,
        kind: "subagent",
        status: { in: ["running", "queued"] },
      },
    });
    const limit = options.config.asyncJobs.maxSubagentsPerSession;
    if (activeCount >= limit) {
      throw new Error(`已达到每会话子 Agent 上限（${limit}），请先停止或等待已有任务完成后再启动新任务。`);
    }

    // 子 Agent 只保留执行类工具，禁止继承 spawn/async_task_run/async_task_cancel 等编排工具
    const subagentTools = getAllowedToolsForTier("sub", options.agent.tools);

    try {
      const subAgentResult = await options.services.agent.create({
        name: `${taskLabel.slice(0, 40)} 子 Agent`,
        description: `由 ${parentAgent?.name ?? options.agent.id} 派生的子 Agent（任务：${taskLabel.slice(0, 60)}）`,
        source: options.source ?? "native_tool:spawn_subagent",
        model: options.agent.model,
        systemPrompt: options.agent.systemPrompt,
        tools: subagentTools,
        tier: "sub",
        parentId: options.agent.id,
        workspaceId: parentAgent?.workspaceId ?? undefined,
      });
      if (subAgentResult.success && subAgentResult.data) {
        subAgentId = (subAgentResult.data as { id: string }).id;
      }
    } catch (err) {
      console.warn(`[asyncJobManager] 创建独立子 Agent 失败，降级复用父 Agent:`, err);
    }

    const actualSubAgentId = subAgentId ?? options.agent.id;
    const subagentName = `${taskLabel.slice(0, 40)} 子 Agent`;

    try {
      const sub = await options.services.session.create({
        title: taskLabel.slice(0, 60),
        model: options.agent.model,
        systemPrompt: options.agent.systemPrompt,
        agentId: actualSubAgentId,
        parentSessionId: options.sessionId,
        kind: "subagent",
        taskDescription: task,
        status: initialStatus,
      } as any);
      if (sub.success && sub.data) subagentSessionId = (sub.data as { id: string }).id;
      if (subagentSessionId) {
        void notifySubagentSessionUpdate({
          parentSessionId: options.sessionId,
          subagentSessionId,
          status: initialStatus,
          title: taskLabel.slice(0, 60),
          agentId: actualSubAgentId,
        });
      }
    } catch (err) {
      console.warn(`[asyncJobManager] 创建 subagent session 失败，降级为无可视化载体继续执行:`, err);
    }

    agentSnapshot = {
      id: actualSubAgentId,
      model: options.agent.model,
      systemPrompt: options.agent.systemPrompt,
      tools: options.agent.tools,
      tier: "sub",
      parentId: options.agent.id,
      workspaceId: parentAgent?.workspaceId ?? null,
      name: subagentName,
    };
  } else {
    agentSnapshot = {
      id: options.agent.id,
      model: options.agent.model,
      systemPrompt: options.agent.systemPrompt,
      tools: options.agent.tools,
      tier: parentAgent?.tier ?? "sub",
      parentId: parentAgent?.parentId ?? null,
      workspaceId: parentAgent?.workspaceId ?? null,
      name: parentAgent?.name ?? options.agent.id,
    };
  }

  const created = await options.services.task.create({
    name: `[async] ${taskLabel}`,
    type: "async_agent",
    status: willQueue ? "queued" : "running",
    sessionId: options.sessionId,
    queuedAt: willQueue ? new Date() : null,
    startedAt: willQueue ? null : new Date(),
    input: {
      kind: ASYNC_KIND,
      sessionId: options.sessionId,
      task,
      taskLabel,
      agentSnapshot,
      retryCount: 0,
      timeoutMs: options.timeoutMs,
      subagentSessionId,
      sourceType,
      toolCall: mode === "tool" ? options.toolCall : undefined,
      shareToSessionIds: options.shareToSessionIds?.length ? options.shareToSessionIds : undefined,
      deliverToQueue: options.deliverToQueue !== false,
    } satisfies AsyncTaskInput,
  } as any);

  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建异步任务失败");
  }

  const jobId = (created.data as { id: string }).id;

  // W10：统一走 SwarmOrchestrator 中介者（并发池/结果聚合/Log 审计公共骨架）；
  // 执行体仍是 buildAsyncExecute（轮询/推送/落库/子会话状态同步语义不动）。
  const swarm = getSwarmOrchestrator(options.config, options.services);
  await swarm.dispatch({
    origin: isSubagent ? "spawn_subagent" : "async_task_run",
    schedule: "pool",
    sessionId: options.sessionId,
    jobId,
    taskLabel,
    timeoutMs: options.timeoutMs,
    metadata: subagentSessionId ? { subagentSessionId } : undefined,
    guard: options.guard,
    execute: async (signal) => {
      await buildAsyncExecute(
        options.config,
        options.services,
        jobId,
        task,
        agentSnapshot,
        0,
        subagentSessionId,
        mode,
        options.toolCall,
        options.shareToSessionIds,
        options.sessionId,
      )(signal);
      // 结果聚合：buildAsyncExecute 内部已落库/投递，读回终态供中介者审计
      try {
        const row = await options.services.task.getById(jobId);
        return row?.status === "failed"
          ? { status: "failed" as const, error: parseAsyncOutput(row?.output).error }
          : { status: "success" as const };
      } catch {
        // 任务行已被清理（测试/手动删除）：不阻塞聚合收口
        return { status: "success" as const };
      }
    },
  });

  return {
    jobId,
    status: willQueue ? "queued" : "running",
    subagentSessionId,
    message: (() => {
      const typeLabel = isSubagent ? "子 Agent" : mode === "tool" ? "纯工具异步" : "后台 LLM";
      return willQueue
        ? `已排队${typeLabel}任务「${taskLabel}」（并发槽位已满）。`
        : `已启动${typeLabel}任务「${taskLabel}」。${isSubagent ? "可进入任务会话查看进度。" : "你可以继续对话；完成后结果会进入发送队列最前。"}`;
    })(),
  };
}

/** 轻量异步睡眠/定时器任务：不跑 LLM，到时间后把结果投递回父会话 */
export async function startAsyncSleepTask(options: {
  sessionId: string;
  seconds: number;
  config: AppConfig;
  services: ServiceContainer;
  agentSnapshot: AsyncTaskInput["agentSnapshot"];
}): Promise<{ jobId: string; status: "queued" | "running"; message: string }> {
  const seconds = Math.max(0, Math.min(options.seconds, 300));
  const ms = seconds * 1000;
  const taskLabel = `sleep ${seconds}s`;
  const input: AsyncTaskInput = {
    kind: ASYNC_KIND,
    sessionId: options.sessionId,
    task: `等待 ${seconds} 秒后返回`,
    taskLabel,
    agentSnapshot: options.agentSnapshot,
    sourceType: "sleep",
  };

  const created = await options.services.task.create({
    name: `[async] ${taskLabel}`,
    type: "async_agent",
    status: "queued",
    sessionId: options.sessionId,
    queuedAt: new Date(),
    input,
  } as any);
  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建异步定时器任务失败");
  }
  const jobId = (created.data as { id: string }).id;
  const orchestrator = getAsyncJobOrchestrator(options.config);
  orchestrator.enqueue({
    jobId,
    sessionId: options.sessionId,
    timeoutMs: ms + 10_000,
    execute: async (signal) => {
      try {
        await options.services.task.update({ id: jobId, status: "running", startedAt: new Date() } as any);
      } catch {
        /* 状态回写失败不阻塞 */
      }
      const { aborted } = await waitMs(ms, signal);
      if (aborted || signal.aborted) {
        await options.services.task.update({
          id: jobId,
          status: "failed",
          finishedAt: new Date(),
          output: { error: "定时器已取消" } satisfies AsyncTaskOutput,
        } as any).catch(() => undefined);
        return;
      }
      await options.services.task.update({
        id: jobId,
        status: "success",
        finishedAt: new Date(),
        output: { asyncResult: `定时时间${seconds}s到了，请继续完成任务` } satisfies AsyncTaskOutput,
      } as any);
      await notifyAsyncDelivery(options.sessionId, jobId, "done", taskLabel, options.services, options.config);
    },
  });
  const stats = orchestrator.getStats();
  const willQueue = stats.runningGlobal >= stats.limits.maxGlobal;
  return {
    jobId,
    status: willQueue ? "queued" : "running",
    message: willQueue
      ? `定时器已排队，将在获得槽位后等待 ${seconds} 秒。`
      : `定时器已启动，${seconds} 秒后结果会进入发送队列最前。`,
  };
}

/** 向运行中/排队中的异步任务追加一条日志。任务执行过程中工具/Agent 可调用此函数写入进度。 */
export async function appendAsyncJobLog(
  jobId: string,
  entry: Omit<AsyncTaskLogEntry, "timestamp">,
  services: ServiceContainer,
): Promise<void> {
  let task: Awaited<ReturnType<ServiceContainer["task"]["getById"]>> | null = null;
  try {
    task = await services.task.getById(jobId);
  } catch {
    // 任务行已删除（测试清理/手动删除）：进度日志是尽力而为，不得向上抛
    // （getById 对缺失行抛 NOT_FOUND；reactLoop 的 onProgress 不 await，抛了就是 unhandled rejection）
    return;
  }
  if (!task) return;
  const output = parseAsyncOutput(task.output);
  const logs: AsyncTaskLogEntry[] = output.logs ?? [];
  logs.push({ ...entry, timestamp: Date.now() });
  // 保留最近 50 条，避免 output JSON 过大
  const trimmed = logs.length > 50 ? logs.slice(logs.length - 50) : logs;
  await services.task.update({
    id: jobId,
    output: { ...output, logs: trimmed },
  } as any).catch(() => undefined);
}

/** 查询单个异步任务状态（W-B：只回状态，不回结果全文/日志——结果完成后经队列唯一通道投递） */
export async function getAsyncJobStatus(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{
  jobId: string;
  status: string;
  taskLabel?: string;
  elapsedMs?: number;
  subagentSessionId?: string;
  timeoutMs?: number;
}> {
  const task = await services.task.getById(jobId);
  if (!task) return { jobId, status: "not_found" };
  const input = parseAsyncInput(task.input);
  const orchestrator = getAsyncJobOrchestrator(config);
  const running = orchestrator.isRunning(jobId);
  const queued = orchestrator.isQueued(jobId);
  const status = running ? "running" : queued ? "queued" : task.status === "success" ? "completed" : task.status === "failed" ? "failed" : task.status;
  return {
    jobId,
    status,
    taskLabel: input?.taskLabel,
    elapsedMs: running || task.status === "running" ? Date.now() - (task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime()) : undefined,
    subagentSessionId: input?.subagentSessionId,
    timeoutMs: input?.timeoutMs ?? config.asyncJobs.taskTimeoutMs,
  };
}

/** 列出某会话的全部异步任务状态（W-B：只回状态，不含日志/结果） */
export async function listSessionAsyncJobs(
  sessionId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<Array<{ jobId: string; status: string; taskLabel?: string; elapsedMs?: number; subagentSessionId?: string }>> {
  // R7：DB 层按 sessionId 过滤，避免全局 task.list(50) 后 JS 过滤漏掉非 top-50 的任务
  const rows = await services.task.list({ page: 1, pageSize: 50, sessionId } as any);
  const orchestrator = getAsyncJobOrchestrator(config);
  const items: Array<{ jobId: string; status: string; taskLabel?: string; elapsedMs?: number; subagentSessionId?: string }> = [];
  for (const row of (rows as any).items ?? []) {
    if (row.sessionId !== sessionId) continue;
    const input = parseAsyncInput(row.input);
    if (!input) continue;
    const running = orchestrator.isRunning(row.id);
    const queued = orchestrator.isQueued(row.id);
    const status = running ? "running" : queued ? "queued" : row.status === "success" ? "completed" : row.status === "failed" ? "failed" : row.status;
    items.push({
      jobId: row.id,
      status,
      taskLabel: input.taskLabel,
      elapsedMs: running ? Date.now() - (row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime()) : undefined,
      subagentSessionId: input.subagentSessionId,
    });
  }
  return items;
}

/**
 * 阻塞等待一个异步任务结束，返回最终结果（唯一调用方：async_task_run(waitForResult=true)。
 * spawn_subagent 的同步等待在 session.ts 自行轮询子会话，不经此函数）。
 * 受 toolCallTimeoutMs 约束（由调用方的 withToolTimeout race 兜底），此处轮询最长 10 分钟。
 */
export async function waitForAsyncJob(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ jobId: string; status: "completed" | "failed"; asyncResult?: string; error?: string }> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const task = await services.task.getById(jobId);
    if (task && (task.status === "success" || task.status === "failed")) {
      const output = parseAsyncOutput(task.output);
      return {
        jobId,
        status: task.status === "success" ? "completed" : "failed",
        asyncResult: output.asyncResult,
        error: output.error,
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { jobId, status: "failed", error: "等待超时（10 分钟）" };
}

/** 停止指定 subagent session 对应的后台任务（真正 abort）。
 *  返回详细信息：wasRunning 区分运行中/排队中，jobId 供调用方回写 Task 状态。 */
export function stopSubagentSession(
  subagentSessionId: string,
  config: AppConfig,
): { stopped: boolean; wasRunning: boolean; jobId?: string } {
  const orchestrator = getAsyncJobOrchestrator(config);
  const result = orchestrator.stopSubagent(subagentSessionId);
  // 同时中断 SessionStreamHub 中的 SSE 运行，确保前端立即停止流式输出
  getStreamHub()?.stop(subagentSessionId);
  return result;
}

export async function retryAsyncJob(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ jobId: string; status: "running"; message: string }> {
  const existing = await services.task.getById(jobId);
  if (!existing) throw new Error("任务不存在");
  if (existing.status !== "failed") throw new Error("只能重试失败的任务");
  const input = parseAsyncInput(existing.input);
  if (!input) throw new Error("不是有效的异步 Agent 任务");

  const retryCount = (input.retryCount ?? 0) + 1;
  if (retryCount > config.asyncJobs.maxRetries) {
    throw new Error(`该异步任务最多只能重试 ${config.asyncJobs.maxRetries} 次`);
  }
  const taskLabel = input.taskLabel;
  const agentSnapshot = input.agentSnapshot;

  const created = await services.task.create({
    name: `[async] ${taskLabel}`,
    type: "async_agent",
    status: "running",
    sessionId: input.sessionId,
    startedAt: new Date(),
    input: {
      kind: ASYNC_KIND,
      sessionId: input.sessionId,
      task: input.task,
      taskLabel,
      agentSnapshot,
      retryCount,
      timeoutMs: input.timeoutMs,
    } satisfies AsyncTaskInput,
  });

  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建重试任务失败");
  }

  const newJobId = (created.data as { id: string }).id;
  const orchestrator = getAsyncJobOrchestrator(config);

  orchestrator.enqueue({
    jobId: newJobId,
    sessionId: input.sessionId,
    timeoutMs: input.timeoutMs,
    execute: buildAsyncExecute(
      config,
      services,
      newJobId,
      input.task,
      agentSnapshot,
      retryCount,
      input.subagentSessionId,
      input.toolCall ? "tool" : "llm",
      input.toolCall,
      input.shareToSessionIds,
      input.sessionId,
    ),
  });

  return {
    jobId: newJobId,
    status: "running",
    message: `已启动后台任务「${taskLabel}」的第 ${retryCount} 次重试。`,
  };
}

export interface AsyncQueueStats {
  queued: number;
  runningGlobal: number;
  maxGlobal: number;
  maxPerSession: number;
  taskTimeoutMs: number;
}

/** 获取异步任务队列实时统计（全局排队数与运行数） */
export function getAsyncQueueStats(config: AppConfig): AsyncQueueStats {
  const stats = getAsyncJobOrchestrator(config).getStats();
  return {
    queued: stats.queued,
    runningGlobal: stats.runningGlobal,
    maxGlobal: stats.limits.maxGlobal,
    maxPerSession: stats.limits.maxPerSession,
    taskTimeoutMs: stats.limits.taskTimeoutMs,
  };
}
