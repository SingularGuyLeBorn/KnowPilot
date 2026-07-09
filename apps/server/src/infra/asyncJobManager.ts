/**
 * 异步 Agent 任务 — 后台执行，完成后投递到会话队列（MetaBlog 风格）
 * 持久化到 Task 表；执行由 asyncJobOrchestrator 限流调度
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { runAgentLoop } from "./agentRuntime.js";
import { waitMs } from "./shellRunner.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { prisma } from "../db.js";
import { getAsyncJobOrchestrator } from "./asyncJobOrchestrator.js";
import { assertLlmBudget } from "./llmBudget.js";

export interface AsyncQueueDelivery {
  id: string;
  jobId: string;
  sessionId: string;
  taskLabel: string;
  asyncResult: string;
  status: "done" | "failed";
  error?: string;
  subagentSessionId?: string;
  createdAt: number;
}

export interface AsyncRunningJob {
  jobId: string;
  sessionId: string;
  taskLabel: string;
  status: "running";
  subagentSessionId?: string;
  createdAt: number;
}

const ASYNC_KIND = "async_agent";

interface AsyncTaskInput {
  kind: typeof ASYNC_KIND;
  sessionId: string;
  task: string;
  taskLabel: string;
  agentSnapshot: { id: string; model: string; systemPrompt: string; tools: string[]; tier?: string; parentId?: string | null; workspaceId?: string | null };
  retryCount?: number;
  timeoutMs?: number;
  subagentSessionId?: string;
  /** swarm 协作：任务结果额外广播到这些会话（共享给其他父会话） */
  shareToSessionIds?: string[];
}

interface AsyncTaskOutput {
  asyncResult?: string;
  error?: string;
  /** 任务 token 消耗（纳入 LLM 预算闭环，便于审计） */
  tokenUsage?: { prompt: number; completion: number; total: number };
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
    subagentSessionId: input.subagentSessionId,
    createdAt: task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime(),
  };
}

/** 服务启动时：将遗留 async_agent running/queued 任务标为 failed，并同步其 subagent ChatSession 状态 */
export async function recoverStaleAsyncJobs(): Promise<number> {
  const stale = await prisma.task.findMany({
    where: { status: { in: ["running", "queued"] }, name: { startsWith: "[async]" } },
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
    .map((row): AsyncRunningJob | null => {
      const input = parseAsyncInput(row.input);
      if (!input) return null;
      const base: AsyncRunningJob = {
        jobId: row.id,
        sessionId,
        taskLabel: input.taskLabel,
        status: "running",
        createdAt: row.createdAt.getTime(),
      };
      if (input.subagentSessionId) base.subagentSessionId = input.subagentSessionId;
      return base;
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
      output: { error: "任务已结束或丢失，取消失败" } satisfies AsyncTaskOutput,
    } as any);
    return { cancelled: true, message: "任务已结束，已标记为失败" };
  }

  // 对排队中任务，orchestrator 只清队列不会执行 finally，需要手动回写状态
  await services.task.update({
    id: jobId,
    status: "failed",
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
  shareToSessionIds?: string[],
): (signal: AbortSignal) => Promise<void> {
  const invokeTrpc = createTrpcInvoker({ services });
  const retryHint = retryCount > 0 ? `（第 ${retryCount} 次重试）` : "";
  const syncSubStatus = async (status: "completed" | "failed" | "paused" | "running") => {
    if (!subagentSessionId) return;
    try {
      await services.session.update({ id: subagentSessionId, status });
    } catch (err) {
      // subagent session 同步失败不阻塞任务，但记录日志便于排查
      console.warn(`[asyncJobManager] syncSubStatus(${status}) 失败 for ${subagentSessionId}:`, err);
    }
  };
  // swarm 协作：结果广播到 shareToSessionIds 对应会话（复制一条 success Task 到目标 session，
  // 各目标会话 pullAsyncDeliveries 会拉到，实现跨会话结果共享）
  const broadcastShare = async (status: "success" | "failed", output: AsyncTaskOutput) => {
    if (!shareToSessionIds?.length) return;
    const input = parseAsyncInput(
      (await services.task.getById(jobId))?.input,
    );
    if (!input) return;
    for (const targetSessionId of shareToSessionIds) {
      if (targetSessionId === input.sessionId) continue; // 原会话已投递，跳过
      try {
        await services.task.create({
          name: `[async-share] ${input.taskLabel}`,
          type: "oneshot",
          status,
          sessionId: targetSessionId,
          input: { ...input, sessionId: targetSessionId, shareToSessionIds: undefined },
        } as any);
      } catch (err) {
        // 单个目标广播失败不阻塞其他，但记录日志便于排查跨会话共享丢失
        console.warn(`[asyncJobManager] broadcastShare 到 ${targetSessionId} 失败:`, err);
      }
    }
  };
  return async (signal) => {
    // 任务开始时即把 user 任务写入 subagent ChatSession，
    // 让 UI 在任务执行期间也能看到"父代理分配的任务"这条气泡。
    if (subagentSessionId) {
      try {
        await services.message.create({
          sessionId: subagentSessionId,
          role: "user",
          content: task,
          source: "super",
        });
      } catch (msgErr) {
        console.warn(`[asyncJobManager] 保存子代理任务消息失败:`, msgErr);
      }
    }

    try {
      if (signal.aborted) {
        throw new Error("异步任务已被取消");
      }
      // queued → running 状态同步：orchestrator 从队列取出开始执行时，
      // 把 Task 与 subagent session 从 queued 升级为 running
      await syncSubStatus("running");
      try {
        await services.task.update({ id: jobId, status: "running" } as any);
      } catch {
        /* 状态回写失败不阻塞执行 */
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
        sessionId: subagentSessionId,
        agentMeta: agentSnapshot,
        runOrigin: "parent",
      });

      const resultText = loop.content || "(无文本输出)";
      const tokenUsage = loop.tokenUsage;

      // 保存子代理的结果到 ChatSession
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
          console.warn(`[asyncJobManager] 保存子代理结果消息失败:`, msgErr);
        }
      }

      await services.task.update({
        id: jobId,
        status: "success",
        output: {
          asyncResult: tokenUsage?.total
            ? `${resultText}\n\n[消耗 token: ${tokenUsage.total}（prompt ${tokenUsage.prompt} + completion ${tokenUsage.completion}）]`
            : resultText,
          tokenUsage,
        } satisfies AsyncTaskOutput,
      });
      await syncSubStatus("completed");
      // 独立子 Agent 实例任务完成 → 自动休眠（#15：无任务+队列空+无心跳 → dormant）
      if (agentSnapshot.tier === "sub" && agentSnapshot.parentId) {
        await services.agent.update({ id: agentSnapshot.id, status: "dormant" } as any).catch(() => {});
      }
      await broadcastShare("success", { asyncResult: resultText, tokenUsage });
    } catch (err: unknown) {
      const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("用户中断"));
      const isTimeout = err instanceof Error && err.message.includes("超时");
      const reason = isTimeout ? "异步任务执行超时" : isAbort ? "异步任务已取消" : undefined;
      const errorText = reason || (err instanceof Error ? err.message : String(err));
      await services.task.update({
        id: jobId,
        status: "failed",
        output: {
          error: errorText,
        } satisfies AsyncTaskOutput,
      });
      // 用户主动停止 → session 置 paused（不覆盖为 failed）；超时/异常 → failed
      await syncSubStatus(isAbort && !isTimeout ? "paused" : "failed");
      // 失败也把原因写入 subagent ChatSession，避免点击进去一片空白
      if (subagentSessionId) {
        try {
          await services.message.create({
            sessionId: subagentSessionId,
            role: "assistant",
            content: `任务未能完成：${errorText}`,
            source: "sub",
          });
        } catch (msgErr) {
          console.warn(`[asyncJobManager] 保存子代理失败消息失败:`, msgErr);
        }
      }
      await broadcastShare("failed", { error: errorText });
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
  /** swarm 协作：结果额外广播到这些会话 */
  shareToSessionIds?: string[];
}): Promise<{ jobId: string; status: "queued" | "running"; message: string; subagentSessionId?: string }> {
  const task = options.task.trim();
  if (!task) throw new Error("task 不能为空");
  if (!options.sessionId) throw new Error("run_async 需要有效 sessionId");

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
    throw new Error(`已达到每会话子代理上限（${limit}），请先停止或等待已有任务完成后再启动新任务。`);
  }

  // 预算检查：避免预算耗尽时还启动后台任务浪费资源
  assertLlmBudget(options.config);

  const taskLabel = options.label?.trim() || task.slice(0, 80);

  // #3 子代理独立 Agent 实例：spawn 时创建 tier=sub 的独立 Agent（不复用父 Agent 身份）。
  // 独立实例让 tier 权限、parentId 回报链、tombstone、审计都有正确语义。
  // 创建失败时降级复用父 Agent（保证任务不被阻塞）。
  const parentAgent = await prisma.agent.findUnique({ where: { id: options.agent.id } }).catch(() => null);
  let subAgentId = options.agent.id;
  try {
    const subAgentResult = await options.services.agent.create({
      name: `${taskLabel.slice(0, 40)} 子代理`,
      description: `由 ${parentAgent?.name ?? options.agent.id} 派生的子代理（任务：${taskLabel.slice(0, 60)}）`,
      model: options.agent.model,
      systemPrompt: options.agent.systemPrompt,
      tools: options.agent.tools,
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

  const agentSnapshot = {
    id: subAgentId,
    model: options.agent.model,
    systemPrompt: options.agent.systemPrompt,
    tools: options.agent.tools,
    tier: "sub",
    parentId: options.agent.id,
    workspaceId: parentAgent?.workspaceId ?? null,
  };

  // 创建 subagent ChatSession 作为任务的可视化载体（Phase 3 UI 显示卡片）
  // 初始状态：queued（若 orchestrator 无空闲槽位）或 running（立即执行）
  let subagentSessionId: string | undefined;
  const orchestrator = getAsyncJobOrchestrator(options.config);
  const stats = orchestrator.getStats();
  const willQueue = stats.runningGlobal >= stats.limits.maxGlobal;
  const initialStatus = willQueue ? "queued" : "running";
  try {
    const sub = await options.services.session.create({
      title: taskLabel.slice(0, 60),
      model: agentSnapshot.model,
      systemPrompt: agentSnapshot.systemPrompt,
      agentId: subAgentId, // 指向独立子 Agent 实例
      parentSessionId: options.sessionId,
      kind: "subagent",
      taskDescription: task,
      status: initialStatus,
    } as any);
    if (sub.success && sub.data) subagentSessionId = (sub.data as { id: string }).id;
  } catch (err) {
    // subagent session 创建失败不阻塞任务执行，但记录日志便于排查 UI 卡片缺失
    console.warn(`[asyncJobManager] 创建 subagent session 失败，降级为无可视化载体继续执行:`, err);
  }

  const created = await options.services.task.create({
    name: `[async] ${taskLabel}`,
    type: "oneshot",
    status: willQueue ? "queued" : "running",
    sessionId: options.sessionId,
    input: {
      kind: ASYNC_KIND,
      sessionId: options.sessionId,
      task,
      taskLabel,
      agentSnapshot,
      retryCount: 0,
      timeoutMs: options.timeoutMs,
      subagentSessionId,
      shareToSessionIds: options.shareToSessionIds?.length ? options.shareToSessionIds : undefined,
    } satisfies AsyncTaskInput,
  } as any);

  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "创建异步任务失败");
  }

  const jobId = (created.data as { id: string }).id;

  orchestrator.enqueue({
    jobId,
    sessionId: options.sessionId,
    timeoutMs: options.timeoutMs,
    metadata: subagentSessionId ? { subagentSessionId } : undefined,
    execute: buildAsyncExecute(options.config, options.services, jobId, task, agentSnapshot, 0, subagentSessionId, options.shareToSessionIds),
  });

  return {
    jobId,
    status: willQueue ? "queued" : "running",
    subagentSessionId,
    message: willQueue
      ? `已排队后台任务「${taskLabel}」（并发槽位已满，将在前序任务完成后执行）。`
      : `已启动后台任务「${taskLabel}」。你可以继续对话；完成后结果会进入发送队列最前。`,
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
  };

  const created = await options.services.task.create({
    name: `[async] ${taskLabel}`,
    type: "oneshot",
    status: "queued",
    sessionId: options.sessionId,
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
        await options.services.task.update({ id: jobId, status: "running" } as any);
      } catch {
        /* 状态回写失败不阻塞 */
      }
      await waitMs(ms);
      if (signal.aborted) return;
      await options.services.task.update({
        id: jobId,
        status: "success",
        output: { asyncResult: `已等待 ${seconds} 秒（定时器到期）` } satisfies AsyncTaskOutput,
      } as any);
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

/** 查询单个异步任务状态（含 subagent session 与已执行时长） */
export async function getAsyncJobStatus(
  jobId: string,
  config: AppConfig,
  services: ServiceContainer,
): Promise<{
  jobId: string;
  status: string;
  taskLabel?: string;
  elapsedMs?: number;
  error?: string;
  asyncResult?: string;
  subagentSessionId?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
  timeoutMs?: number;
}> {
  const task = await services.task.getById(jobId);
  if (!task) return { jobId, status: "not_found" };
  const input = parseAsyncInput(task.input);
  const orchestrator = getAsyncJobOrchestrator(config);
  const running = orchestrator.isRunning(jobId);
  const queued = orchestrator.isQueued(jobId);
  const status = running ? "running" : queued ? "queued" : task.status === "success" ? "completed" : task.status === "failed" ? "failed" : task.status;
  const output = parseAsyncOutput(task.output);
  return {
    jobId,
    status,
    taskLabel: input?.taskLabel,
    elapsedMs: running || task.status === "running" ? Date.now() - (task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime()) : undefined,
    error: output.error,
    asyncResult: output.asyncResult,
    subagentSessionId: input?.subagentSessionId,
    tokenUsage: output.tokenUsage,
    timeoutMs: input?.timeoutMs ?? config.asyncJobs.taskTimeoutMs,
  };
}

/** 列出某会话的全部异步任务状态 */
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
 * 阻塞等待一个异步任务结束，返回最终结果（用于 run_async(waitForResult) / await_async）。
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
  return orchestrator.stopSubagent(subagentSessionId);
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
