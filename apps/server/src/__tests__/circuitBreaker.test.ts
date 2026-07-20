/**
 * W12 架构修复测试
 *
 * 1. CircuitBreaker 单元：三态转移 / 半开恢复 / 非法转移拒绝（状态机不变量收进类内部）
 * 2. MCP 接入：连续失败开闸后，open 期间零真实连接尝试，结构化错误结果喂回 LLM（不抛）
 * 3. 审批过期清理定时化：每日 cron 挂载在 maintenance 通道（不随 refresh 重建）+ runApprovalCleanup 真实清扫
 * 4. 心跳连续失败熔断暂停（W16d-2 持久化语义）：streak 达阈值 → suspended 落 Agent 行，
 *    refresh() 个体化恢复（仅计数清零者）/ resumeHeartbeat() / 重启不失
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import cron from "node-cron";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { prisma } from "../db.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { createContextInner } from "../trpc/context.js";
import { CircuitBreaker } from "../infra/circuitBreaker.js";
import {
  executeMcpTool,
  disconnectAllMcpClients,
  __resetMcpCircuitBreakersForTests,
  __getMcpCircuitBreakerForTests,
} from "../infra/mcpClient.js";
import { getHeartbeatEngine, resetHeartbeatEngineForTests } from "../infra/heartbeatEngine.js";
import { resetSwarmOrchestratorForTests } from "../infra/swarmOrchestrator.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { setStreamHub } from "../infra/sessionStreamHub.js";
import { HEARTBEAT_MAX_CONSECUTIVE_FAILURES } from "@knowpilot/shared";

/** 可推进的测试时钟（避免 vi.useFakeTimers 与异步 DB 交互打架） */
function makeClock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

/* ─────────────────────────── 1. CircuitBreaker 三态状态机 ─────────────────────────── */

describe("CircuitBreaker 三态状态机", () => {
  it("初始 closed；失败未达阈值保持 closed，成功清零计数", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 3, openDurationMs: 1000, now: clock.now });

    expect(cb.getState()).toBe("closed");
    expect(cb.tryAcquire().allowed).toBe(true);

    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.getFailureCount()).toBe(1);

    cb.recordSuccess(); // 成功清零
    expect(cb.getFailureCount()).toBe(0);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed"); // 2 < 3 未开闸
    expect(cb.tryAcquire().allowed).toBe(true);
  });

  it("失败达阈值 closed → open；open 期间拒绝并给出随时间递减的 retryAfterMs", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 3, openDurationMs: 1000, now: clock.now });

    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    const p1 = cb.tryAcquire();
    expect(p1.allowed).toBe(false);
    if (!p1.allowed) expect(p1.retryAfterMs).toBe(1000);

    clock.advance(400);
    const p2 = cb.tryAcquire();
    expect(p2.allowed).toBe(false);
    if (!p2.allowed) expect(p2.retryAfterMs).toBe(600);
  });

  it("open 冷却到期 → half-open 放行探测；探测成功 → closed 且计数清零（半开恢复）", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000, now: clock.now });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    clock.advance(1000);
    const permit = cb.tryAcquire();
    expect(permit.allowed).toBe(true);
    expect(cb.getState()).toBe("half-open");
    expect(permit.allowed && permit.probeToken).toEqual(expect.any(Number));

    cb.recordSuccess(permit.allowed ? permit.probeToken : undefined);
    expect(cb.getState()).toBe("closed");
    expect(cb.getFailureCount()).toBe(0);
  });

  it("half-open 探测失败 → 回 open 并重新计时", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000, now: clock.now });

    cb.recordFailure();
    cb.recordFailure();
    clock.advance(1000);
    const probe = cb.tryAcquire();
    expect(probe.allowed).toBe(true);
    expect(cb.getState()).toBe("half-open");

    cb.recordFailure(probe.allowed ? probe.probeToken : undefined);
    expect(cb.getState()).toBe("open");

    const p = cb.tryAcquire();
    expect(p.allowed).toBe(false);
    if (!p.allowed) expect(p.retryAfterMs).toBe(1000); // 重新计满
  });

  it("half-open 探测在途时，并发第二个 tryAcquire 被拒绝", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000, now: clock.now });

    cb.recordFailure();
    cb.recordFailure();
    clock.advance(1000);
    expect(cb.tryAcquire().allowed).toBe(true); // 唯一探测
    expect(cb.getState()).toBe("half-open");

    const concurrent = cb.tryAcquire();
    expect(concurrent.allowed).toBe(false);
    if (!concurrent.allowed) expect(concurrent.retryAfterMs).toBe(1000);
  });

  it("C6：closed 期迟到成功/失败在 half-open 不改变探测判定；错令牌忽略", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000, now: clock.now });

    // closed 期发出请求（无令牌）在途
    expect(cb.tryAcquire().allowed).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    clock.advance(1000);
    const probe = cb.tryAcquire();
    expect(probe.allowed).toBe(true);
    expect(cb.getState()).toBe("half-open");
    const token = probe.allowed ? probe.probeToken : undefined;
    expect(token).toEqual(expect.any(Number));

    // closed 期迟到成功：无令牌 → 不得误合闸，探测仍在途
    cb.recordSuccess();
    expect(cb.getState()).toBe("half-open");

    // 错令牌失败：不得误重开
    cb.recordFailure(999_999);
    expect(cb.getState()).toBe("half-open");

    // 真探测成功才合闸
    cb.recordSuccess(token);
    expect(cb.getState()).toBe("closed");
  });

  it("C6：half-open 探测在途时迟到失败不得清掉 probeInFlight 让第二探测混入", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000, now: clock.now });

    cb.recordFailure();
    cb.recordFailure();
    clock.advance(1000);
    expect(cb.tryAcquire().allowed).toBe(true);

    // 迟到无令牌失败（旧实现会 clear probeInFlight 并 reopen；或 clear 后仍 half-open 放进第二探测）
    cb.recordFailure();
    expect(cb.getState()).toBe("half-open");
    const second = cb.tryAcquire();
    expect(second.allowed).toBe(false);
  });

  it("非法转移拒绝：closed→half-open / open→closed 被 guard 拒绝且状态不变", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const clock = makeClock();
      const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000, now: clock.now });

      // closed → half-open：非法（半开只能由 open 冷却到期进入）
      expect(cb.transition("half-open")).toBe(false);
      expect(cb.getState()).toBe("closed");
      expect(errSpy).toHaveBeenCalledTimes(1);

      // closed → open：合法
      expect(cb.transition("open")).toBe(true);
      expect(cb.getState()).toBe("open");

      // open → closed：非法（必须经 half-open 探测成功）
      errSpy.mockClear();
      expect(cb.transition("closed")).toBe(false);
      expect(cb.getState()).toBe("open");
      expect(errSpy).toHaveBeenCalledTimes(1);

      // 自环合法 no-op（不算转移）
      errSpy.mockClear();
      expect(cb.transition("open")).toBe(true);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("open 期间陈旧 recordSuccess/recordFailure 不改变状态（事件级非法转移拒绝）", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, openDurationMs: 1000, now: clock.now });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    // 在途陈旧成功：不提前合闸
    cb.recordSuccess();
    expect(cb.getState()).toBe("open");

    // 在途陈旧失败：不重新计时（openedAt 不变）
    clock.advance(400);
    cb.recordFailure();
    const p = cb.tryAcquire();
    expect(p.allowed).toBe(false);
    if (!p.allowed) expect(p.retryAfterMs).toBe(600); // 仍按首次开闸时间计
  });
});

/* ─────────────────────── 2. MCP 接入：open 期间零真实连接尝试 ─────────────────────── */

describe("MCP 断路器接入 executeMcpTool", () => {
  const serverName = `w12srv-${Date.now()}`;
  let mcpServerId = "";

  beforeEach(async () => {
    vi.stubEnv("MOCK_MCP", "false");
    __resetMcpCircuitBreakersForTests();
    await disconnectAllMcpClients();
    const created = await prisma.mcpServer.create({
      data: { name: serverName, command: "node", args: ["server.js"], env: {}, enabled: true },
    });
    mcpServerId = created.id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetMcpCircuitBreakersForTests();
    await disconnectAllMcpClients();
    await prisma.mcpServer.deleteMany({ where: { id: mcpServerId } }).catch(() => undefined);
  });

  it("连续失败开闸后，open 期间零真实连接尝试，返回结构化错误结果（不抛）", async () => {
    // Mock SDK 连接层：每次真实连接尝试都计数并失败（不触网、不 spawn）
    const connectSpy = vi.spyOn(Client.prototype, "connect").mockRejectedValue(new Error("W12 模拟连接失败"));

    const ctx = await createContextInner();
    const toolName = `mcp__${serverName}__echo`;

    // 阈值默认 5：每次 executeMcpTool = 首试 + 重连重试 = 2 次连接尝试
    for (let i = 0; i < 5; i++) {
      await expect(executeMcpTool(ctx.services, toolName, {})).rejects.toThrow(/调用失败/);
    }
    expect(connectSpy).toHaveBeenCalledTimes(10);
    expect(__getMcpCircuitBreakerForTests(serverName)?.getState()).toBe("open");

    // open 期间：不抛异常，结构化错误结果喂回 LLM；真实连接尝试零增长
    const result = (await executeMcpTool(ctx.services, toolName, {})) as {
      error: string;
      message: string;
      circuitOpen: boolean;
      retryAfterMs: number;
    };
    expect(result.error).toBe("MCP_CIRCUIT_OPEN");
    expect(result.circuitOpen).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.message).toMatch(/熔断中/);
    expect(connectSpy).toHaveBeenCalledTimes(10); // 零真实连接尝试
  });
});

/* ─────────────────── 3. 审批过期清理定时化（maintenance cron 通道） ─────────────────── */

describe("W12 审批过期清理定时化", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetHeartbeatEngineForTests();
  });

  it("每日 cron 挂载在 maintenance 通道，不随 refresh() 重建", async () => {
    const scheduleSpy = vi.spyOn(cron, "schedule");
    const ctx = await createContextInner();
    const engine = getHeartbeatEngine(prisma, ctx.services, ctx.config);

    await engine.start();
    const approvalCalls = () => scheduleSpy.mock.calls.filter((c) => c[0] === "3 4 * * *").length;
    const decayCalls = () => scheduleSpy.mock.calls.filter((c) => c[0] === "17 3 * * *").length;
    expect(approvalCalls()).toBe(1); // W12 审批清理
    expect(decayCalls()).toBe(1); // W5 记忆衰减（对照组）

    // refresh 全量重建 Agent 心跳 jobs，维护任务不受影响
    await engine.refresh();
    expect(approvalCalls()).toBe(1);
    expect(decayCalls()).toBe(1);
  });

  it("runApprovalCleanup 复用 expireStaleApprovals 真实清扫过期 pending", async () => {
    vi.stubEnv("APPROVAL_PENDING_TTL_MS", String(24 * 60 * 60 * 1000));
    const ctx = await createContextInner();
    const stale = await prisma.approval.create({
      data: {
        toolName: "w12.cleanup-test",
        args: { probe: true },
        status: "pending",
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 超过 24h TTL
      },
    });
    try {
      const engine = getHeartbeatEngine(prisma, ctx.services, ctx.config);
      const n = await engine.runApprovalCleanup();
      expect(n).toBeGreaterThanOrEqual(1);

      const after = await prisma.approval.findUnique({ where: { id: stale.id } });
      expect(after?.status).toBe("rejected");
      expect(after?.decidedBy).toBe("system-ttl");
    } finally {
      await prisma.approval.deleteMany({ where: { id: stale.id } }).catch(() => undefined);
    }
  });
});

/* ─────────── 4. 心跳连续失败熔断暂停（suspended，W16d-2 持久化 + 个体化恢复） ─────────── */

describe("W12 心跳连续失败熔断暂停", () => {
  async function readStreak(agentId: string): Promise<number> {
    const row = await prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } });
    return (row?.heartbeat as { consecutiveFailures?: number } | null)?.consecutiveFailures ?? 0;
  }

  async function triggerUntilSuspended(engine: ReturnType<typeof getHeartbeatEngine>, agentId: string) {
    for (let i = 1; i <= HEARTBEAT_MAX_CONSECUTIVE_FAILURES; i++) {
      await engine.triggerHeartbeat(agentId);
      // 等失败闭环落库（streak +1），避免下一次触发被 running 守卫跳过
      await vi.waitFor(async () => {
        expect(await readStreak(agentId)).toBe(i);
      });
    }
    await vi.waitFor(async () => {
      expect(await engine.isHeartbeatSuspended(agentId)).toBe(true);
    });
  }

  it("streak 达阈值 → suspended 落库；refresh 不再连坐恢复；配置变更清零计数后个体化摘除；重启不失", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockRejectedValue(new Error("W12 模拟心跳失败"));

    const ctx = await createContextInner();
    const suffix = `${Date.now()}`;
    const created = await ctx.services.agent.create({
      name: `W12-suspend-${suffix}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "W12 熔断暂停验证" } as any,
    });
    if (!created.success) throw new Error(`创建 Agent 失败：${created.error?.message}`);
    const agentId = (created.data as { id: string }).id;

    // dailyBudget=0 关闭预算闸，避免 .dev-log 真实消耗影响测试
    const hbConfig = { ...ctx.config, llm: { ...ctx.config.llm, dailyBudget: 0 } };
    const engine = getHeartbeatEngine(prisma, ctx.services, hbConfig);
    await engine.start();

    try {
      // ── 达阈值 → suspended 持久化到 Agent 行 ──
      await triggerUntilSuspended(engine, agentId);
      const row = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { heartbeatSuspendedAt: true },
      });
      expect(row?.heartbeatSuspendedAt).not.toBeNull();

      // suspended 后触发被跳过：不再创建新心跳 Task
      const before = await prisma.task.count({ where: { name: `[heartbeat] W12-suspend-${suffix}` } });
      await engine.triggerHeartbeat(agentId);
      const after = await prisma.task.count({ where: { name: `[heartbeat] W12-suspend-${suffix}` } });
      expect(after).toBe(before);

      // ── refresh() 不再连坐恢复（计数仍达阈值 → 保持 suspended） ──
      await engine.refresh();
      expect(await engine.isHeartbeatSuspended(agentId)).toBe(true);

      // ── 重启不失：新引擎实例（内存态全清）仍 suspended（DB 是唯一事实源） ──
      resetHeartbeatEngineForTests();
      const engine2 = getHeartbeatEngine(prisma, ctx.services, hbConfig);
      expect(await engine2.isHeartbeatSuspended(agentId)).toBe(true);
      await engine2.start();
      await engine2.triggerHeartbeat(agentId);
      const afterRestart = await prisma.task.count({ where: { name: `[heartbeat] W12-suspend-${suffix}` } });
      expect(afterRestart).toBe(before);

      // ── 恢复路径 1：心跳配置变更（cron 改动）→ 计数清零 → refresh 个体化摘除 ──
      const hbRow = await prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } });
      const hb = hbRow!.heartbeat as Record<string, unknown>;
      const updated = await ctx.services.agent.update({
        id: agentId,
        heartbeat: { ...hb, cron: "0 10 * * *" } as any,
      });
      if (!updated.success) throw new Error(`更新 Agent 失败：${updated.error?.message}`);
      expect(await readStreak(agentId)).toBe(0);
      await engine2.refresh();
      expect(await engine2.isHeartbeatSuspended(agentId)).toBe(false);

      // ── 恢复路径 2：手动 resumeHeartbeat ──
      // 先再熔断一次（streak 从 0 重新累计到达阈值）
      await triggerUntilSuspended(engine2, agentId);
      expect(await engine2.isHeartbeatSuspended(agentId)).toBe(true);
      await engine2.resumeHeartbeat(agentId);
      expect(await engine2.isHeartbeatSuspended(agentId)).toBe(false);

      // resume 不清计数：恢复后再失败（streak 仍 ≥ 阈值）→ 立即重新暂停
      await engine2.triggerHeartbeat(agentId);
      await vi.waitFor(async () => {
        expect(await engine2.isHeartbeatSuspended(agentId)).toBe(true);
      });
    } finally {
      await prisma.task.deleteMany({ where: { name: { contains: "W12-suspend" } } });
      await prisma.chatSession.deleteMany({ where: { agentId } });
      await prisma.agent.deleteMany({ where: { id: agentId } });
    }
  });

  it("心跳配置原样保存（cron/goal 未变）不清零计数、不解除 suspended", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockRejectedValue(new Error("W12 模拟心跳失败"));

    const ctx = await createContextInner();
    const suffix = `${Date.now()}-same`;
    const created = await ctx.services.agent.create({
      name: `W12-suspend-${suffix}`,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier: "manager",
      heartbeat: { enabled: true, cron: "0 9 * * *", goal: "W12 原样保存验证" } as any,
    });
    if (!created.success) throw new Error(`创建 Agent 失败：${created.error?.message}`);
    const agentId = (created.data as { id: string }).id;

    const hbConfig = { ...ctx.config, llm: { ...ctx.config.llm, dailyBudget: 0 } };
    const engine = getHeartbeatEngine(prisma, ctx.services, hbConfig);
    await engine.start();

    try {
      await triggerUntilSuspended(engine, agentId);

      // 原样保存（heartbeat 全字段不变 + 无关字段 name 变更）→ 计数保持、suspended 保持
      const hbRow = await prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } });
      const hb = hbRow!.heartbeat as Record<string, unknown>;
      const updated = await ctx.services.agent.update({
        id: agentId,
        description: "无关字段变更",
        heartbeat: hb as any,
      });
      if (!updated.success) throw new Error(`更新 Agent 失败：${updated.error?.message}`);
      expect(await readStreak(agentId)).toBe(HEARTBEAT_MAX_CONSECUTIVE_FAILURES);
      await engine.refresh();
      expect(await engine.isHeartbeatSuspended(agentId)).toBe(true);
    } finally {
      await prisma.task.deleteMany({ where: { name: { contains: "W12-suspend" } } });
      await prisma.chatSession.deleteMany({ where: { agentId } });
      await prisma.agent.deleteMany({ where: { id: agentId } });
    }
  });

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
});
