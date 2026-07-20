/**
 * C1 僵尸 running Task / 心跳生命周期 — 负向断言
 *
 * 旧实现：recoverStaleAsyncJobs 只扫 [async]/async_agent；心跳/cron/trigger 僵尸永久 running
 * → 重叠闸每轮跳过、静默停摆。池拒绝后已建 running 行无人收尾。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { recoverStaleAsyncJobs } from "../infra/asyncJobManager.js";
import {
  getAsyncJobOrchestrator,
  resetAsyncJobOrchestratorForTests,
} from "../infra/asyncJobOrchestrator.js";
import { getHeartbeatEngine, resetHeartbeatEngineForTests } from "../infra/heartbeatEngine.js";
import { resetSwarmOrchestratorForTests } from "../infra/swarmOrchestrator.js";
import { claimExclusiveSessionTaskRun } from "../infra/taskClaim.js";
import { setStreamHub } from "../infra/sessionStreamHub.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

const RUN = `c1hb-${Date.now().toString(36)}`;

describe("C1 执行型僵尸 Task 恢复扫描", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
    resetSwarmOrchestratorForTests();
    setStreamHub(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetHeartbeatEngineForTests();
    resetAsyncJobOrchestratorForTests();
    resetSwarmOrchestratorForTests();
    setStreamHub(null);
    await prisma.task.deleteMany({ where: { name: { contains: RUN } } });
  });

  it("心跳/cron/trigger（oneshot）僵尸 running → 恢复标 failed，心跳不再被闸跳过", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `C1-Agent-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "C1 恢复验证" } as any,
    });
    if (!agent.success) throw new Error(agent.error?.message);
    const agentId = (agent.data as { id: string }).id;

    const session = await prisma.chatSession.create({
      data: {
        title: `C1-hb-${RUN}`,
        model: "deepseek-chat",
        agentId,
        kind: "heartbeat",
        isMainSession: false,
        status: "active",
      },
    });

    const hbZombie = await prisma.task.create({
      data: {
        name: `[heartbeat] C1-Agent-${RUN}`,
        type: "oneshot",
        status: "running",
        sessionId: session.id,
        startedAt: new Date(),
        reentrant: false,
        input: { kind: "heartbeat", agentId, sessionId: session.id, goal: "x" },
      },
    });
    const cronZombie = await prisma.task.create({
      data: {
        name: `C1-cron-${RUN}`,
        type: "cron",
        status: "running",
        cronExpression: "0 * * * *",
        startedAt: new Date(),
        reentrant: false,
        input: { action: "noop" },
      },
    });
    const triggerZombie = await prisma.task.create({
      data: {
        name: `C1-trigger-${RUN}`,
        type: "oneshot",
        status: "running",
        startedAt: new Date(),
        reentrant: false,
        input: { triggerEvent: { entity: "post", action: "created" } },
      },
    });

    const config = createTestConfig(ctx.config.projectRoot, {
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 2, maxQueued: 10 },
    });
    const { failed, resumed } = await recoverStaleAsyncJobs(config, ctx.services);
    expect(resumed).toBe(0);
    expect(failed).toBeGreaterThanOrEqual(3);

    for (const id of [hbZombie.id, cronZombie.id, triggerZombie.id]) {
      const row = await prisma.task.findUnique({ where: { id } });
      expect(row?.status).toBe("failed");
      expect((row?.output as { error?: string } | null)?.error).toBe("服务重启，任务中断");
    }

    // 僵尸已收尾 → 下次心跳不再被 running 闸跳过（能创建并起跑）
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "ok",
      toolCalls: [],
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
      model: "deepseek-chat",
      provider: "deepseek",
      roundsUsed: 1,
    } as any);

    const hbConfig = { ...ctx.config, llm: { ...ctx.config.llm, dailyBudget: 0 } };
    const engine = getHeartbeatEngine(prisma, ctx.services, hbConfig);
    await engine.start();
    await engine.triggerHeartbeat(agentId);

    await vi.waitFor(async () => {
      const success = await prisma.task.findFirst({
        where: {
          sessionId: session.id,
          name: { startsWith: "[heartbeat]" },
          status: "success",
          id: { not: hbZombie.id },
        },
      });
      expect(success).not.toBeNull();
    });

    await prisma.chatSession.deleteMany({ where: { id: session.id } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
  });

  it("池准入拒绝 → 已建心跳 Task 收尾 failed「队列满」并计入失败 streak", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `C1-Queue-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "C1 队列满" } as any,
    });
    if (!agent.success) throw new Error(agent.error?.message);
    const agentId = (agent.data as { id: string }).id;

    // maxQueued=1：先占满 running 槽，再占满排队位，使后续 enqueue 抛「队列已满」
    resetAsyncJobOrchestratorForTests();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1, maxQueued: 1, maxPerSession: 1 },
      llm: { ...ctx.config.llm, dailyBudget: 0 },
    });
    const pool = getAsyncJobOrchestrator(narrow);
    pool.enqueue({
      jobId: `blocker-${RUN}`,
      sessionId: `blocker-sess-${RUN}`,
      execute: async () => {
        await new Promise(() => {
          /* never settle */
        });
      },
    });
    pool.enqueue({
      jobId: `queued-${RUN}`,
      sessionId: `queued-sess-${RUN}`,
      execute: async () => {},
    });
    let saturated = false;
    try {
      pool.enqueue({
        jobId: `probe-${RUN}`,
        sessionId: `probe-sess-${RUN}`,
        execute: async () => {},
      });
    } catch {
      saturated = true;
    }
    expect(saturated).toBe(true);

    // 复用已饱和的 orchestrator 单例（getAsyncJobOrchestrator 首次 config 生效）
    const engine = getHeartbeatEngine(prisma, ctx.services, narrow);
    await engine.triggerHeartbeat(agentId);

    await vi.waitFor(async () => {
      const row = await prisma.task.findFirst({
        where: { name: `[heartbeat] C1-Queue-${RUN}` },
        orderBy: { createdAt: "desc" },
      });
      expect(row?.status).toBe("failed");
      expect((row?.output as { error?: string } | null)?.error).toBe("队列满");
    });

    const hbRow = await prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } });
    const streak = (hbRow?.heartbeat as { consecutiveFailures?: number } | null)?.consecutiveFailures ?? 0;
    expect(streak).toBeGreaterThanOrEqual(1);

    await prisma.task.deleteMany({ where: { name: { contains: "C1-Queue" } } });
    await prisma.chatSession.deleteMany({ where: { agentId } });
    await prisma.agent.deleteMany({ where: { id: agentId } });
  });

  it("重叠闸并发双触发 → 恰一个 claimed running", async () => {
    const session = await prisma.chatSession.create({
      data: {
        title: `C1-claim-${RUN}`,
        model: "deepseek-chat",
        kind: "heartbeat",
        isMainSession: false,
        status: "active",
      },
    });
    const a = await prisma.task.create({
      data: {
        name: `[heartbeat] claim-a-${RUN}`,
        type: "oneshot",
        status: "queued",
        sessionId: session.id,
        input: { kind: "heartbeat" },
      },
    });
    const b = await prisma.task.create({
      data: {
        name: `[heartbeat] claim-b-${RUN}`,
        type: "oneshot",
        status: "queued",
        sessionId: session.id,
        input: { kind: "heartbeat" },
      },
    });

    const [ca, cb] = await Promise.all([
      claimExclusiveSessionTaskRun(prisma, a.id, session.id),
      claimExclusiveSessionTaskRun(prisma, b.id, session.id),
    ]);
    expect([ca, cb].filter(Boolean)).toHaveLength(1);

    const rows = await prisma.task.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.filter((r) => r.status === "running")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "queued")).toHaveLength(1);

    await prisma.task.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await prisma.chatSession.delete({ where: { id: session.id } });
  });
});
