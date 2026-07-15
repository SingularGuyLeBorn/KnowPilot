/**
 * Async Task Queue — Phase 5 单元测试
 *
 * 覆盖 async_task_run（纯工具）/ async_task_status 原生工具协议，
 * 以及 agent.pullAsyncQueue 返回结构。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
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

/** W-D 后 async_task_run 只接纯工具任务：统一用 native:wait 做无害执行体 */
const WAIT_TOOL_CALL = { tool: "wait", args: { ms: 30 } };
const SNAPSHOT_TOOLS = ["native:wait"];

describe("async-task-queue 工具协议", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("async_task_run 启动纯工具任务并返回 running 状态", async () => {
    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);

    try {
      const result = (await executeNativeTool(
        "async_task_run",
        { task: "结构分析", label: "结构分析", toolCall: WAIT_TOOL_CALL },
        {
          ...toolCtx,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: SNAPSHOT_TOOLS },
        },
      )) as { jobId: string; status: string; message: string; sourceType: string };

      expect(result.status).toMatch(/running|queued/);
      expect(result.jobId).toBeTruthy();
      expect(result.sourceType).toBe("async_task_tool");

      await vi.waitFor(
        async () => {
          const row = await prisma.task.findUnique({ where: { id: result.jobId } });
          expect(row?.status).toBe("success");
        },
        { timeout: 5000, interval: 50 },
      );

      const deliveries = await pullAsyncDeliveries(sessionId);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].asyncResult).toContain("waitedMs");
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });

  it("async_task_run 缺 toolCall 直接报错（W-D：不再有 mode=llm 兜底）", async () => {
    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);

    try {
      await expect(
        executeNativeTool(
          "async_task_run",
          { task: "没有工具调用的任务", label: "旧 llm 用法" },
          {
            ...toolCtx,
            sessionId,
            agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] },
          },
        ),
      ).rejects.toThrow(/toolCall/);
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });

  it("async_task_wait 已从注册表移除（W-C）", async () => {
    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);

    try {
      await expect(
        executeNativeTool(
          "async_task_wait",
          { jobId: "whatever" },
          {
            ...toolCtx,
            sessionId,
            agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] },
          },
        ),
      ).rejects.toThrow(/未知原生工具/);
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });

  it("async_task_status 查询单个任务（W-B：终态也不回全文/日志）", async () => {
    const ctx = await createContextInner();
    const toolCtx = { ...ctx, invokeTrpc: async () => ({ ok: true }) };
    const session = await ctx.services.session.create({ title: "父会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    const parentAgentId = await createParentAgent(ctx);

    try {
      const started = (await executeNativeTool(
        "async_task_run",
        { task: "慢任务", label: "慢任务", toolCall: { tool: "wait", args: { ms: 200 } } },
        {
          ...toolCtx,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: SNAPSHOT_TOOLS },
        },
      )) as { jobId: string; status: string };

      const status = (await executeNativeTool(
        "async_task_status",
        { jobId: started.jobId },
        { ...toolCtx, sessionId, agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] } },
      )) as Record<string, unknown>;

      expect(status.jobId).toBe(started.jobId);
      expect(["running", "queued"]).toContain(status.status as string);

      // 等任务结束后再次查询：W-B 负向断言——返回里不得携带结果全文与日志
      await vi.waitFor(
        async () => {
          const row = await prisma.task.findUnique({ where: { id: started.jobId } });
          expect(row?.status).toBe("success");
        },
        { timeout: 5000, interval: 50 },
      );
      const done = (await executeNativeTool(
        "async_task_status",
        { jobId: started.jobId },
        { ...toolCtx, sessionId, agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] } },
      )) as Record<string, unknown>;
      expect(done.status).toBe("completed");
      expect(done).not.toHaveProperty("asyncResult");
      expect(done).not.toHaveProperty("logs");
      expect(done).not.toHaveProperty("error");
    } finally {
      await cleanupSessionTasks(sessionId, parentAgentId);
    }
  });

  it("pullAsyncQueue 返回 running、queued、deliveries 三类数据", async () => {
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
        { task: "队列 A", label: "队列 A", toolCall: { tool: "wait", args: { ms: 300 } } },
        {
          ...toolCtx,
          config: narrowConfig,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: SNAPSHOT_TOOLS },
        },
      )) as { jobId: string };

      const second = (await executeNativeTool(
        "async_task_run",
        { task: "队列 B", label: "队列 B", toolCall: { tool: "wait", args: { ms: 30 } } },
        {
          ...toolCtx,
          config: narrowConfig,
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: SNAPSHOT_TOOLS },
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
