/**
 * Async Task Queue — Phase 5 单元测试
 *
 * 覆盖 async_task_run / async_task_status / async_task_wait 原生工具协议，
 * 以及 agent.pullAsyncQueue 返回结构。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import { pullAsyncDeliveries, listRunningAsyncJobs, listQueuedAsyncJobs } from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

async function cleanupSessionTasks(sessionId: string, parentAgentId: string) {
  await prisma.task.deleteMany({ where: { sessionId } });
  await prisma.chatSession.deleteMany({ where: { parentSessionId: sessionId } });
  await prisma.agent.deleteMany({ where: { parentId: parentAgentId } });
  await prisma.agent.deleteMany({ where: { id: parentAgentId } });
}

async function createParentAgent(ctx: Awaited<ReturnType<typeof createContextInner>>) {
  const result = await ctx.services.agent.create({
    name: `异步队列父 Agent ${Date.now()}`,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [],
    tier: "manager",
  });
  if (!result.success) {
    throw new Error(`创建父 Agent 失败：${result.error?.message}`);
  }
  return (result.data as { id: string }).id;
}

describe("async-task-queue 工具协议", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("async_task_run 启动任务并返回 running 状态", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "后台任务结果",
      toolCalls: [],
      tokenUsage: { prompt: 1, completion: 2, total: 3 },
      model: "deepseek-chat",
      provider: "deepseek",
      roundsUsed: 1,
    });

    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);

    try {
      const result = (await executeNativeTool(
        "async_task_run",
        { task: "分析项目结构", label: "结构分析" },
        {
          ...toolCtx,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] },
        },
      )) as { jobId: string; status: string; message: string };

      expect(result.status).toMatch(/running|queued/);
      expect(result.jobId).toBeTruthy();

      await vi.waitFor(
        async () => {
          const row = await prisma.task.findUnique({ where: { id: result.jobId } });
          expect(row?.status).toBe("success");
        },
        { timeout: 5000, interval: 50 },
      );

      const deliveries = await pullAsyncDeliveries(sessionId);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].asyncResult).toContain("后台任务结果");
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });

  it("async_task_status 查询单个任务", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: "慢任务结果",
                toolCalls: [],
                tokenUsage: { prompt: 1, completion: 2, total: 3 },
                model: "deepseek-chat",
                provider: "deepseek",
                roundsUsed: 1,
              }),
            200,
          ),
        ),
    );

    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);

    try {
      const started = (await executeNativeTool(
        "async_task_run",
        { task: "慢任务", label: "慢任务" },
        {
          ...toolCtx,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] },
        },
      )) as { jobId: string; status: string };

      const status = (await executeNativeTool(
        "async_task_status",
        { jobId: started.jobId },
        { ...toolCtx, sessionId, agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] } },
      )) as { jobId: string; status: string; taskLabel?: string };

      expect(status.jobId).toBe(started.jobId);
      expect(["running", "queued"]).toContain(status.status);
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });

  it("async_task_wait 返回最终结果", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "等待任务结果",
      toolCalls: [],
      tokenUsage: { prompt: 1, completion: 2, total: 3 },
      model: "deepseek-chat",
      provider: "deepseek",
      roundsUsed: 1,
    });

    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);

    try {
      const started = (await executeNativeTool(
        "async_task_run",
        { task: "可等待任务", label: "可等待任务" },
        {
          ...toolCtx,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] },
        },
      )) as { jobId: string; status: string };

      const wait = (await executeNativeTool(
        "async_task_wait",
        { jobId: started.jobId },
        { ...toolCtx, sessionId, agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] } },
      )) as { status?: string; asyncResult?: string; error?: string };

      expect(wait.status).toBe("completed");
      expect(wait.asyncResult).toContain("等待任务结果");
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });

  it("pullAsyncQueue 返回 running、queued、deliveries 三类数据", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: "队列测试结果",
                toolCalls: [],
                tokenUsage: { prompt: 1, completion: 2, total: 3 },
                model: "deepseek-chat",
                provider: "deepseek",
                roundsUsed: 1,
              }),
            300,
          ),
        ),
    );

    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);
    const narrowConfig = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: {
        maxConcurrent: 1,
        maxPerSession: 2,
        taskTimeoutMs: 60_000,
        queuedTimeoutMs: 0,
        maxRetries: 0,
        maxSubagentsPerSession: 10,
      },
    });

    try {
      const first = (await executeNativeTool(
        "async_task_run",
        { task: "队列 A", label: "队列 A" },
        {
          ...toolCtx,
          config: narrowConfig,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] },
        },
      )) as { jobId: string };

      const second = (await executeNativeTool(
        "async_task_run",
        { task: "队列 B", label: "队列 B" },
        {
          ...toolCtx,
          config: narrowConfig,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] },
        },
      )) as { jobId: string };

      // 等待出现一个排队任务，确保 running / queued 两类都可见
      await vi.waitFor(
        async () => {
          const queued = await listQueuedAsyncJobs(sessionId, narrowConfig);
          expect(queued.length).toBe(1);
        },
        { timeout: 2000, interval: 50 },
      );

      const running = await listRunningAsyncJobs(sessionId);
      expect(running.length).toBe(1);
      const allJobIds = [...running.map((j) => j.jobId), ...(await listQueuedAsyncJobs(sessionId, narrowConfig)).map((j) => j.jobId)];
      expect(allJobIds).toContain(first.jobId);
      expect(allJobIds).toContain(second.jobId);

      // 释放槽位让排队任务执行，最终至少有一个结果被投递
      const { cancelAsyncJob } = await import("../infra/asyncJobManager.js");
      if (running.length > 0) {
        await cancelAsyncJob(running[0].jobId, narrowConfig, ctx.services);
      }

      await vi.waitFor(
        async () => {
          const deliveries = await pullAsyncDeliveries(sessionId);
          expect(deliveries.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 5000, interval: 50 },
      );
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });
});
