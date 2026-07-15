/**
 * v8 TP-1/TP-2 全局任务池收口
 *
 * 不变量（收进池执行层，不靠各入口自觉）：
 * 1. 全局占用 = 池内 running + hub 交互 running（Q2）；被 occupancy claim 的 hub 会话
 *    不计入交互 running（不双算池内起流 / 血缘让渡的会话）。
 * 2. 同一血缘同时只有一个执行体占槽（Q4）：waitForResult=true 的子执行走 inline + claim，
 *    不占新槽、不计全局占用；waitForResult=false 才作为独立任务入池。
 * 3. 交付消费续跑走高优通道：队首优先 + 受全局占用约束；queuedTimeoutMs 未获槽则放弃本轮，
 *    delivery 原样留待下次触发（不丢），禁止「等槽无限挂起消费链」。
 * 4. maxQueued 满则入池拒绝（明确错误）；queued 记录阻塞原因（global/session/workspace）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import { SessionStreamHub, getStreamHub, setStreamHub } from "../infra/sessionStreamHub.js";
import {
  AsyncJobOrchestrator,
  getAsyncJobOrchestrator,
  resetAsyncJobOrchestratorForTests,
} from "../infra/asyncJobOrchestrator.js";
import { resetSwarmOrchestratorForTests } from "../infra/swarmOrchestrator.js";
import { resetSwarmBus } from "../infra/swarmBus.js";
import { autoConsumeAsyncDelivery, startAsyncAgentTask } from "../infra/asyncJobManager.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function makeGate() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { gate, release };
}

/* ─────────────────────── TP-2 池准入与统计（纯单元，无 DB） ─────────────────────── */

describe("TP-2 池准入与统计（AsyncJobOrchestrator 单元）", () => {
  afterEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  it("maxQueued 满则入池拒绝并给明确错误", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 5, taskTimeoutMs: 500, maxQueued: 1 });
    const blocker = makeGate();
    orch.enqueue({ jobId: "a", sessionId: "s1", execute: () => blocker.gate });
    orch.enqueue({ jobId: "b", sessionId: "s1", execute: async () => {} });

    // 负向断言（旧实现无限入队 → 必红）：第三个任务被拒绝
    expect(() => orch.enqueue({ jobId: "c", sessionId: "s1", execute: async () => {} })).toThrow(/队列已满/);
    expect(orch.getStats().queued).toBe(1);
    expect(orch.isQueued("c")).toBe(false);

    blocker.release();
    await tick(50);
  });

  it("Q2 口径：hub 交互 running 计入全局占用；被 claim 的会话不计（不双算）", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 5, taskTimeoutMs: 500 });
    const hubRuns = new Set<string>(["chat-1"]);
    orch.setHubRunningSessionsProvider(() => [...hubRuns]);

    const g1 = makeGate();
    const g2 = makeGate();
    orch.enqueue({ jobId: "pool-a", sessionId: "s1", execute: () => g1.gate });
    orch.enqueue({ jobId: "pool-b", sessionId: "s2", execute: () => g2.gate });
    await tick();

    // 占用 = 1 池 + 1 交互 = 2 = maxGlobal → pool-b 排队
    // 负向断言（旧口径只看池内 running → 必放行，即红）
    expect(orch.isRunning("pool-a")).toBe(true);
    expect(orch.isQueued("pool-b")).toBe(true);
    expect(orch.getStats().hubInteractiveRunning).toBe(1);

    // claim 该交互会话（血缘让渡/池内起流）→ 不再计入 → pool-b 获槽
    const releaseClaim = orch.claimOccupancy("chat-1");
    await tick();
    expect(orch.isRunning("pool-b")).toBe(true);
    expect(orch.getStats().hubInteractiveRunning).toBe(0);

    // 释放 claim 恢复计入；release 幂等（二次调用不炸）
    releaseClaim();
    releaseClaim();
    expect(orch.getStats().hubInteractiveRunning).toBe(1);

    g1.release();
    g2.release();
    await tick(50);
  });

  it("queued reason：global / session / workspace 分类计数 + runningByWorkspace", async () => {
    const orch = new AsyncJobOrchestrator({
      maxGlobal: 3,
      maxPerSession: 1,
      maxPerWorkspace: 1,
      taskTimeoutMs: 500,
    });
    const g1 = makeGate();
    const g2 = makeGate();
    const g3 = makeGate();
    orch.enqueue({ jobId: "a", sessionId: "s1", workspaceId: "ws1", execute: () => g1.gate });
    orch.enqueue({ jobId: "b", sessionId: "s2", workspaceId: "ws2", execute: () => g2.gate });
    // s2 已有 b → session 上限
    orch.enqueue({ jobId: "c-session", sessionId: "s2", workspaceId: "ws3", execute: async () => {} });
    // ws2 已有 b → workspace 上限
    orch.enqueue({ jobId: "d-workspace", sessionId: "s9", workspaceId: "ws2", execute: async () => {} });
    // 占满 maxGlobal=3
    orch.enqueue({ jobId: "e", sessionId: "s4", workspaceId: "ws4", execute: () => g3.gate });
    // 全局满 → global
    orch.enqueue({ jobId: "f-global", sessionId: "s5", workspaceId: "ws5", execute: async () => {} });

    const stats = orch.getStats();
    expect(stats.queuedByReason).toEqual({ global: 1, session: 1, workspace: 1 });
    expect(stats.runningByWorkspace).toEqual({ ws1: 1, ws2: 1, ws4: 1 });
    expect(orch.getQueuedReason("c-session")).toBe("session");
    expect(orch.getQueuedReason("d-workspace")).toBe("workspace");
    expect(orch.getQueuedReason("f-global")).toBe("global");
    // maxPerWorkspace=0（缺省默认）时不参与判定：无 workspaceId 的任务不受 workspace cap
    expect(stats.limits.maxPerWorkspace).toBe(1);

    g1.release();
    g2.release();
    g3.release();
    await tick(60);
  });

  it("交付消费高优通道：队首优先获槽（先于普通排队任务）", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 9, taskTimeoutMs: 500 });
    const blocker = makeGate();
    const order: string[] = [];
    orch.enqueue({
      jobId: "blocker",
      sessionId: "s0",
      execute: async () => {
        order.push("blocker");
        await blocker.gate;
      },
    });
    orch.enqueue({
      jobId: "normal-1",
      sessionId: "s1",
      execute: async () => {
        order.push("normal-1");
      },
    });
    const consumeDone = orch.runConsumeJob({
      jobId: "consume-1",
      sessionId: "s2",
      queuedTimeoutMs: 1000,
      execute: async () => {
        order.push("consume-1");
      },
    });

    blocker.release();
    await expect(consumeDone).resolves.toBe(true);
    await tick(50);
    // 负向断言（旧实现 FIFO 尾插 → consume 必在 normal 之后，即红）
    expect(order).toEqual(["blocker", "consume-1", "normal-1"]);
  });

  it("消费通道 queuedTimeoutMs 超时放弃：execute 未运行、resolve false（不挂起消费链）", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 9, taskTimeoutMs: 500 });
    const blocker = makeGate();
    orch.enqueue({ jobId: "blocker", sessionId: "s0", execute: () => blocker.gate });
    const execute = vi.fn(async () => {});

    const done = orch.runConsumeJob({ jobId: "consume-x", sessionId: "s1", queuedTimeoutMs: 50, execute });
    await expect(done).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
    // 放弃后出队：不残留、不挂起
    expect(orch.getStats().queued).toBe(0);

    blocker.release();
    await tick(50);
  });

  it("队列满时消费通道同样放弃（resolve false），不挤爆 maxQueued", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 9, taskTimeoutMs: 500, maxQueued: 1 });
    const blocker = makeGate();
    orch.enqueue({ jobId: "blocker", sessionId: "s0", execute: () => blocker.gate });
    orch.enqueue({ jobId: "queued", sessionId: "s1", execute: async () => {} });

    const done = orch.runConsumeJob({ jobId: "consume-full", sessionId: "s2", queuedTimeoutMs: 1000, execute: async () => {} });
    await expect(done).resolves.toBe(false);

    blocker.release();
    await tick(50);
  });
});

/* ─────────────────────── TP-1 spawn_subagent 入池收口（DB + MOCK_LLM + 真 hub） ─────────────────────── */

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

interface SpawnFixture {
  parentAgentId: string;
  subAgentId: string;
  parentSessionId: string;
  subSessionId: string;
}

async function mkSpawnFixture(ctx: Ctx, tag: string): Promise<SpawnFixture> {
  const parent = await ctx.services.agent.create({
    name: `TP父-${tag}`,
    model: "deepseek-chat",
    systemPrompt: "p",
    tools: [],
    tier: "manager",
  });
  const parentAgentId = (parent.data as { id: string }).id;
  const sub = await ctx.services.agent.create({
    name: `TP子-${tag}`,
    model: "deepseek-chat",
    systemPrompt: "s",
    tools: [],
    tier: "sub",
    parentId: parentAgentId,
  });
  const subAgentId = (sub.data as { id: string }).id;
  const parentSession = await ctx.services.session.create({
    title: `TP父会话-${tag}`,
    model: "deepseek-chat",
    agentId: parentAgentId,
  } as any);
  const parentSessionId = (parentSession.data as { id: string }).id;
  // 子 Agent 主会话：spawn Phase A 按 isMainSession 复用此会话
  const subSession = await ctx.services.session.create({
    title: `TP子主会话-${tag}`,
    model: "deepseek-chat",
    agentId: subAgentId,
    isMainSession: true,
    kind: "subagent",
    parentSessionId,
  } as any);
  const subSessionId = (subSession.data as { id: string }).id;
  return { parentAgentId, subAgentId, parentSessionId, subSessionId };
}

async function rmSpawnFixture(fx: SpawnFixture) {
  await prisma.agentMessage.deleteMany({
    where: { OR: [{ fromAgentId: fx.parentAgentId }, { toAgentId: fx.subAgentId }] },
  }).catch(() => {});
  await prisma.sessionQueueItem.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.chatMessage.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.task.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.chatSession.deleteMany({
    where: { id: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: { in: [fx.subAgentId, fx.parentAgentId] } } }).catch(() => {});
}

function makeSpawnCtx(ctx: Ctx, narrow: Ctx["config"], fx: SpawnFixture) {
  return {
    ...ctx,
    config: narrow,
    sessionId: fx.parentSessionId,
    agentSnapshot: {
      id: fx.parentAgentId,
      model: "deepseek-chat",
      systemPrompt: "p",
      tools: [],
      tier: "manager" as const,
      workspaceId: null,
      parentId: null,
    },
    invokeTrpc: async () => ({ ok: true }),
  };
}

describe("TP-1 spawn_subagent 入池收口", () => {
  beforeEach(() => {
    resetSwarmBus();
    resetSwarmOrchestratorForTests();
    resetAsyncJobOrchestratorForTests();
    process.env.MOCK_LLM = "true";
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
  });

  afterEach(() => {
    setStreamHub(null);
    delete process.env.MOCK_LLM;
    resetAsyncJobOrchestratorForTests();
    resetSwarmOrchestratorForTests();
    vi.restoreAllMocks();
  });

  it("waitForResult=false 入池：queued 可见 → 获槽起流 → 槽位持有到 waitFor 解析", async () => {
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1 },
    });
    const fx = await mkSpawnFixture(ctx, "pool");
    const orch = getAsyncJobOrchestrator(narrow);
    const toolCtx = makeSpawnCtx(ctx, narrow, fx);
    let releasePlaceholderClaim: () => void = () => {};

    try {
      // 1) 占满全局唯一槽位 → spawn 只能排队
      const blocker = makeGate();
      orch.enqueue({ jobId: "blocker", sessionId: "other-session", execute: () => blocker.gate });

      const spawned = (await executeNativeTool(
        "spawn_subagent",
        { task: "TP1 入池验证", agentId: fx.subAgentId },
        toolCtx,
      )) as {
        success?: boolean;
        status?: string;
        jobId?: string;
        subagentSessionId?: string;
        message?: string;
      };
      expect(spawned.success).toBe(true);
      expect(spawned.status).toBe("queued");
      expect(spawned.jobId).toBeTruthy();
      expect(spawned.subagentSessionId).toBe(fx.subSessionId);

      // queued 期间右栏可见「agent 未启动」：跟踪 Task queued + 子会话 queued
      const taskRow = await prisma.task.findUnique({ where: { id: spawned.jobId! } });
      expect(taskRow?.status).toBe("queued");
      const subRow = await prisma.chatSession.findUnique({ where: { id: fx.subSessionId } });
      expect(subRow?.status).toBe("queued");
      expect(orch.getPosition(spawned.jobId!)).toBe(0);

      // 2) 占住子会话（模拟另一条池内起流——claim 后不计交互 running，Q2 口径），
      //    再放行全局槽 → spawn 获槽但 waitFor 被子流卡住
      const childGate = makeGate();
      const hub = getStreamHub()!;
      const releasePlaceholderClaimInner = orch.claimOccupancy(fx.subSessionId);
      releasePlaceholderClaim = releasePlaceholderClaimInner;
      await hub.start(
        fx.subSessionId,
        { sessionId: fx.subSessionId, agentId: fx.subAgentId, message: "占位" },
        async (emit) => {
          await childGate.gate;
          emit({
            type: "done",
            sessionId: fx.subSessionId,
            agentId: fx.subAgentId,
            content: "占位完成",
            toolCalls: [],
            model: "m",
            provider: "p",
            roundsUsed: 1,
          });
        },
      );
      blocker.release();
      await vi.waitFor(() => expect(orch.isRunning(spawned.jobId!)).toBe(true), { timeout: 3000, interval: 20 });

      // 槽位持有到 waitFor 解析：期间全局槽仍满，再派普通任务只能排队
      let lateRan = false;
      orch.enqueue({
        jobId: "late",
        sessionId: "other-2",
        execute: async () => {
          lateRan = true;
        },
      });
      expect(orch.isQueued("late")).toBe(true);
      // 不双算（Q2 易错点）：子会话流已被 spawn 池任务 claim → hub 交互 running = 0
      await vi.waitFor(() => expect(orch.getStats().hubInteractiveRunning).toBe(0), { timeout: 2000, interval: 20 });

      // 3) 子流结束 → waitFor 解析 → 槽位释放 → late 获槽
      //    （late 执行极快，isRunning 瞬态可能被轮询错过 → 用执行标记断言）
      childGate.release();
      await vi.waitFor(() => expect(lateRan).toBe(true), { timeout: 3000, interval: 20 });
      await vi.waitFor(() => expect(orch.getStats().runningGlobal).toBe(0), { timeout: 3000, interval: 20 });

      // 4) busy 期间入队的消息由消费通道 drain 续跑，最终落进子会话历史
      await vi.waitFor(
        async () => {
          const msg = await prisma.chatMessage.findFirst({
            where: { sessionId: fx.subSessionId, role: "user", content: "TP1 入池验证" },
          });
          expect(msg).toBeTruthy();
        },
        { timeout: 8000, interval: 50 },
      );
    } finally {
      releasePlaceholderClaim();
      await rmSpawnFixture(fx);
    }
  }, 20_000);

  it("waitForResult=true 槽位血缘继承：maxGlobal=1 被占满仍能跑完、不占新槽", async () => {
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1 },
    });
    const fx = await mkSpawnFixture(ctx, "sync");
    const orch = getAsyncJobOrchestrator(narrow);
    const toolCtx = makeSpawnCtx(ctx, narrow, fx);

    // 占满全局唯一槽位：若 waitForResult=true 也入池抢槽必死锁（负向断言即超时）
    const blocker = makeGate();
    orch.enqueue({ jobId: "blocker", sessionId: "other-session", execute: () => blocker.gate });

    try {
      const result = (await executeNativeTool(
        "spawn_subagent",
        { task: "TP1 血缘验证", agentId: fx.subAgentId, waitForResult: true },
        toolCtx,
      )) as { success?: boolean; status?: string; content?: string };

      // 血缘继承：inline 起流跑完，全程未占新槽
      expect(result.success).toBe(true);
      expect(result.status).toBe("success");
      expect(result.content).toBeTruthy();
      expect(orch.getStats().runningGlobal).toBe(1); // 仍只有 blocker
      // claim 已释放（不泄漏 → 不阻塞后续 admit）
      expect(orch.isOccupancyClaimed(fx.subSessionId)).toBe(false);
    } finally {
      blocker.release();
      await tick(50);
      await rmSpawnFixture(fx);
    }
  }, 20_000);

  it("maxSubagentsPerSession 在 spawn manual path 生效（超限明确报错，不落任何记录）", async () => {
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxSubagentsPerSession: 2 },
    });
    const fx = await mkSpawnFixture(ctx, "cap");
    const toolCtx = makeSpawnCtx(ctx, narrow, fx);

    try {
      // 已有 2 个活跃子会话（running / queued 各一）达到上限
      await ctx.services.session.create({
        title: "活跃子会话 A",
        model: "deepseek-chat",
        agentId: fx.subAgentId,
        kind: "subagent",
        parentSessionId: fx.parentSessionId,
        status: "running",
      } as any);
      const extra = await ctx.services.session.create({
        title: "活跃子会话 B",
        model: "deepseek-chat",
        agentId: fx.subAgentId,
        kind: "subagent",
        parentSessionId: fx.parentSessionId,
        status: "queued",
      } as any);
      const extraSessionId = (extra.data as { id: string }).id;

      // 负向断言（旧实现此路径无检查 → 必派生成功，即红）
      await expect(
        executeNativeTool("spawn_subagent", { task: "超限验证", agentId: fx.subAgentId }, toolCtx),
      ).rejects.toThrow(/每会话子 Agent 上限/);

      // 未落任何跟踪 Task / 新子会话
      expect(await prisma.task.count({ where: { sessionId: fx.parentSessionId } })).toBe(0);
      const subCount = await prisma.chatSession.count({
        where: { parentSessionId: fx.parentSessionId, kind: "subagent" },
      });
      expect(subCount).toBe(3); // fixture 主会话 + A + B，无新增
      await prisma.chatSession.deleteMany({ where: { id: extraSessionId } }).catch(() => {});
    } finally {
      await prisma.chatSession.deleteMany({
        where: { parentSessionId: fx.parentSessionId, kind: "subagent", id: { not: fx.subSessionId } },
      }).catch(() => {});
      await rmSpawnFixture(fx);
    }
  }, 15_000);

  it("session.spawn 池任务（buildAsyncExecute）起流 claim 占用：子会话流不计 hub 交互 running（双算防线）", async () => {
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 2 },
    });
    const orch = getAsyncJobOrchestrator(narrow);

    const agent = await ctx.services.agent.create({
      name: `TP双算-${Date.now()}`,
      model: "deepseek-chat",
      systemPrompt: "p",
      tools: [],
      tier: "manager",
    });
    const agentId = (agent.data as { id: string }).id;
    const parentSession = await ctx.services.session.create({
      title: "TP双算父会话",
      model: "deepseek-chat",
      agentId,
    } as any);
    const parentSessionId = (parentSession.data as { id: string }).id;
    let subagentSessionId: string | undefined;

    try {
      // 1) 占满全局容量：1 池槽 + 1 交互流（chat-1）→ spawn 池任务只能排队
      const blocker = makeGate();
      orch.enqueue({ jobId: "blocker", sessionId: "other-session", execute: () => blocker.gate });
      const chatGate = makeGate();
      const hub = getStreamHub()!;
      await hub.start("chat-1", { sessionId: "chat-1", agentId, message: "占用" }, async (emit) => {
        await chatGate.gate;
        emit({ type: "done", sessionId: "chat-1", agentId, content: "ok", toolCalls: [], model: "m", provider: "p", roundsUsed: 1 });
      });

      const started = await startAsyncAgentTask({
        sessionId: parentSessionId,
        task: "双算防线验证",
        label: "双算防线",
        config: narrow,
        services: ctx.services,
        agent: { id: agentId, model: "deepseek-chat", systemPrompt: "p", tools: [] },
        source: "session.spawn",
        isSubagent: true,
      });
      subagentSessionId = started.subagentSessionId;
      expect(subagentSessionId).toBeTruthy();
      expect(started.status).toBe("queued");

      // 2) 子会话被另一条流占住（模拟池任务获槽前子会话已有活跃流）→ 交互 running=2
      const childGate = makeGate();
      await hub.start(subagentSessionId!, { sessionId: subagentSessionId!, agentId, message: "占位" }, async (emit) => {
        await childGate.gate;
        emit({ type: "done", sessionId: subagentSessionId!, agentId, content: "占位完成", toolCalls: [], model: "m", provider: "p", roundsUsed: 1 });
      });

      // 3) 放行 chat-1 与 blocker → 任务获槽。execute 起流前 claim 子会话（Q2 不双算）
      chatGate.release();
      blocker.release();
      await vi.waitFor(() => expect(orch.isRunning(started.jobId)).toBe(true), { timeout: 3000, interval: 20 });

      // 负向断言（旧实现 buildAsyncExecute 不 claim → 子会话流被 hub 交互 running 再计一次，
      // 同一执行体占 2 份全局容量：hubInteractiveRunning 停在 1、late 无法获槽，必红）
      await vi.waitFor(() => expect(orch.getStats().hubInteractiveRunning).toBe(0), { timeout: 3000, interval: 20 });
      let lateRan = false;
      orch.enqueue({ jobId: "late", sessionId: "other-2", execute: async () => { lateRan = true; } });
      await vi.waitFor(() => expect(lateRan).toBe(true), { timeout: 3000, interval: 20 });

      // 4) 子会话流结束 → waitFor 解析 → 槽位释放、claim 不泄漏
      childGate.release();
      await vi.waitFor(() => expect(orch.getStats().runningGlobal).toBe(0), { timeout: 3000, interval: 20 });
      expect(orch.isOccupancyClaimed(subagentSessionId!)).toBe(false);
    } finally {
      await prisma.task.deleteMany({ where: { sessionId: { in: [parentSessionId, subagentSessionId ?? ""] } } }).catch(() => {});
      await prisma.chatMessage.deleteMany({ where: { sessionId: { in: [parentSessionId, subagentSessionId ?? ""] } } }).catch(() => {});
      await prisma.chatSession.deleteMany({ where: { id: { in: [parentSessionId, subagentSessionId ?? ""] } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { OR: [{ id: agentId }, { parentId: agentId }] } }).catch(() => {});
    }
  }, 20_000);
});

/* ─────────────────────── TP-1 消费续跑池准入（DB） ─────────────────────── */

describe("TP-1 消费续跑池准入", () => {
  beforeEach(() => {
    resetSwarmBus();
    resetSwarmOrchestratorForTests();
    resetAsyncJobOrchestratorForTests();
    process.env.MOCK_LLM = "true";
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
  });

  afterEach(() => {
    setStreamHub(null);
    delete process.env.MOCK_LLM;
    resetAsyncJobOrchestratorForTests();
    resetSwarmOrchestratorForTests();
    vi.restoreAllMocks();
  });

  it("autoConsume：池满等槽超时 → 放弃本轮，delivery 未 CLAIM 不丢", async () => {
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1, queuedTimeoutMs: 100 },
    });
    const orch = getAsyncJobOrchestrator(narrow);

    const agent = await ctx.services.agent.create({
      name: `TP消费-${Date.now()}`,
      model: "deepseek-chat",
      systemPrompt: "p",
      tools: [],
      tier: "manager",
    });
    const agentId = (agent.data as { id: string }).id;
    const session = await ctx.services.session.create({
      title: "TP消费会话",
      model: "deepseek-chat",
      agentId,
      status: "active",
    } as any);
    const sessionId = (session.data as { id: string }).id;

    const job = await prisma.task.create({
      data: {
        name: "[async] T-drop",
        type: "async_agent",
        status: "success",
        sessionId,
        input: {
          kind: "async_agent",
          sessionId,
          task: "t",
          taskLabel: "T-drop",
          agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [] },
          deliverToQueue: true,
        },
        output: { asyncResult: "结果" },
      },
    });

    // 占满全局唯一槽位（持有 600ms，覆盖 consume 的 100ms 等槽窗口）
    const blocker = makeGate();
    orch.enqueue({
      jobId: "blocker",
      sessionId: "other-session",
      execute: async () => {
        await blocker.gate;
      },
    });
    const autoRelease = setTimeout(blocker.release, 600);

    try {
      const r = await autoConsumeAsyncDelivery({
        sessionId,
        jobId: job.id,
        status: "done",
        taskLabel: "T-drop",
        services: ctx.services,
        config: narrow,
      });
      expect(r).toBe("started");

      // 等槽 100ms 超时 → 放弃本轮（负向断言：旧实现无池准入、直起，不存在「放弃」语义）
      await tick(400);
      const row = await prisma.task.findUnique({ where: { id: job.id } });
      // 不丢：未 CLAIM，delivery 留待下次触发
      expect(row?.delivered).toBe(false);
      // 消费链未挂起：队列无残留
      expect(orch.getStats().queued).toBe(0);
    } finally {
      clearTimeout(autoRelease);
      blocker.release();
      await tick(50);
      await prisma.task.deleteMany({ where: { id: job.id } }).catch(() => {});
      await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => {});
    }
  }, 15_000);
});
