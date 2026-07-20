/**
 * C4 心跳计数原子化 — 负向断言
 *
 * 旧实现：consecutiveFailures 用触发时旧值 +1，再整 blob 覆写 → 并发丢计数；
 * 在途失败写回旧值+1 会覆盖「配置变更清零」。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { getHeartbeatEngine, resetHeartbeatEngineForTests } from "../infra/heartbeatEngine.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { resetSwarmOrchestratorForTests } from "../infra/swarmOrchestrator.js";
import { setStreamHub } from "../infra/sessionStreamHub.js";

const RUN = `c4ct-${Date.now().toString(36)}`;

async function readStreak(agentId: string): Promise<number> {
  const row = await prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } });
  return (row?.heartbeat as { consecutiveFailures?: number } | null)?.consecutiveFailures ?? 0;
}

async function readHb(agentId: string): Promise<Record<string, unknown>> {
  const row = await prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } });
  return (row?.heartbeat as Record<string, unknown>) ?? {};
}

describe("C4 心跳 consecutiveFailures 原子化", () => {
  beforeEach(() => {
    resetHeartbeatEngineForTests();
    resetAsyncJobOrchestratorForTests();
    resetSwarmOrchestratorForTests();
    setStreamHub(null);
  });

  afterEach(async () => {
    resetHeartbeatEngineForTests();
    await prisma.agent.deleteMany({ where: { name: { contains: RUN } } });
  });

  it("并发两个失败写回 → 计数不丢（0→2）", async () => {
    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `C4-Par-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: {
        enabled: true,
        cron: "0 9 * * *",
        goal: "C4 并发",
        consecutiveFailures: 0,
      } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;

    const engine = getHeartbeatEngine(prisma, ctx.services, {
      ...ctx.config,
      llm: { ...ctx.config.llm, dailyBudget: 0 },
    });

    const prevHb = {
      enabled: true,
      cron: "0 9 * * *",
      goal: "C4 并发",
      lastRunAt: null,
      lastRunStatus: null,
      consecutiveFailures: 0,
    };

    // 旧实现两路都读到 0 再写 1 → 终态 1；原子自增 → 2
    await Promise.all([
      engine.__updateHeartbeatStatusForTests(agentId, "failed", prevHb),
      engine.__updateHeartbeatStatusForTests(agentId, "failed", prevHb),
    ]);
    expect(await readStreak(agentId)).toBe(2);
  });

  it("中途配置变更清零不被在途失败的陈旧 +1 覆写", async () => {
    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `C4-Clr-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: {
        enabled: true,
        cron: "0 9 * * *",
        goal: "C4 清零",
        consecutiveFailures: 3,
      } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;
    expect(await readStreak(agentId)).toBe(3);

    // 模拟配置变更清零（人工修复信号）
    const cleared = await ctx.services.agent.update({
      id: agentId,
      heartbeat: {
        enabled: true,
        cron: "0 11 * * *",
        goal: "C4 清零",
        consecutiveFailures: 3,
      } as any,
    });
    if (!cleared.success) throw new Error(cleared.error?.message);
    expect(await readStreak(agentId)).toBe(0);
    expect((await readHb(agentId)).cron).toBe("0 11 * * *");

    const engine = getHeartbeatEngine(prisma, ctx.services, {
      ...ctx.config,
      llm: { ...ctx.config.llm, dailyBudget: 0 },
    });

    // 在途失败携带清零前的陈旧 prevHb（consecutiveFailures=3）
    // 旧实现会整 blob 写成 4，冲掉 cron=0 11 与清零；新实现 SQL 自增当前值 0→1，保留 cron
    await engine.__updateHeartbeatStatusForTests(agentId, "failed", {
      enabled: true,
      cron: "0 9 * * *",
      goal: "C4 清零",
      lastRunAt: null,
      lastRunStatus: null,
      consecutiveFailures: 3,
    });

    expect(await readStreak(agentId)).toBe(1);
    expect((await readHb(agentId)).cron).toBe("0 11 * * *");
    expect((await readHb(agentId)).goal).toBe("C4 清零");
  });
});
