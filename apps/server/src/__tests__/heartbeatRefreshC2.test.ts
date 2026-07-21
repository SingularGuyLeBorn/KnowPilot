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
/** 测试专用 cron，避开库内其它 Agent 常用的 0 9 / 0 10 */
const CRON_A = "17 7 * * *";
const CRON_B = "19 7 * * *";

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
      heartbeat: { enabled: true, cron: CRON_A, goal: "C2 双发防护" } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;

    const liveByAgent = new Map<string, number>();
    vi.spyOn(cron, "schedule").mockImplementation(((expression: string, _fn: () => void) => {
      // 仅跟踪本用例 Agent 的 cron；维护任务与其它 Agent 不计入
      const track = expression === CRON_A;
      if (track) liveByAgent.set(agentId, (liveByAgent.get(agentId) ?? 0) + 1);
      return {
        stop: () => {
          if (track) liveByAgent.set(agentId, Math.max(0, (liveByAgent.get(agentId) ?? 0) - 1));
        },
        start: () => {},
      } as unknown as ReturnType<typeof cron.schedule>;
    }) as typeof cron.schedule);

    const engine = getHeartbeatEngine(prisma, ctx.services, {
      ...ctx.config,
      llm: { ...ctx.config.llm, dailyBudget: 0 },
    });

    await engine.start();
    expect(liveByAgent.get(agentId)).toBe(1);

    let releaseA: (() => void) | null = null;
    let yieldHits = 0;
    engine.__setRefreshYieldForTests(
      () =>
        new Promise<void>((resolve) => {
          yieldHits++;
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

    expect(liveByAgent.get(agentId)).toBe(1);
  });

  it("start→stop→start 交错无泄漏 cron job", async () => {
    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `C2-SS-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: CRON_B, goal: "C2 stop 交错" } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;

    let agentCronLive = 0;
    vi.spyOn(cron, "schedule").mockImplementation(((expression: string) => {
      const isAgent = expression === CRON_B;
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
    engine.stop();
    engine.__setRefreshYieldForTests(null);
    release!();
    await startP.catch(() => undefined);

    await engine.start();
    await vi.waitFor(() => {
      expect(agentCronLive).toBe(1);
    });
    void agentId;
  });
});
