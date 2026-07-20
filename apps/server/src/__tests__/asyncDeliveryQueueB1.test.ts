/**
 * B1：reconciler 对失败轻量任务永不收敛的对账循环 — 负向断言
 *
 * 现场：autoConsume 对 sleep/async_task_tool 失败「标 delivered=true 但不写气泡」；
 * Pass 1 以 ChatMessage 为唯一 ground truth → 永远判孤儿 → 回滚 → renotify → 再标 delivered
 * → 无限循环。
 *
 * 契约：豁免收在 reconciler 单点——识别 output.deliveryExempt=true 台账；
 * delivered=true 必须对应「气泡存在 ∨ 对账点可判定的豁免类别」。
 *
 * 负向：无台账的失败轻量 Task 两轮 reconciler 仍回滚（旧实现对有台账亦回滚 → 有台账用例旧实现红）。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { reconcileAsyncDeliveries } from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `b1${Date.now().toString(36)}`;

async function createFailedLightweight(opts: {
  ctx: Ctx;
  sourceType: "sleep" | "async_task_tool";
  deliveryExempt?: boolean;
}): Promise<{ agentId: string; sessionId: string; taskId: string }> {
  const agent = await opts.ctx.services.agent.create({
    name: `B1-Agent-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [],
  });
  const agentId = (agent.data as { id: string }).id;
  const session = await opts.ctx.services.session.create({
    title: "B1 豁免对账会话",
    model: "deepseek-chat",
    agentId,
  } as any);
  const sessionId = (session.data as { id: string }).id;
  const task = await prisma.task.create({
    data: {
      name: "[async] B1 轻量失败",
      type: "async_agent",
      status: "failed",
      sessionId,
      delivered: true,
      deliveredAt: new Date(Date.now() - 10 * 60_000),
      input: {
        kind: "async_agent",
        sessionId,
        task: "B1 轻量失败",
        taskLabel: "B1 轻量失败",
        agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: null },
        sourceType: opts.sourceType,
      },
      output: {
        error: "轻量失败",
        ...(opts.deliveryExempt ? { deliveryExempt: true } : {}),
      },
    },
  });
  return { agentId, sessionId, taskId: task.id };
}

async function cleanup(fx: { agentId: string; sessionId: string; taskId: string }) {
  await prisma.task.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { id: fx.sessionId } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: fx.agentId } }).catch(() => {});
}

describe("B1 reconciler 失败轻量任务豁免台账", () => {
  beforeEach(async () => {
    resetAsyncJobOrchestratorForTests();
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
    await prisma.task.deleteMany({ where: { delivered: true, status: { in: ["success", "failed"] } } });
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
  });

  it("有 deliveryExempt 台账：两轮 reconciler 零回滚零补投（旧实现每轮回滚 → 旧实现即红）", async () => {
    const ctx = await createContextInner();
    const fx = await createFailedLightweight({ ctx, sourceType: "sleep", deliveryExempt: true });
    try {
      const r1 = await reconcileAsyncDeliveries({
        services: ctx.services,
        config: ctx.config,
        minDeliveredAgeMs: 0,
      });
      expect(r1.rolledBack).toBe(0);
      expect(r1.renotified).toBe(0);

      const r2 = await reconcileAsyncDeliveries({
        services: ctx.services,
        config: ctx.config,
        minDeliveredAgeMs: 0,
      });
      expect(r2.rolledBack).toBe(0);
      expect(r2.renotified).toBe(0);

      const row = await prisma.task.findUnique({ where: { id: fx.taskId } });
      expect(row?.delivered).toBe(true);
    } finally {
      await cleanup(fx);
    }
  });

  it("豁免标记缺失：仍按孤儿回滚（台账是唯一豁免门）", async () => {
    const ctx = await createContextInner();
    const fx = await createFailedLightweight({ ctx, sourceType: "async_task_tool" });
    try {
      const r1 = await reconcileAsyncDeliveries({
        services: ctx.services,
        config: ctx.config,
        minDeliveredAgeMs: 0,
      });
      expect(r1.rolledBack).toBe(1);
      expect(r1.renotified).toBe(1);
    } finally {
      await cleanup(fx);
    }
  });
});
