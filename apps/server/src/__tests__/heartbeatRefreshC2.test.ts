/**
 * C2 HeartbeatEngine.refresh 串行化 — 负向断言
 *
 * 旧实现：jobs.clear() 与重新 cron.schedule 之间隔着 await DB；交叠 refresh
 * 各自注册同一 agent，jobs.set 互相覆盖 → 先注册的 ScheduledTask 永远摘不掉 → 双发。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import cron from "node-cron";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { getHeartbeatEngine, resetHeartbeatEngineForTests } from "../infra/heartbeatEngine.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { resetSwarmOrchestratorForTests } from "../infra/swarmOrchestrator.js";
import { setStreamHub } from "../infra/sessionStreamHub.js";

const RUN = `c2rf-${Date.now().toString(36)}`;

describe("C2 refresh 串行链 + generation 令牌", () => {
  beforeEach(() => {
    resetHeartbeatEngineForTests();
    resetAsyncJobOrchestratorForTests();
    resetSwarmOrchestratorForTests();
    setStreamHub(null);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetHeartbeatEngineForTests();
    await prisma.agent.deleteMany({ where: { name: { contains: RUN } } });
  });

  it("并发两次 refresh（人工注入交错点）→ 每个 agent 只有一个活跃 ScheduledTask", async () => {
    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `C2-Agent-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "C2 双发防护" } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;

    let agentCronLive = 0;
    vi.spyOn(cron, "schedule").mockImplementation(((expression: string) => {
      const isAgentCron = expression === "0 9 * * *";
      if (isAgentCron) agentCronLive++;
      return {
        stop: () => {
          if (isAgentCron) agentCronLive = Math.max(0, agentCronLive - 1);
        },
        start: () => {},
      } as unknown as ReturnType<typeof cron.schedule>;
    }) as typeof cron.schedule);

    const engine = getHeartbeatEngine(prisma, ctx.services, {
      ...ctx.config,
      llm: { ...ctx.config.llm, dailyBudget: 0 },
    });

    // 先无钩子完成 start
    await engine.start();
    expect(engine.__getJobCountForTests()).toBe(1);
    expect(agentCronLive).toBe(1);

    let releaseA: (() => void) | null = null;
    let yieldHits = 0;
    engine.__setRefreshYieldForTests(
      () =>
        new Promise<void>((resolve) => {
          yieldHits++;
          // 仅挂起「第一条 refresh」的第一次 yield，制造与第二条的交叠窗口
          if (yieldHits === 1) {
            releaseA = resolve;
            return;
          }
          resolve();
        }),
    );

    const p1 = engine.refresh();
    await vi.waitFor(() => {
      expect(releaseA).not.toBeNull();
    });
    const p2 = engine.refresh();
    releaseA!();
    await Promise.all([p1, p2]);

    expect(agentCronLive).toBe(1);
    expect(engine.__getJobCountForTests()).toBe(1);
    void agentId;
  });

  it("start→stop→start 交错无泄漏 cron job", async () => {
    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `C2-SS-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 10 * * *", goal: "C2 stop 交错" } as any,
    });
    if (!created.success) throw new Error(created.error?.message);

    let agentCronLive = 0;
    vi.spyOn(cron, "schedule").mockImplementation(((expression: string) => {
      const isAgent = expression === "0 10 * * *";
      if (isAgent) agentCronLive++;
      return {
        stop: () => {
          if (isAgent) agentCronLive = Math.max(0, agentCronLive - 1);
        },
        start: () => {},
      } as unknown as ReturnType<typeof cron.schedule>;
    }) as typeof cron.schedule);

    const engine = getHeartbeatEngine(prisma, ctx.services, {
      ...ctx.config,
      llm: { ...ctx.config.llm, dailyBudget: 0 },
    });

    let release: (() => void) | null = null;
    engine.__setRefreshYieldForTests(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const startP = engine.start();
    await vi.waitFor(() => {
      expect(release).not.toBeNull();
    });
    // 在首次 refresh 挂起期间 stop，再 start
    engine.stop();
    engine.__setRefreshYieldForTests(null);
    release!();
    await startP.catch(() => undefined);

    await engine.start();
    await vi.waitFor(() => {
      expect(engine.__getJobCountForTests()).toBe(1);
    });
    expect(agentCronLive).toBe(1);
  });
});
