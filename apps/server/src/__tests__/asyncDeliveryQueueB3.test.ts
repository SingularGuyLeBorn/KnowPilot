/**
 * B3：autoConsume 不得在池槽内等 hub 空闲 — 负向断言
 *
 * 旧实现：runConsumeJob 获槽后 await hub.waitFor → maxConcurrent=2 时消费任务可占住全局槽一半数分钟。
 * 新实现：waitFor 在 runConsumeJob 之前；等待期间 runningGlobal === 0。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { autoConsumeAsyncDelivery } from "../infra/asyncJobManager.js";
import {
  getAsyncJobOrchestrator,
  resetAsyncJobOrchestratorForTests,
} from "../infra/asyncJobOrchestrator.js";
import { setStreamHub, getStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `b3${Date.now().toString(36)}`;

describe("B3 autoConsume 槽外 waitFor", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
  });

  it("hub 长占用期间：consume 等待不持池槽（runningGlobal=0；旧实现槽内等 → 旧实现即红）", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `B3-Agent-${RUN_ID}`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
    });
    const agentId = (agent.data as { id: string }).id;
    const session = await ctx.services.session.create({
      title: "B3",
      model: "deepseek-chat",
      agentId,
    } as any);
    const sessionId = (session.data as { id: string }).id;
    const task = await prisma.task.create({
      data: {
        name: "[async] B3",
        type: "async_agent",
        status: "success",
        sessionId,
        delivered: false,
        input: {
          kind: "async_agent",
          sessionId,
          task: "B3",
          taskLabel: "B3",
          agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [] },
          sourceType: "subagent",
        },
        output: { asyncResult: "B3 ok" },
      },
    });

    const hub = getStreamHub()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await hub.start(sessionId, { sessionId, agentId, message: "占用" }, async (emit) => {
      await gate;
      emit({
        type: "done",
        sessionId,
        agentId,
        content: "done",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      });
    });

    const orch = getAsyncJobOrchestrator(ctx.config);
    const r = await autoConsumeAsyncDelivery({
      sessionId,
      jobId: task.id,
      status: "done",
      taskLabel: "B3",
      services: ctx.services,
      config: ctx.config,
    });
    expect(r).toBe("started");

    // 等待中采样：旧实现已获槽 runningGlobal>=1；新实现槽外等 = 0
    await new Promise((r) => setTimeout(r, 80));
    expect(orch.getStats().runningGlobal).toBe(0);

    release();
    await hub.waitFor(sessionId);

    await prisma.task.deleteMany({ where: { id: task.id } }).catch(() => {});
    await prisma.chatMessage.deleteMany({ where: { sessionId } }).catch(() => {});
    await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
    await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => {});
  });
});
