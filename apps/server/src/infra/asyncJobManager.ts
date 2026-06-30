/**
 * 异步 Agent 任务 — 后台执行，完成后投递到会话队列（MetaBlog 风格）
 * 持久化到 Task 表；执行由 asyncJobOrchestrator 限流调度
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { runAgentLoop } from "./agentRuntime.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { prisma } from "../db.js";
import { getAsyncJobOrchestrator } from "./asyncJobOrchestrator.js";

export interface AsyncQueueDelivery {
  id: string;
  jobId: string;
  sessionId: string;
  taskLabel: string;
  asyncResult: string;
  status: "done" | "failed";
  error?: string;
  createdAt: number;
}

export interface AsyncRunningJob {
  jobId: string;
  sessionId: string;
  taskLabel: string;
  status: "running";
  createdAt: number;
}

const ASYNC_KIND = "async_agent";

interface AsyncTaskInput {
  kind: typeof ASYNC_KIND;
  sessionId: string;
  task: string;
  taskLabel: string;
  agentSnapshot: { id: string; model: string; systemPrompt: string; tools: string[] };
  retryCount?: number;
  timeoutMs?: number;
}

interface AsyncTaskOutput {
  asyncResult?: string;
  error?: string;
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
}): AsyncQueueDelivery | null {
  const input = parseAsyncInput(task.input);
  if (!input) return null;
  const output = parseAsyncOutput(task.output);
  const failed = task.status === "failed";
  return {
    id: `del-${task.id}`,
    jobId: task.id,
    sessionId: input.sessionId,
    taskLabel: input.taskLabel,
    asyncResult: failed ? "" : output.asyncResult || "(无文本输出)",
    status: failed ? "failed" : "done",
    error: output.error,
    createdAt: task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime(),
  };
}

/** 服务启动时：仅将遗留 async_agent running 任务标为 failed */
export async function recoverStaleAsyncJobs(): Promise<number> {
  const stale = await prisma.task.findMany({
    where: { status: "running", name: { startsWith: "[async]" } },
  });
  let count = 0;
  for (const task of stale) {
    const input = parseAsyncInput(task.input);
    if (!input) continue;
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "failed",
        output: { error: "服务重启，后台任务已中断" },
      },
    });
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

/** 拉取并标记已投递的异步结果（前端轮询）— 原子 CLAIM，防止重复投递 */
export async function pullAsyncDeliveries(sessionId: string): Promise<AsyncQueueDelivery[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      input: unknown;
      output: unknown;
      status: string;
      createdAt: Date;
    }>
  >`
    UPDATE "Task"
    SET delivered = 1, deliveredAt = datetime('now')
    WHERE sessionId = ${sessionId}
      AND name LIKE '[async]%'
      AND status IN ('success', 'failed')
      AND delivered = 0
    RETURNING id, input, output, status, createdAt
  `;

  const deliveries: AsyncQueueDelivery[] = [];
  for (const row of rows) {
    const delivery = toDelivery(row);
    if (delivery) deliveries.push(delivery);
  }
  return deliveries;
}

export async function listRunningAsyncJobs(sessionId: string): Promise<AsyncRunningJob[]> {
  const rows = await prisma.task.findMany({
    where: { sessionId, status: "running", name: { startsWith: "[async]" } },
    orderBy: { createdAt: "desc" },
  });
  return rows
    .map((row) => {
      const input = parseAsyncInput(row.input);
      if (!input) return null;
      return {
        jobId: row.id,
        sessionId,
        taskLabel: input.taskLabel,
        status: "running" as const,
        createdAt: row.createdAt.getTime(),
      };
    })
    .filter((j): j is AsyncRunningJob => j !== null);
}

/** 取消一条运行中或排队中的异步任务 */
export async function cancelAsyncJob(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{ cancelled: boolean; message: string }> {
  const task = await services.task.getById(jobId);
  if (!task) return { cancelled: false, message: "任务不存在" };
  if (task.status !== "running") return { cancelled: false, message: "任务未在运行中" };

  const orchestrator = getAsyncJobOrchestrator(config);
  const cancelled = orchestrator.cancel(jobId);
  if (!cancelled) {
    // 任务可能刚好执行完但尚未被 poll，把仍标记为 running 的记录置为失败，防止永久占坑
    await services.task.update({
      id: jobId,
      status: "failed",
      output: { error: "任务已结束或丢失，取消失败" } satisfies AsyncTaskOutput,
    });
    return { cancelled: true, message: "任务已结束，已标记为失败" };
  }

  // 对排队中任务，orchestrator 只清队列不会执行 finally，需要手动回写状态
  await services.task.update({
    id: jobId,
    status: "failed",
    output: { error: "异步任务已取消" } satisfies AsyncTaskOutput,
  });
  return { cancelled: true, message: "已取消异步任务" };
}

function buildAsyncExecute(
  config: AppConfig,
  services: ServiceContainer,
  jobId: string,
  task: string,
  agentSnapshot: AsyncTaskInput["agentSnapshot"],
  retryCount: number,
): (signal: AbortSignal) => Promise<void> {
  const invokeTrpc = createTrpcInvoker({ services });
  const retryHint = retryCount > 0 ? `（第 ${retryCount} 次重试）` : "";
  return async (signal) => {
    try {
      if (signal.aborted) {
        throw new Error("异步任务已被取消");
      }
      const loop = await runAgentLoop({
        config,
        services,
        agent: {
          model: agentSnapshot.model,
          systemPrompt: `${agentSnapshot.systemPrompt}\n\n你正在执行后台异步任务${retryHint}。完成后用简洁中文汇总结果，不要继续追问用户。`,
          tools: agentSnapshot.tools,
        },
        messages: [{ role: "user", content: task }],
        invokeTrpc,
        signal,
      });

      await services.task.update({
        id: jobId,
        status: "success",
        output: { asyncResult: loop.content || "(无文本输出)" } satisfies AsyncTaskOutput,
      });
    } catch (err: unknown) {
      const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("用户中断"));
      const isTimeout = err instanceof Error && err.message.includes("超时");
      const reason = isTimeout ? "异步任务执行超时" : isAbort ? "异步任务已取消" : undefined;
      await services.task.update({
        id: jobId,
        status: "failed",
        output: {
          error: reason || (err instanceof Error ? err.message : String(err)),
        } satisfies AsyncTaskOutput,
      });
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
}): Promise<{ jobId: string; status: "running"; message: string }> {
  const task = options.task.trim();
  if (!task) throw new Error("task 不能为空");
  if (!options.sessionId) throw new Error("run_async 需要有效 sessionId");

  const taskLabel = options.label?.trim() || task.slice(0, 80);
  const agentSnapshot = {
    id: options.agent.id,
    model: options.agent.model,
    systemPrompt: options.agent.systemPrompt,
    tools: options.agent.tools,
  };

  const created = await options.services.task.create({
    name: `[async] ${taskLabel}`,
    type: "oneshot",
    status: "running",
    sessionId: options.sessionId,
    input: {
      kind: ASYNC_KIND,
      sessionId: options.sessionId,
      task,
      taskLabel,
      agentSnapshot,
      retryCount: 0,
      timeoutMs: options.timeoutMs,
    } satisfies AsyncTaskInput,
  });

  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建异步任务失败");
  }

  const jobId = (created.data as { id: string }).id;
  const orchestrator = getAsyncJobOrchestrator(options.config);

  orchestrator.enqueue({
    jobId,
    sessionId: options.sessionId,
    timeoutMs: options.timeoutMs,
    execute: buildAsyncExecute(options.config, options.services, jobId, task, agentSnapshot, 0),
  });

  return {
    jobId,
    status: "running",
    message: `已启动后台任务「${taskLabel}」。你可以继续对话；完成后结果会进入发送队列最前。`,
  };
}

/** 重试一条失败的异步任务 */
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
    type: "oneshot",
    status: "running",
    sessionId: input.sessionId,
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
    execute: buildAsyncExecute(config, services, newJobId, input.task, agentSnapshot, retryCount),
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
