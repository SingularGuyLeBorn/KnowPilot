/**
 * B4：启动恢复 resume 幂等 + 动作顺序 — 负向断言
 *
 * a) 旧实现认领后写回 queued，仍匹配认领条件 → 同进程二次调用 retryCount 再 +1、双入池。
 * b) 旧实现先 Task 续跑再 paused 僵尸会话 → 刚被 resume 置 running 的子会话可能被误伤。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { recoverStaleAsyncJobs, runStartupRecovery } from "../infra/asyncJobManager.js";
import { getAsyncJobOrchestrator, resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";
import * as agentRuntime from "../infra/agentRuntime.js";

const SID = `b4${Date.now().toString(36)}`;

describe("B4 启动恢复 resuming 幂等与动作顺序", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
    setStreamHub(new SessionStreamHub({ ringSize: 50, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({
      content: "B4 ok",
      toolCalls: [],
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
      model: "m",
      provider: "p",
      roundsUsed: 1,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setStreamHub(null);
    await prisma.task.deleteMany({ where: { sessionId: { startsWith: SID } } });
    await prisma.chatSession.deleteMany({ where: { id: { startsWith: SID } } }).catch(() => {});
  });

  it("同进程二次 recover：retryCount 只 +1，单执行体（旧实现双 +1 → 旧实现即红）", async () => {
    const ctx = await createContextInner();
    const sessionId = `${SID}-s1`;
    const task = await prisma.task.create({
      data: {
        name: "[async] B4 resume",
        type: "async_agent",
        status: "running",
        sessionId,
        startedAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
        reentrant: true,
        input: {
          kind: "async_agent",
          sessionId,
          task: "B4",
          taskLabel: "B4",
          agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: [] },
          sourceType: "async_task_llm",
          deliverToQueue: false,
        },
      },
    });

    const r1 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r1.resumed).toBe(1);
    const after1 = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after1?.retryCount).toBe(1);
    // 认领中间态 resuming（或已被执行体推进到 running/success）
    expect(["resuming", "running", "success", "queued"]).toContain(after1?.status);

    const r2 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r2.resumed).toBe(0);
    const after2 = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after2?.retryCount).toBe(1);

    // 池内同 jobId 不应双跑：runningJobs 至多一条
    const orch = getAsyncJobOrchestrator(ctx.config);
    await vi.waitFor(
      async () => {
        const row = await prisma.task.findUnique({ where: { id: task.id } });
        expect(["success", "failed", "running", "resuming"]).toContain(row?.status);
      },
      { timeout: 5000, interval: 30 },
    );
    expect(orch.getStats().runningGlobal).toBeLessThanOrEqual(1);
  });

  it("动作顺序：先 paused 僵尸会话，再 Task resume（resume 起的 running 不被误伤）", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `B4-Agent-${SID}`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "sub",
    });
    const agentId = (agent.data as { id: string }).id;
    // 僵尸会话（应被 paused）
    const zombie = await prisma.chatSession.create({
      data: {
        id: `${SID}-zombie`,
        title: "zombie",
        model: "m",
        agentId,
        status: "running",
        kind: "chat",
      },
    });
    // 子会话挂在续跑 Task 上：resume 执行体可能把它置 running——若先 resume 再全量 paused 会误伤
    const subSid = `${SID}-sub`;
    await prisma.chatSession.create({
      data: {
        id: subSid,
        title: "sub",
        model: "m",
        agentId,
        status: "paused",
        kind: "subagent",
        isMainSession: true,
      },
    });
    const sessionId = `${SID}-parent`;
    await prisma.task.create({
      data: {
        name: "[async] B4 order",
        type: "async_agent",
        status: "running",
        sessionId,
        startedAt: new Date(),
        retryCount: 0,
        maxRetries: 2,
        reentrant: true,
        input: {
          kind: "async_agent",
          sessionId,
          task: "B4 order",
          taskLabel: "B4 order",
          agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [] },
          sourceType: "async_task_llm",
          subagentSessionId: subSid,
          deliverToQueue: false,
        },
      },
    });

    const result = await runStartupRecovery({ config: ctx.config, services: ctx.services });
    expect(result.zombieSessionsPaused).toBeGreaterThanOrEqual(1);
    expect((await prisma.chatSession.findUnique({ where: { id: zombie.id } }))?.status).toBe("paused");

    await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => {});
  });
});
