import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { createContextInner } from "../trpc/context.js";
import {
  listRunningAsyncJobs,
  listQueuedAsyncJobs,
  pullAsyncDeliveries,
  markAsyncDeliveryConsumed,
  recoverStaleAsyncJobs,
  cleanupDeliveredAsyncJobs,
  cancelAsyncJob,
  retryAsyncJob,
  startAsyncAgentTask,
  getAsyncQueueStats,
  autoConsumeAsyncDelivery,
} from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";
import { setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";

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

  it("pullAsyncDeliveries 拉取 success 但不 CLAIM；ack 后才标记 delivered", async () => {
    const task = await createAsyncTask({
      status: "success",
      taskLabel: "已完成 B",
      asyncResult: "结果文本",
    });

    const first = await pullAsyncDeliveries(sessionId);
    expect(first).toHaveLength(1);
    expect(first[0].jobId).toBe(task.id);
    expect(first[0].asyncResult).toBe("结果文本");

    // 推优先语义：pull 只读不 CLAIM，可重复拉取直到前端 ack
    const second = await pullAsyncDeliveries(sessionId);
    expect(second).toHaveLength(1);

    const beforeAck = await prisma.task.findUnique({ where: { id: task.id } });
    expect(beforeAck?.delivered).toBe(false);

    await markAsyncDeliveryConsumed(task.id);
    const third = await pullAsyncDeliveries(sessionId);
    expect(third).toHaveLength(0);

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

    const ctx = await createContextInner();
    const { failed: n } = await recoverStaleAsyncJobs(ctx.config, ctx.services);
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

  it("startAsyncAgentTask 支持 timeoutMs 覆盖全局超时", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockImplementation(async (_opts) => {
      const signal = _opts.signal;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 10_000);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new Error("Aborted"));
          },
          { once: true },
        );
      });
      return {
        content: "不应返回",
        toolCalls: [],
        tokenUsage: { prompt: 1, completion: 2, total: 3 },
        model: "deepseek-chat",
        provider: "deepseek",
        roundsUsed: 1,
      };
    });

    const ctx = await createContextInner();
    const started = await startAsyncAgentTask({
      sessionId,
      task: "慢任务",
      label: "超时测",
      timeoutMs: 100,
      config: ctx.config,
      services: ctx.services,
      agent: { id: "t", model: "deepseek-chat", systemPrompt: "test", tools: [] },
    });

    await vi.waitFor(
      async () => {
        const row = await prisma.task.findUnique({ where: { id: started.jobId } });
        expect(row?.status).toBe("failed");
      },
      { timeout: 3000, interval: 50 },
    );

    const row = await prisma.task.findUnique({ where: { id: started.jobId } });
    expect(row?.status).toBe("failed");
    expect((row?.output as { error?: string })?.error).toBeTruthy();

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
    expect(retried.message).toContain("手动重试");

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
      asyncJobs: { maxPerWorkspace: 0, maxQueued: 100, maxConcurrent: 1, maxPerSession: 1, taskTimeoutMs: 60_000, queuedTimeoutMs: 0, maxRetries: 3, maxSubagentsPerSession: 10 },
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

  it("listQueuedAsyncJobs 返回排队中的任务及位置", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ content: "慢任务", toolCalls: [], tokenUsage: { prompt: 1, completion: 2, total: 3 }, model: "m", provider: "p", roundsUsed: 1 }), 5000)),
    );

    const ctx = await createContextInner();
    const narrowConfig = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { maxPerWorkspace: 0, maxQueued: 100, maxConcurrent: 1, maxPerSession: 2, taskTimeoutMs: 60_000, queuedTimeoutMs: 0, maxRetries: 3, maxSubagentsPerSession: 10 },
    });

    const first = await startAsyncAgentTask({ sessionId, task: "排队测 A", label: "A", config: narrowConfig, services: ctx.services, agent: { id: "t", model: "m", systemPrompt: "test", tools: [] } });
    const second = await startAsyncAgentTask({ sessionId, task: "排队测 B", label: "B", config: narrowConfig, services: ctx.services, agent: { id: "t", model: "m", systemPrompt: "test", tools: [] } });
    const third = await startAsyncAgentTask({ sessionId, task: "排队测 C", label: "C", config: narrowConfig, services: ctx.services, agent: { id: "t", model: "m", systemPrompt: "test", tools: [] } });

    const queued = await listQueuedAsyncJobs(sessionId, narrowConfig);
    expect(queued.map((q) => q.jobId).sort()).toEqual([second.jobId, third.jobId].sort());
    expect(queued.every((q) => q.status === "queued")).toBe(true);
    // TP-3：position/reason 来自 orchestrator 真实统计（maxConcurrent=1 满 → 首个卡住的上限为 global）
    expect(queued.every((q) => q.position !== undefined)).toBe(true);
    expect(queued.every((q) => q.reason === "global")).toBe(true);

    await cancelAsyncJob(first.jobId, narrowConfig, ctx.services);
    await cancelAsyncJob(second.jobId, narrowConfig, ctx.services);
    await cancelAsyncJob(third.jobId, narrowConfig, ctx.services);
    vi.restoreAllMocks();
  });

  it("getAsyncQueueStats 返回队列统计", async () => {
    const ctx = await createContextInner();
    const stats = getAsyncQueueStats(ctx.config);
    expect(stats.maxGlobal).toBeGreaterThanOrEqual(1);
    expect(stats.maxPerSession).toBeGreaterThanOrEqual(1);
    expect(stats.taskTimeoutMs).toBeGreaterThanOrEqual(1);
    expect(typeof stats.queued).toBe("number");
    expect(typeof stats.runningGlobal).toBe("number");
  });

  it("markAsyncDeliveryConsumed：pinned 不可 CLAIM；二次 CLAIM 返回 false", async () => {
    const task = await createAsyncTask({ status: "success", taskLabel: "pin 测", asyncResult: "x" });
    await prisma.task.update({ where: { id: task.id }, data: { pinned: true } });
    expect(await markAsyncDeliveryConsumed(task.id)).toBe(false);

    await prisma.task.update({ where: { id: task.id }, data: { pinned: false } });
    expect(await markAsyncDeliveryConsumed(task.id)).toBe(true);
    expect(await markAsyncDeliveryConsumed(task.id)).toBe(false);
  });

  it("autoConsumeAsyncDelivery：无前端时也能 CLAIM 并启动会话流", async () => {
    const agentStream = await import("../infra/agentStream.js");
    const chatSpy = vi.spyOn(agentStream, "chatAgentStream").mockImplementation(async (_s, _c, input, _inv, emit) => {
      emit({
        type: "done",
        sessionId: input.sessionId!,
        agentId: "agent-auto",
        content: "已消化异步结果",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      });
    });

    const hub = new SessionStreamHub({ ringSize: 50, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 60_000 });
    setStreamHub(hub);

    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `AutoConsume Agent ${Date.now()}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
    });
    const agentId = (agent.data as { id: string }).id;
    const session = await ctx.services.session.create({
      title: "auto-consume 父会话",
      model: "deepseek-chat",
      agentId,
    });
    const sid = (session.data as { id: string }).id;

    const task = await prisma.task.create({
      data: {
        name: "[async] 后台 sleep",
        type: "async_agent",
        status: "success",
        sessionId: sid,
        delivered: false,
        input: {
          kind: ASYNC_KIND,
          sessionId: sid,
          task: "sleep",
          taskLabel: "后台 sleep",
          agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [] },
          sourceType: "sleep",
        },
        output: { asyncResult: "已等待 1 秒（定时器到期）" },
      },
    });

    try {
      const result = await autoConsumeAsyncDelivery({
        sessionId: sid,
        jobId: task.id,
        status: "done",
        taskLabel: "后台 sleep",
        services: ctx.services,
        config: ctx.config,
      });
      expect(result).toBe("started");

      await vi.waitFor(
        async () => {
          const row = await prisma.task.findUnique({ where: { id: task.id } });
          expect(row?.delivered).toBe(true);
          expect(chatSpy).toHaveBeenCalled();
        },
        { timeout: 5000, interval: 50 },
      );

      expect(await markAsyncDeliveryConsumed(task.id)).toBe(false);
      expect(await pullAsyncDeliveries(sid)).toHaveLength(0);

      const pinned = await prisma.task.create({
        data: {
          name: "[async] pinned",
          type: "async_agent",
          status: "success",
          sessionId: sid,
          delivered: false,
          pinned: true,
          input: {
            kind: ASYNC_KIND,
            sessionId: sid,
            task: "p",
            taskLabel: "pinned",
            agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [] },
          },
          output: { asyncResult: "pin" },
        },
      });
      expect(
        await autoConsumeAsyncDelivery({
          sessionId: sid,
          jobId: pinned.id,
          status: "done",
          taskLabel: "pinned",
          services: ctx.services,
          config: ctx.config,
        }),
      ).toBe("skipped");
    } finally {
      setStreamHub(null);
      chatSpy.mockRestore();
      await prisma.task.deleteMany({ where: { sessionId: sid } });
      await prisma.chatMessage.deleteMany({ where: { sessionId: sid } }).catch(() => {});
      await prisma.chatSession.delete({ where: { id: sid } }).catch(() => {});
      await ctx.services.agent.delete(agentId).catch(() => {});
    }
  });
});
