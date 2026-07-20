/**
 * W2 心跳决策层 — 引擎集成
 *
 * 覆盖：退避导致 dispatch 递减、terminal 后 suspendedAt、gate 通知冷却。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { getHeartbeatEngine, resetHeartbeatEngineForTests } from "../infra/heartbeatEngine.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { resetSwarmOrchestratorForTests } from "../infra/swarmOrchestrator.js";
import { setStreamHub } from "../infra/sessionStreamHub.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import * as emailNotifier from "../infra/emailNotifier.js";
import { emptyDecisionState } from "../infra/heartbeatDecision.js";

const RUN = `w2eng-${Date.now().toString(36)}`;

function hbConfig(ctx: Awaited<ReturnType<typeof createContextInner>>) {
  return {
    ...ctx.config,
    llm: { ...ctx.config.llm, dailyBudget: 0 },
    heartbeat: {
      ...ctx.config.heartbeat,
      decisionEnabled: true,
      quietCap: 8,
      terminalAfterQuiet: 3,
      gateNotifyCooldownMs: 1_800_000,
    },
  };
}

async function readDecision(agentId: string) {
  const row = await prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } });
  const hb = (row?.heartbeat ?? {}) as { decision?: Record<string, unknown>; lastRunAt?: string };
  return {
    decision: { ...emptyDecisionState(), ...(hb.decision as object) },
    lastRunAt: hb.lastRunAt ?? null,
  };
}

describe("W2 heartbeatDecision 引擎集成", () => {
  beforeEach(() => {
    resetHeartbeatEngineForTests();
    resetAsyncJobOrchestratorForTests();
    resetSwarmOrchestratorForTests();
    setStreamHub(null);
  });

  afterEach(async () => {
    resetHeartbeatEngineForTests();
    vi.restoreAllMocks();
    await prisma.log.deleteMany({ where: { component: "HeartbeatEngine", message: { contains: RUN } } }).catch(() => undefined);
    await prisma.task.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.agent.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.approval.deleteMany({ where: { toolName: { contains: RUN } } });
  });

  it("退避：成功首轮后后续 tick 跳过 dispatch，skipRemaining 推进", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "ok",
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
    } as any);

    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `W2-backoff-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "W2 退避" } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;
    const engine = getHeartbeatEngine(prisma, ctx.services, hbConfig(ctx));

    await engine.triggerHeartbeat(agentId);
    await vi.waitFor(async () => {
      expect((await readDecision(agentId)).lastRunAt).toBeTruthy();
    });
    const afterFirst = await prisma.task.count({ where: { name: `[heartbeat] W2-backoff-${RUN}` } });
    expect(afterFirst).toBe(1);

    // 无队列 → monitor_quiet_skip，skipRemaining=1，不建 Task
    await engine.triggerHeartbeat(agentId);
    expect(await prisma.task.count({ where: { name: `[heartbeat] W2-backoff-${RUN}` } })).toBe(1);
    const d1 = await readDecision(agentId);
    expect(d1.decision.lastMode).toBe("monitor_quiet_skip");
    expect(d1.decision.skipRemaining).toBe(1);

    // skipOnlyDecrement
    await engine.triggerHeartbeat(agentId);
    expect(await prisma.task.count({ where: { name: `[heartbeat] W2-backoff-${RUN}` } })).toBe(1);
    expect((await readDecision(agentId)).decision.skipRemaining).toBe(0);

    // 再次 monitor，退避推进到 3
    await engine.triggerHeartbeat(agentId);
    expect((await readDecision(agentId)).decision.skipRemaining).toBe(3);
    expect(await prisma.task.count({ where: { name: `[heartbeat] W2-backoff-${RUN}` } })).toBe(1);
  });

  it("terminal：连续 quiet 达阈值后 heartbeatSuspendedAt 置位", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "done",
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
    } as any);

    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `W2-term-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "W2 terminal" } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;
    const engine = getHeartbeatEngine(prisma, ctx.services, hbConfig(ctx));

    // 首轮 delivery
    await engine.triggerHeartbeat(agentId);

    // 驱动至 terminal：monitor(+skip*) × 直到 quietStreak>=3
    for (let i = 0; i < 20; i++) {
      await engine.triggerHeartbeat(agentId);
      if (await engine.isHeartbeatSuspended(agentId)) break;
    }

    expect(await engine.isHeartbeatSuspended(agentId)).toBe(true);
    const d = await readDecision(agentId);
    expect(d.decision.lastMode).toBe("terminal_no_followup");
    expect(d.decision.terminalAt).toBeTruthy();

    // refresh 不摘除 terminal suspended
    await engine.start();
    await engine.refresh();
    expect(await engine.isHeartbeatSuspended(agentId)).toBe(true);
  });

  it("wait_user_gate：同 gate 冷却窗口内只通知一次", async () => {
    const notifySpy = vi.spyOn(emailNotifier, "sendEmailNotification").mockResolvedValue({
      success: true,
      message: "ok",
    });

    const ctx = await createContextInner();
    const created = await ctx.services.agent.create({
      name: `W2-gate-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: {
        enabled: true,
        cron: "0 9 * * *",
        goal: "W2 gate",
        lastRunAt: new Date().toISOString(),
      } as any,
    });
    if (!created.success) throw new Error(created.error?.message);
    const agentId = (created.data as { id: string }).id;

    await prisma.approval.create({
      data: { toolName: `w2.gate.${RUN}`, args: { x: 1 }, status: "pending" },
    });

    const engine = getHeartbeatEngine(prisma, ctx.services, hbConfig(ctx));
    await engine.triggerHeartbeat(agentId);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(await prisma.task.count({ where: { name: `[heartbeat] W2-gate-${RUN}` } })).toBe(0);

    await engine.triggerHeartbeat(agentId);
    expect(notifySpy).toHaveBeenCalledTimes(1);

    const logs = await prisma.log.findMany({
      where: { event: "heartbeat_decision", component: "HeartbeatEngine" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    expect(logs.some((l) => (l.metadata as { mode?: string })?.mode === "wait_user_gate")).toBe(true);
  });
});
