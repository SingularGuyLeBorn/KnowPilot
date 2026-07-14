/**
 * W10 SwarmOrchestrator 中介者测试
 *
 * 验收点：
 * 1. 心跳触发路径与 spawn_subagent 路径走同一段执行代码（spy 验证 orchestrator.dispatch 被两路调用）
 * 2. 重复 spawn 去重生效（同 agentId + hash(taskText) 60s 窗口内第二次 dispatch 返回已有 task）
 * 3. invokeTrpc 桩已删：心跳 Agent 拿到真实 invokeTrpc 通道（未知工具抛错，而非旧桩返回 undefined）
 * 4. guard / 去重窗口 / 在途去重的单元行为
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import { getHeartbeatEngine, resetHeartbeatEngineForTests } from "../infra/heartbeatEngine.js";
import {
  SwarmOrchestrator,
  getSwarmOrchestrator,
  resetSwarmOrchestratorForTests,
  type SwarmTaskOutcome,
} from "../infra/swarmOrchestrator.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { setStreamHub } from "../infra/sessionStreamHub.js";

const MOCK_LOOP_RESULT = {
  content: "W10 心跳完成内容",
  toolCalls: [],
  tokenUsage: { prompt: 1, completion: 2, total: 3 },
  model: "deepseek-chat",
  provider: "deepseek",
  roundsUsed: 1,
};

async function createAgent(
  ctx: Awaited<ReturnType<typeof createContextInner>>,
  data: { name: string; tier: string; parentId?: string; heartbeat?: Record<string, unknown> },
): Promise<string> {
  const result = await ctx.services.agent.create({
    name: data.name,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [],
    tier: data.tier as "manager" | "sub",
    parentId: data.parentId,
    heartbeat: data.heartbeat as any,
  });
  if (!result.success) throw new Error(`创建 Agent 失败：${result.error?.message}`);
  return (result.data as { id: string }).id;
}

async function cleanupAgents(...agentIds: string[]) {
  await prisma.task.deleteMany({ where: { name: { contains: "W10" } } });
  await prisma.chatSession.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
}

describe("W10 SwarmOrchestrator 中介者", () => {
  beforeEach(() => {
    resetSwarmOrchestratorForTests();
    resetAsyncJobOrchestratorForTests();
    setStreamHub(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHeartbeatEngineForTests();
    resetSwarmOrchestratorForTests();
    setStreamHub(null);
  });

  it("心跳与 spawn_subagent 走同一段执行代码（dispatch 双路调用）+ invokeTrpc 桩已删", async () => {
    const dispatchSpy = vi.spyOn(SwarmOrchestrator.prototype, "dispatch");
    const loopSpy = vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({ ...MOCK_LOOP_RESULT });

    const ctx = await createContextInner();
    const suffix = `${Date.now()}`;
    const hbAgentId = await createAgent(ctx, {
      name: `W10-hb-${suffix}`,
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "W10 心跳调度目标" },
    });
    const parentAgentId = await createAgent(ctx, { name: `W10-parent-${suffix}`, tier: "manager" });
    const subAgentId = await createAgent(ctx, { name: `W10-sub-${suffix}`, tier: "sub", parentId: parentAgentId });
    const parentSession = await ctx.services.session.create({ title: `W10 父会话 ${suffix}`, model: "deepseek-chat" });
    const parentSessionId = (parentSession.data as { id: string }).id;

    try {
      // ── 路径 1：心跳触发 ──
      // dailyBudget=0 关闭预算闸，避免 .dev-log 真实消耗影响测试
      const hbConfig = { ...ctx.config, llm: { ...ctx.config.llm, dailyBudget: 0 } };
      const engine = getHeartbeatEngine(prisma, ctx.services, hbConfig);
      await engine.triggerHeartbeat(hbAgentId);

      // 心跳任务在并发池内收口
      await vi.waitFor(async () => {
        const row = await prisma.task.findFirst({
          where: { name: `[heartbeat] W10-hb-${suffix}` },
          orderBy: { createdAt: "desc" },
        });
        expect(row?.status).toBe("success");
        const output = row?.output as { asyncResult?: string };
        expect(output?.asyncResult).toBe("W10 心跳完成内容");
      });

      // ── 路径 2：spawn_subagent ──
      const spawnResult = (await executeNativeTool(
        "spawn_subagent",
        { task: "W10 spawn 调度验证", agentId: subAgentId },
        {
          ...ctx,
          invokeTrpc: async () => ({ ok: true }),
          sessionId: parentSessionId,
          agentSnapshot: {
            id: parentAgentId,
            model: "deepseek-chat",
            systemPrompt: "test",
            tools: [],
            tier: "manager",
            workspaceId: null,
            parentId: null,
          },
        },
      )) as { success?: boolean; jobId?: string; agentId?: string };
      expect(spawnResult.success).toBe(true);
      expect(spawnResult.jobId).toBeTruthy();

      // ── 验收 1：两路都调用同一段 dispatch 执行代码 ──
      const origins = dispatchSpy.mock.calls.map((call) => (call[0] as { origin: string }).origin);
      expect(origins).toContain("heartbeat");
      expect(origins).toContain("spawn_subagent");

      // ── 验收 3：invokeTrpc 桩已删，心跳拿到真实通道（旧桩只会返回 undefined）──
      const loopOptions = loopSpy.mock.calls[0][0] as { invokeTrpc: (tool: string, args?: unknown) => Promise<unknown> };
      expect(typeof loopOptions.invokeTrpc).toBe("function");
      await expect(loopOptions.invokeTrpc("nonexistent.tool")).rejects.toThrow();
    } finally {
      await cleanupAgents(hbAgentId, parentAgentId, subAgentId);
    }
  });

  it("async_task_run 走 dispatch（pool）+ Log 审计落库", async () => {
    const dispatchSpy = vi.spyOn(SwarmOrchestrator.prototype, "dispatch");
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue({ ...MOCK_LOOP_RESULT });

    const ctx = await createContextInner();
    const suffix = `${Date.now()}`;
    const parentAgentId = await createAgent(ctx, { name: `W10-async-parent-${suffix}`, tier: "manager" });
    const session = await ctx.services.session.create({ title: `W10 异步会话 ${suffix}`, model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;

    let started: { jobId: string; status: string } | undefined;
    try {
      started = (await executeNativeTool(
        "async_task_run",
        { task: "W10 异步调度验证", label: "W10 异步调度验证" },
        {
          ...ctx,
          invokeTrpc: async () => ({ ok: true }),
          sessionId,
          agentSnapshot: { id: parentAgentId, model: "deepseek-chat", systemPrompt: "test", tools: [], tier: "manager" },
        },
      )) as { jobId: string; status: string };
      const startedResult = started!;
      expect(startedResult.status).toMatch(/running|queued/);

      await vi.waitFor(async () => {
        const row = await prisma.task.findUnique({ where: { id: startedResult.jobId } });
        expect(row?.status).toBe("success");
      });

      const call = dispatchSpy.mock.calls.find((c) => (c[0] as { origin: string }).origin === "async_task_run");
      expect(call).toBeDefined();
      expect(call![0]).toMatchObject({ schedule: "pool", jobId: startedResult.jobId, sessionId });

      // 审计：swarm_dispatch 受理 + swarm_task_completed 收口
      await vi.waitFor(async () => {
        const logs = await prisma.log.findMany({
          where: { component: "swarm.orchestrator", event: { in: ["swarm_dispatch", "swarm_task_completed"] } },
        });
        const events = logs.map((l) => l.event);
        expect(events).toContain("swarm_dispatch");
        expect(events).toContain("swarm_task_completed");
      });
    } finally {
      await prisma.task.deleteMany({ where: { id: started?.jobId ?? "__none__" } }).catch(() => {});
      await cleanupAgents(parentAgentId);
    }
  });

  it("重复 spawn 去重：60s 窗口内同 Agent 同任务第二次 dispatch 返回已有 task", async () => {
    const ctx = await createContextInner();
    const suffix = `${Date.now()}`;
    const parentAgentId = await createAgent(ctx, { name: `W10-dedup-parent-${suffix}`, tier: "manager" });
    const subAgentId = await createAgent(ctx, { name: `W10-dedup-sub-${suffix}`, tier: "sub", parentId: parentAgentId });
    const session = await ctx.services.session.create({ title: `W10 去重会话 ${suffix}`, model: "deepseek-chat" });
    const sessionId = (session.data as { id: string }).id;

    const toolCtx = {
      ...ctx,
      invokeTrpc: async () => ({ ok: true }),
      sessionId,
      agentSnapshot: {
        id: parentAgentId,
        model: "deepseek-chat",
        systemPrompt: "test",
        tools: [],
        tier: "manager",
        workspaceId: null,
        parentId: null,
      },
    };

    try {
      const first = (await executeNativeTool(
        "spawn_subagent",
        { task: "W10 去重任务", agentId: subAgentId },
        toolCtx,
      )) as { success?: boolean; jobId?: string; agentId?: string; deduped?: boolean };
      expect(first.success).toBe(true);
      expect(first.deduped).toBeUndefined();

      const second = (await executeNativeTool(
        "spawn_subagent",
        { task: "W10 去重任务", agentId: subAgentId },
        toolCtx,
      )) as { jobId?: string; agentId?: string; deduped?: boolean; message?: string };

      // 第二次：未重复创建，直接返回已有 task
      expect(second.deduped).toBe(true);
      expect(second.jobId).toBe(first.jobId);
      expect(second.agentId).toBe(first.agentId);

      // 父会话上只有一条跟踪 Task（第一次创建的）
      const trackingTasks = await prisma.task.findMany({ where: { sessionId } });
      expect(trackingTasks.length).toBe(1);

      // 不同任务文本：不去重，正常执行
      const third = (await executeNativeTool(
        "spawn_subagent",
        { task: "W10 去重任务（不同内容）", agentId: subAgentId },
        toolCtx,
      )) as { success?: boolean; jobId?: string; deduped?: boolean };
      expect(third.success).toBe(true);
      expect(third.deduped).toBeUndefined();
      expect(third.jobId).not.toBe(first.jobId);
    } finally {
      await prisma.task.deleteMany({ where: { sessionId } });
      await cleanupAgents(parentAgentId, subAgentId);
    }
  });

  it("去重窗口单元行为：窗口内幂等返回在途结果，窗口过期后重新执行", async () => {
    const ctx = await createContextInner();
    const orchestrator = getSwarmOrchestrator(ctx.config, ctx.services);
    let runs = 0;
    const spec = (text: string, windowMs?: number) => ({
      origin: "spawn_subagent" as const,
      schedule: "inline" as const,
      sessionId: "sess-unit",
      taskLabel: "unit-dedup",
      dedup: { agentId: "agent-unit", taskText: text, windowMs },
      execute: async (): Promise<SwarmTaskOutcome> => {
        runs++;
        return { status: "success", attach: { n: runs } };
      },
    });

    const h1 = await orchestrator.dispatch(spec("  归一化   任务文本  "));
    const h2 = await orchestrator.dispatch(spec("  归一化   任务文本  "));
    expect(h2.deduped).toBe(true);
    expect(h2.jobId).toBe(h1.jobId);
    expect(h2.outcome?.attach).toEqual({ n: 1 });
    expect(runs).toBe(1);

    // 窗口过期后重新执行（换任务文本避免命中上一条 60s 窗口记录）
    const h3 = await orchestrator.dispatch(spec("过期窗口任务文本", 5));
    expect(h3.deduped).toBe(false);
    expect(runs).toBe(2);
    await new Promise((r) => setTimeout(r, 20));
    const h4 = await orchestrator.dispatch(spec("过期窗口任务文本", 5));
    expect(h4.deduped).toBe(false);
    expect(runs).toBe(3);
  });

  it("在途去重：并发重复 dispatch await 同一次执行（幂等消费，不赌时序）", async () => {
    const ctx = await createContextInner();
    const orchestrator = getSwarmOrchestrator(ctx.config, ctx.services);
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const makeSpec = () => ({
      origin: "spawn_subagent" as const,
      schedule: "inline" as const,
      sessionId: "sess-inflight",
      taskLabel: "inflight-dedup",
      dedup: { agentId: "agent-inflight", taskText: "在途任务" },
      execute: async (): Promise<SwarmTaskOutcome> => {
        runs++;
        await gate;
        return { status: "success", attach: { done: true } };
      },
    });

    const p1 = orchestrator.dispatch(makeSpec());
    const p2 = orchestrator.dispatch(makeSpec());
    release();
    const [h1, h2] = await Promise.all([p1, p2]);
    expect(h1.deduped).toBe(false);
    expect(h2.deduped).toBe(true);
    expect(h2.jobId).toBe(h1.jobId);
    expect(h2.outcome?.attach).toEqual({ done: true });
    expect(runs).toBe(1);
  });

  it("中介者 guard：sub tier dispatch spawn_subagent 被拒且不执行", async () => {
    const ctx = await createContextInner();
    const orchestrator = getSwarmOrchestrator(ctx.config, ctx.services);
    const execute = vi.fn();
    await expect(
      orchestrator.dispatch({
        origin: "spawn_subagent",
        schedule: "inline",
        sessionId: "sess-guard",
        taskLabel: "guard-test",
        guard: {
          toolName: "spawn_subagent",
          args: {},
          ctx: { agentTier: "sub", agentId: "sub-1", inToolRound: false },
        },
        execute,
      }),
    ).rejects.toThrow(/TIER_INSUFFICIENT/);
    expect(execute).not.toHaveBeenCalled();

    // 审计落库是 fire-and-forget，等待写入完成
    await vi.waitFor(async () => {
      const deniedLogs = await prisma.log.findMany({
        where: { component: "swarm.orchestrator", event: "swarm_dispatch_denied" },
      });
      expect(deniedLogs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
