import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { createContextInner } from "../trpc/context.js";
import {
  listRunningAsyncJobs,
  pullAsyncDeliveries,
  recoverStaleAsyncJobs,
  cleanupDeliveredAsyncJobs,
  cancelAsyncJob,
  retryAsyncJob,
  startAsyncAgentTask,
} from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

const ASYNC_KIND = "async_agent";
const sessionId = "cltestasyncjobsession001";

async function createAsyncTask(data: {
  status: "running" | "success" | "failed";
  taskLabel: string;
  delivered?: boolean;
  asyncResult?: string;
  error?: string;
}) {
  return prisma.task.create({
    data: {
      name: `[async] ${data.taskLabel}`,
      type: "oneshot",
      status: data.status,
      sessionId,
      delivered: data.delivered ?? false,
      input: {
        kind: ASYNC_KIND,
        sessionId,
        task: data.taskLabel,
        taskLabel: data.taskLabel,
        agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: [] },
      },
      output:
        data.status === "success"
          ? { asyncResult: data.asyncResult ?? "ok" }
          : data.status === "failed"
            ? { error: data.error ?? "fail" }
            : undefined,
    },
  });
}

async function cleanupTestTasks() {
  const rows = await prisma.task.findMany({ select: { id: true, input: true } });
  const ids = rows
    .filter((r) => (r.input as { sessionId?: string })?.sessionId === sessionId)
    .map((r) => r.id);
  if (ids.length) await prisma.task.deleteMany({ where: { id: { in: ids } } });
}

describe("asyncJobManager 持久化", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  afterEach(async () => {
    await cleanupTestTasks();
  });

  it("listRunningAsyncJobs 按 sessionId 过滤", async () => {
    await createAsyncTask({ status: "running", taskLabel: "运行中 A" });
    const jobs = await listRunningAsyncJobs(sessionId);
    expect(jobs.some((j) => j.taskLabel === "运行中 A")).toBe(true);
  });

  it("pullAsyncDeliveries 拉取 success 并标记 delivered", async () => {
    const task = await createAsyncTask({
      status: "success",
      taskLabel: "已完成 B",
      asyncResult: "结果文本",
    });

    const first = await pullAsyncDeliveries(sessionId);
    expect(first).toHaveLength(1);
    expect(first[0].jobId).toBe(task.id);
    expect(first[0].asyncResult).toBe("结果文本");

    const second = await pullAsyncDeliveries(sessionId);
    expect(second).toHaveLength(0);

    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.delivered).toBe(true);
  });

  it("recoverStaleAsyncJobs 仅处理 async_agent，忽略普通 running Task", async () => {
    const asyncTask = await createAsyncTask({ status: "running", taskLabel: "中断 C" });
    const cronLike = await prisma.task.create({
      data: {
        name: "daily-sync",
        type: "cron",
        status: "running",
        input: { type: "cron" },
      },
    });

    const n = await recoverStaleAsyncJobs();
    expect(n).toBeGreaterThanOrEqual(1);

    const asyncRow = await prisma.task.findUnique({ where: { id: asyncTask.id } });
    expect(asyncRow?.status).toBe("failed");

    const cronRow = await prisma.task.findUnique({ where: { id: cronLike.id } });
    expect(cronRow?.status).toBe("running");

    await prisma.task.delete({ where: { id: cronLike.id } });
  });

  it("startAsyncAgentTask：mock LLM 完成 → pullAsyncDeliveries 可投递", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "P1 集成测试异步结果",
      toolCalls: [],
      tokenUsage: { prompt: 1, completion: 2, total: 3 },
      model: "deepseek-chat",
      provider: "deepseek",
      roundsUsed: 1,
    });

    const ctx = await createContextInner();
    const started = await startAsyncAgentTask({
      sessionId,
      task: "分析 content/agents 目录结构",
      label: "P1 集成测",
      config: ctx.config,
      services: ctx.services,
      agent: { id: "t", model: "deepseek-chat", systemPrompt: "test", tools: [] },
    });

    expect(started.status).toBe("running");
    expect(started.jobId).toBeTruthy();

    await vi.waitFor(
      async () => {
        const row = await prisma.task.findUnique({ where: { id: started.jobId } });
        expect(row?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );

    const running = await listRunningAsyncJobs(sessionId);
    expect(running.some((j) => j.jobId === started.jobId)).toBe(false);

    const deliveries = await pullAsyncDeliveries(sessionId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].jobId).toBe(started.jobId);
    expect(deliveries[0].asyncResult).toContain("P1 集成测试");

    vi.restoreAllMocks();
  });

  it("cleanupDeliveredAsyncJobs 删除已投递且过期的任务", async () => {
    const task = await createAsyncTask({ status: "success", taskLabel: "过期 D", asyncResult: "ok", delivered: true });
    await prisma.task.update({
      where: { id: task.id },
      data: { deliveredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    const n = await cleanupDeliveredAsyncJobs();
    expect(n).toBeGreaterThanOrEqual(1);

    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row).toBeNull();
  });

  it("retryAsyncJob 复制失败任务并重新执行", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "重试成功结果",
      toolCalls: [],
      tokenUsage: { prompt: 1, completion: 2, total: 3 },
      model: "deepseek-chat",
      provider: "deepseek",
      roundsUsed: 1,
    });

    const ctx = await createContextInner();
    const first = await startAsyncAgentTask({
      sessionId,
      task: "测试",
      label: "重试源",
      config: ctx.config,
      services: ctx.services,
      agent: { id: "t", model: "deepseek-chat", systemPrompt: "test", tools: [] },
    });

    await vi.waitFor(
      async () => {
        const row = await prisma.task.findUnique({ where: { id: first.jobId } });
        expect(row?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );

    await prisma.task.update({ where: { id: first.jobId }, data: { status: "failed", output: { error: "手动失败" } } });

    const retried = await retryAsyncJob(first.jobId, ctx.config, ctx.services);
    expect(retried.status).toBe("running");
    expect(retried.message).toContain("第 1 次重试");

    await vi.waitFor(
      async () => {
        const row = await prisma.task.findUnique({ where: { id: retried.jobId } });
        expect(row?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );

    vi.restoreAllMocks();
  });

  it("cancelAsyncJob 取消排队中的任务并回写失败状态", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ content: "慢任务", toolCalls: [], tokenUsage: { prompt: 1, completion: 2, total: 3 }, model: "m", provider: "p", roundsUsed: 1 }), 5000)),
    );

    const ctx = await createContextInner();
    const narrowConfig = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { maxConcurrent: 1, maxPerSession: 1, taskTimeoutMs: 60_000 },
    });

    const first = await startAsyncAgentTask({
      sessionId,
      task: "慢任务 A",
      label: "A",
      config: narrowConfig,
      services: ctx.services,
      agent: { id: "t", model: "m", systemPrompt: "test", tools: [] },
    });

    const queued = await startAsyncAgentTask({
      sessionId,
      task: "排队任务 B",
      label: "B",
      config: narrowConfig,
      services: ctx.services,
      agent: { id: "t", model: "m", systemPrompt: "test", tools: [] },
    });

    // first 在运行，queued 在队列
    const runningBefore = await listRunningAsyncJobs(sessionId);
    expect(runningBefore.some((j) => j.jobId === first.jobId)).toBe(true);

    const cancelled = await cancelAsyncJob(queued.jobId, narrowConfig, ctx.services);
    expect(cancelled.cancelled).toBe(true);

    const queuedRow = await prisma.task.findUnique({ where: { id: queued.jobId } });
    expect(queuedRow?.status).toBe("failed");
    expect((queuedRow?.output as { error?: string })?.error).toContain("已取消");

    // 清理运行中任务
    await cancelAsyncJob(first.jobId, narrowConfig, ctx.services);
    vi.restoreAllMocks();
  });

  it("retryAsyncJob 超过最大重试次数时报错", async () => {
    const task = await createAsyncTask({ status: "failed", taskLabel: "超限", error: "fail" });
    await prisma.task.update({
      where: { id: task.id },
      data: { input: { kind: ASYNC_KIND, sessionId, task: "超限", taskLabel: "超限", agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: [] }, retryCount: 3 } },
    });

    const ctx = await createContextInner();
    await expect(retryAsyncJob(task.id, ctx.config, ctx.services)).rejects.toThrow(/最多只能重试/);
  });
});
