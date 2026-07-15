/**
 * Async Task Queue — Phase 5 单元测试
 *
 * 覆盖 async_task_run（纯工具）/ async_task_status 原生工具协议，
 * 以及 agent.pullAsyncQueue 返回结构。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { appRouter } from "../router.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import {
  pullAsyncDeliveries,
  pullConsumedAsyncDeliveries,
  listRunningAsyncJobs,
  listQueuedAsyncJobs,
  listSyncAsyncJobs,
} from "../infra/asyncJobManager.js";
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
      // orchestrator finally 清 runningJobs 与 DB success 落库存在极小窗口，轮询至一致（消除既有竞态 flake）
      let done: Record<string, unknown> | undefined;
      await vi.waitFor(
        async () => {
          done = (await executeNativeTool(
            "async_task_status",
            { jobId: started.jobId },
            { ...toolCtx, sessionId, agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [] } },
          )) as Record<string, unknown>;
          expect(done.status).toBe("completed");
        },
        { timeout: 5000, interval: 50 },
      );
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

/** W-A 同步任务通道：deliverToQueue=false 的 Task 不进异步队列，单独走 listSyncAsyncJobs 展示 */
describe("W-A 同步任务通道", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  async function seedAsyncRow(opts: {
    sessionId: string;
    taskLabel: string;
    status: string;
    deliverToQueue: boolean;
    delivered?: boolean;
    asyncResult?: string;
  }) {
    return prisma.task.create({
      data: {
        name: `[async] ${opts.taskLabel}`,
        type: "async_agent",
        status: opts.status,
        sessionId: opts.sessionId,
        delivered: opts.delivered ?? false,
        deliveredAt: opts.delivered ? new Date() : null,
        input: {
          kind: "async_agent",
          sessionId: opts.sessionId,
          task: opts.taskLabel,
          taskLabel: opts.taskLabel,
          agentSnapshot: { id: "test-agent", model: "deepseek-chat", systemPrompt: "test", tools: [] },
          deliverToQueue: opts.deliverToQueue,
        },
        ...(opts.asyncResult !== undefined ? { output: { asyncResult: opts.asyncResult } } : {}),
      },
    });
  }

  it("T1: deliverToQueue=false + success + delivered=false 的 Task 不进 pullAsyncDeliveries", async () => {
    const ctx = await createContextInner();
    const session = await ctx.services.session.create({ title: "T1 会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    try {
      // 窗口复现：sync 任务完成落库到 tool return 标 delivered 之间，delivered 仍为 false
      const syncTask = await seedAsyncRow({
        sessionId,
        taskLabel: "T1 同步任务",
        status: "success",
        deliverToQueue: false,
        asyncResult: "sync result",
      });
      const asyncTask = await seedAsyncRow({
        sessionId,
        taskLabel: "T1 异步对照",
        status: "success",
        deliverToQueue: true,
        asyncResult: "async result",
      });

      const jobIds = (await pullAsyncDeliveries(sessionId)).map((d) => d.jobId);
      expect(jobIds).not.toContain(syncTask.id);
      expect(jobIds).toContain(asyncTask.id);
    } finally {
      await prisma.task.deleteMany({ where: { sessionId } });
    }
  });

  it("T2: deliverToQueue=false + delivered=true 不进 pullConsumedAsyncDeliveries；deliverToQueue=true 对照组含", async () => {
    const ctx = await createContextInner();
    const session = await ctx.services.session.create({ title: "T2 会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    try {
      // sync 任务 tool return 时被标 delivered=true，不属于「已消费」
      const syncTask = await seedAsyncRow({
        sessionId,
        taskLabel: "T2 同步任务",
        status: "success",
        deliverToQueue: false,
        delivered: true,
        asyncResult: "sync result",
      });
      const consumedAsync = await seedAsyncRow({
        sessionId,
        taskLabel: "T2 已消费对照",
        status: "success",
        deliverToQueue: true,
        delivered: true,
        asyncResult: "consumed result",
      });

      const jobIds = (await pullConsumedAsyncDeliveries(sessionId)).map((d) => d.jobId);
      expect(jobIds).not.toContain(syncTask.id);
      expect(jobIds).toContain(consumedAsync.id);
    } finally {
      await prisma.task.deleteMany({ where: { sessionId } });
    }
  });

  it("T3: listSyncAsyncJobs 返回 sync 任务（running + success 各一），异步任务不在其中", async () => {
    const ctx = await createContextInner();
    const session = await ctx.services.session.create({ title: "T3 会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    try {
      const runningSync = await seedAsyncRow({
        sessionId,
        taskLabel: "T3 同步运行中",
        status: "running",
        deliverToQueue: false,
      });
      const doneSync = await seedAsyncRow({
        sessionId,
        taskLabel: "T3 同步完成",
        status: "success",
        deliverToQueue: false,
        asyncResult: "done result",
      });
      const asyncTask = await seedAsyncRow({
        sessionId,
        taskLabel: "T3 异步对照",
        status: "success",
        deliverToQueue: true,
        asyncResult: "async result",
      });

      const items = await listSyncAsyncJobs(sessionId, ctx.config);
      const byId = new Map(items.map((i) => [i.jobId, i]));
      expect(byId.get(runningSync.id)?.status).toBe("running");
      expect(byId.get(doneSync.id)?.status).toBe("completed");
      expect(byId.get(doneSync.id)?.asyncResult).toBe("done result");
      expect(byId.has(asyncTask.id)).toBe(false);
    } finally {
      await prisma.task.deleteMany({ where: { sessionId } });
    }
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  it("P4 防线：子 Agent 提示词不再引导传已删除的 mode=tool 参数", () => {
    // W-D 已删除 async_task_run 的 mode 入参（schema 无此字段、handler 不读 args.mode）；
    // 提示词若仍教 LLM 传 mode=tool 属残留漏网（终审 P4），此处防线防回归。
    const src = readFileSync(path.resolve(__dirname, "../infra/asyncJobManager.ts"), "utf-8");
    expect(src).not.toContain("async_task_run(mode=tool)");
  });

  it("P5 防线：startAsyncAgentTask 不再保留无调用方的 guard 死参数", () => {
    // W-D 删除唯一传参方后 options.guard 恒为 undefined（终审 P5）。
    // 零兼容纪律：死参数不留（dispatch 层 guard 机制本身保留，spawn/trigger/heartbeat 直传）。
    const src = readFileSync(path.resolve(__dirname, "../infra/asyncJobManager.ts"), "utf-8");
    expect(src).not.toMatch(/guard:\s*options\.guard/);
    expect(src).not.toMatch(/guard\?:\s*SwarmTaskSpec\["guard"\]/);
  });

  it("T4: agent.pullAsyncQueue caller 返回含 syncTasks 数组", async () => {
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const session = await ctx.services.session.create({ title: "T4 会话", model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;
    try {
      const syncTask = await seedAsyncRow({
        sessionId,
        taskLabel: "T4 同步完成",
        status: "success",
        deliverToQueue: false,
        asyncResult: "sync result",
      });

      const res = await caller.agent.pullAsyncQueue({ sessionId });
      expect(Array.isArray(res.syncTasks)).toBe(true);
      expect(res.syncTasks.map((t: { jobId: string }) => t.jobId)).toContain(syncTask.id);
    } finally {
      await prisma.task.deleteMany({ where: { sessionId } });
    }
  });
});
