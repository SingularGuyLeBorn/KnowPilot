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
import {
  autoConsumeAsyncDelivery,
  cancelAsyncJob,
  startAsyncAgentTask,
} from "../infra/asyncJobManager.js";
import { registerMockLlmScenario } from "../infra/mockLlmClient.js";
import type { LlmToolCall } from "../infra/llmClient.js";
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

function makeSpawnCtx(ctx: Ctx, narrow: Ctx["config"], fx: Pick<SpawnFixture, "parentAgentId" | "parentSessionId">) {
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

/* ─────────────────────── TP-4 防崩压测（负向断言：每条旧实现必挂） ─────────────────────── */

/**
 * TP-4 压测专用 mock 场景：子 Agent 第一轮调 agent_report_back、第二轮给最终答复。
 * 窄 match（唯一 marker + agent_report_back 工具在场），不干扰本进程其他测试/场景
 * （registerMockLlmScenario 无 unregister：注册一次，marker 唯一即隔离）。
 */
const TP4_STRESS_MARKER = "TP4压测";
let tp4MockCallSeq = 0;

function tp4ReportBackCall(): LlmToolCall {
  tp4MockCallSeq += 1;
  return {
    id: `mock_call_tp4_report_${tp4MockCallSeq}`,
    type: "function",
    function: { name: "agent_report_back", arguments: JSON.stringify({ content: "压测子任务完成回报" }) },
  };
}

registerMockLlmScenario({
  name: "tp4_stress_report_back",
  match: (opts, forced) => {
    if (forced) return false;
    if (!opts.tools?.some((t) => t.function.name === "agent_report_back")) return false;
    for (let i = opts.messages.length - 1; i >= 0; i--) {
      const m = opts.messages[i];
      if (m.role === "user" && typeof m.content === "string") {
        return m.content.includes(TP4_STRESS_MARKER);
      }
    }
    return false;
  },
  completion: (opts) => {
    const hasToolResult = opts.messages.some((m) => m.role === "tool");
    return {
      content: hasToolResult ? "压测子任务最终答复" : null,
      reasoningContent: null,
      toolCalls: hasToolResult ? [] : [tp4ReportBackCall()],
      finishReason: "stop",
      model: opts.model || "mock-llm",
      provider: "mock",
      tokenUsage: { prompt: 10, completion: 12, total: 22 },
    };
  },
  stream: async function* (opts) {
    const hasToolResult = opts.messages.some((m) => m.role === "tool");
    if (hasToolResult) {
      for (const delta of "压测子任务最终答复") {
        yield { type: "token" as const, delta, model: opts.model, provider: "mock" };
      }
      yield {
        type: "token" as const,
        delta: "",
        finishReason: "stop",
        model: opts.model,
        provider: "mock",
        tokenUsage: { prompt: 10, completion: 12, total: 22 },
      };
      return;
    }
    yield {
      type: "tool_calls" as const,
      toolCalls: [tp4ReportBackCall()],
      finishReason: "tool_calls",
      model: opts.model,
      provider: "mock",
      tokenUsage: { prompt: 10, completion: 12, total: 22 },
    };
  },
});

interface ParentFixture {
  parentAgentId: string;
  parentSessionId: string;
}

async function mkParentFixture(ctx: Ctx, tag: string): Promise<ParentFixture> {
  const parent = await ctx.services.agent.create({
    name: `TP4父-${tag}`,
    model: "deepseek-chat",
    systemPrompt: "p",
    tools: [],
    tier: "manager",
  });
  const parentAgentId = (parent.data as { id: string }).id;
  const parentSession = await ctx.services.session.create({
    title: `TP4父会话-${tag}`,
    model: "deepseek-chat",
    agentId: parentAgentId,
  } as any);
  return { parentAgentId, parentSessionId: (parentSession.data as { id: string }).id };
}

/** 在既有父 fixture 下追加一个子 Agent + 其子主会话（需要预占子会话的场景） */
async function mkSubAgentFixture(
  ctx: Ctx,
  fx: ParentFixture,
  tag: string,
): Promise<{ subAgentId: string; subSessionId: string }> {
  const sub = await ctx.services.agent.create({
    name: `TP4子-${tag}`,
    model: "deepseek-chat",
    systemPrompt: "s",
    tools: [],
    tier: "sub",
    parentId: fx.parentAgentId,
  });
  const subAgentId = (sub.data as { id: string }).id;
  const subSession = await ctx.services.session.create({
    title: `TP4子主会话-${tag}`,
    model: "deepseek-chat",
    agentId: subAgentId,
    isMainSession: true,
    kind: "subagent",
    parentSessionId: fx.parentSessionId,
  } as any);
  return { subAgentId, subSessionId: (subSession.data as { id: string }).id };
}

/** 父 fixture 级联清理（含压测产生的全部子 Agent/子会话/跟踪 Task/消息/队列项/旁路邮箱） */
async function rmParentFixture(fx: ParentFixture) {
  const children = await prisma.chatSession
    .findMany({ where: { parentSessionId: fx.parentSessionId }, select: { id: true, agentId: true } })
    .catch(() => [] as Array<{ id: string; agentId: string | null }>);
  const childSessionIds = children.map((c) => c.id);
  const childAgentIds = children.map((c) => c.agentId).filter((x): x is string => !!x);
  const sessionIds = [fx.parentSessionId, ...childSessionIds];
  await prisma.agentMessage
    .deleteMany({
      where: {
        OR: [
          { fromAgentId: fx.parentAgentId },
          { toAgentId: fx.parentAgentId },
          { fromAgentId: { in: childAgentIds } },
          { toAgentId: { in: childAgentIds } },
        ],
      },
    })
    .catch(() => {});
  await prisma.sessionQueueItem.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
  await prisma.task.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
  await prisma.agent
    .deleteMany({ where: { OR: [{ id: fx.parentAgentId }, { parentId: fx.parentAgentId }] } })
    .catch(() => {});
}

describe("TP-4 防崩压测", () => {
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

  it("50 spawn 压测：峰值 running ≤ maxGlobal、queued position 连续无空洞、reason=global、50 终态", async () => {
    // 旧实现挂点：spawn 不入池（各入口直起）→ 峰值 running 远超 maxGlobal（peak 断言必红）、
    // 无 queued/position/reason 语义（快照断言同红）；若旧实现入池但无全局上限 → 50 并发直跑，peak 仍红。
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: {
        ...ctx.config.asyncJobs,
        maxConcurrent: 2,
        maxPerSession: 100,
        maxQueued: 100,
        maxSubagentsPerSession: 200,
      },
    });
    const fx = await mkParentFixture(ctx, "压测");
    const orch = getAsyncJobOrchestrator(narrow);
    const toolCtx = makeSpawnCtx(ctx, narrow, fx);

    const SPAWN_COUNT = 50;
    const blocker1 = makeGate();
    const blocker2 = makeGate();
    // 采样器：事件 + 定时双通道采样 runningGlobal 峰值（不变量：任一时刻 ≤ maxGlobal）
    let peakRunning = 0;
    const sample = () => {
      peakRunning = Math.max(peakRunning, orch.getStats().runningGlobal);
    };
    const offSample = orch.onAny(sample);
    const sampler = setInterval(sample, 5);

    try {
      // 1) 两个 blocker 占满 maxGlobal=2 → 之后 50 个 spawn 全部只能排队
      orch.enqueue({ jobId: "tp4-blocker-1", sessionId: "other-1", execute: () => blocker1.gate });
      orch.enqueue({ jobId: "tp4-blocker-2", sessionId: "other-2", execute: () => blocker2.gate });

      // 2) 同一父会话连续 spawn 50 个子 Agent（waitForResult=false，各自独立子 Agent/会话；
      //    任务文本互异 → 不触发 60s dedup；显式 name → 跳过 fire-and-forget 自动命名）
      const spawned: Array<{ jobId: string; subagentSessionId?: string }> = [];
      for (let i = 0; i < SPAWN_COUNT; i++) {
        const r = (await executeNativeTool(
          "spawn_subagent",
          { task: `${TP4_STRESS_MARKER}-${i}`, name: `TP4压测子-${i}` },
          toolCtx,
        )) as { success?: boolean; status?: string; jobId?: string; subagentSessionId?: string };
        expect(r.success).toBe(true);
        expect(r.status).toBe("queued");
        expect(r.jobId).toBeTruthy();
        spawned.push({ jobId: r.jobId!, subagentSessionId: r.subagentSessionId });
      }

      // 3) 排队快照：50 个全在队列；position 恰好 0..49 连续无空洞（UI 侧展示 1..50）；
      //    前 2 个槽被 blocker 占满 → 之后全部 reason=global
      expect(orch.getStats().queued).toBe(SPAWN_COUNT);
      const positions = spawned.map((s) => orch.getPosition(s.jobId));
      expect(positions.every((p) => p !== undefined)).toBe(true);
      expect([...positions].sort((a, b) => a! - b!)).toEqual(Array.from({ length: SPAWN_COUNT }, (_, i) => i));
      for (const s of spawned) expect(orch.getQueuedReason(s.jobId)).toBe("global");

      // 4) 放行 → 全部跑完：report_back 桥接把 50 个跟踪 Task 全部落到终态
      blocker1.release();
      blocker2.release();
      const jobIds = spawned.map((s) => s.jobId);
      await vi.waitFor(
        async () => {
          const rows = await prisma.task.findMany({ where: { id: { in: jobIds } }, select: { status: true } });
          expect(rows).toHaveLength(SPAWN_COUNT);
          expect(rows.every((r) => r.status === "success" || r.status === "failed")).toBe(true);
        },
        { timeout: 90_000, interval: 200 },
      );
      const terminal = await prisma.task.findMany({ where: { id: { in: jobIds } }, select: { status: true } });
      expect(terminal.filter((r) => r.status === "success")).toHaveLength(SPAWN_COUNT);

      // 5) 池与流全部排空（含 report_back 触发的父会话 autoConsume 续跑），不留后台活动
      await vi.waitFor(
        () => {
          const s = orch.getStats();
          expect(s.runningGlobal).toBe(0);
          expect(s.queued).toBe(0);
        },
        { timeout: 60_000, interval: 100 },
      );
      await vi.waitFor(() => expect(getStreamHub()!.runningCount()).toBe(0), { timeout: 30_000, interval: 100 });

      // 6) 峰值断言：任一时刻全局 running 未越上限；且确实打满过双槽（压测真实制造了并发压力）
      expect(peakRunning).toBeLessThanOrEqual(2);
      expect(peakRunning).toBe(2);
    } finally {
      clearInterval(sampler);
      offSample();
      blocker1.release();
      blocker2.release();
      await rmParentFixture(fx);
    }
  }, 150_000);

  it("池满 + maxQueued 打满后再 spawn：明确拒绝（队列已满），不留垃圾 Task/会话行", async () => {
    // 旧实现挂点：无限入队 → 第二个 spawn 成功返回 queued（rejects 断言必红），
    // 其跟踪 Task 永远挂 queued（垃圾行断言同红）。
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1, maxPerSession: 100, maxQueued: 1, maxSubagentsPerSession: 100 },
    });
    const fx = await mkParentFixture(ctx, "拒绝");
    const orch = getAsyncJobOrchestrator(narrow);
    const toolCtx = makeSpawnCtx(ctx, narrow, fx);
    const blocker = makeGate();
    orch.enqueue({ jobId: "tp4-blocker", sessionId: "other", execute: () => blocker.gate });

    try {
      // 第一个 spawn：占满唯一排队位（maxQueued=1）
      const first = (await executeNativeTool(
        "spawn_subagent",
        { task: "TP4拒绝-1", name: "TP4拒绝子-1" },
        toolCtx,
      )) as { success?: boolean; status?: string; jobId?: string };
      expect(first.success).toBe(true);
      expect(first.status).toBe("queued");
      expect(orch.getStats().queued).toBe(1);

      // 第二个 spawn：池满 + 队列满 → 明确拒绝
      await expect(
        executeNativeTool("spawn_subagent", { task: "TP4拒绝-2", name: "TP4拒绝子-2" }, toolCtx),
      ).rejects.toThrow(/队列已满（maxQueued=1），请稍后再派/);

      // 不留垃圾：#2 的 Phase A 产物被回收——跟踪 Task 落 failed 终态（错误如实记录）、
      // 子会话落 failed；唯一的非终态行是 #1（合法在队，非垃圾）
      const tasks = await prisma.task.findMany({ where: { sessionId: fx.parentSessionId } });
      expect(tasks).toHaveLength(2);
      const taskOf = (marker: string) => tasks.find((t) => JSON.stringify(t.input).includes(marker));
      expect(taskOf("TP4拒绝-1")?.status).toBe("queued");
      const rejected = taskOf("TP4拒绝-2");
      expect(rejected?.status).toBe("failed");
      expect(JSON.stringify(rejected?.output)).toMatch(/队列已满/);

      const subSessions = await prisma.chatSession.findMany({
        where: { parentSessionId: fx.parentSessionId, kind: "subagent" },
      });
      expect(subSessions).toHaveLength(2);
      expect(subSessions.map((s) => s.status).sort()).toEqual(["failed", "queued"]);

      // #2 从未进队：队列仍只有 #1；#1 可正常取消（在队任务取消语义）
      expect(orch.getStats().queued).toBe(1);
      expect(orch.isQueued(first.jobId!)).toBe(true);
      const cancel = await cancelAsyncJob(first.jobId!, narrow, ctx.services);
      expect(cancel.cancelled).toBe(true);
      expect(orch.getStats().queued).toBe(0);
    } finally {
      blocker.release();
      await tick(50);
      await rmParentFixture(fx);
    }
  }, 20_000);

  it("cancel 级联：取消父跟踪 Task → queued 子任务从队列消失、running 子流被 signal abort", async () => {
    // 旧实现挂点：spawn 不经池 → 跟踪 Task 与池任务不同源，cancel 只改 DB 不动执行体：
    // running 子流收不到 abort（childAborted 恒 false → 红）；queued 语义不存在，
    // 「从队列消失」无从谈起（isQueued 断言同红）。
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1, maxPerSession: 100, maxSubagentsPerSession: 100 },
    });
    const fx = await mkParentFixture(ctx, "级联");
    const subA = await mkSubAgentFixture(ctx, fx, "级联A");
    const subB = await mkSubAgentFixture(ctx, fx, "级联B");
    const orch = getAsyncJobOrchestrator(narrow);
    const hub = getStreamHub()!;
    const toolCtx = makeSpawnCtx(ctx, narrow, fx);

    const gateA = makeGate();
    let childAborted = false;
    let releasePlaceholderClaim: () => void = () => {};

    try {
      // 1) 预占 A 的子会话（占位流卡 gate）：A 获槽后派活走 busy 分支，池任务挂在 waitFor 上保持 running。
      //    占位流先 claim 占用（模拟池内起流场景，不计 hub 交互 running）——否则 maxGlobal=1 下
      //    占位流本身就占满全局容量，A 永远获不了槽。
      releasePlaceholderClaim = orch.claimOccupancy(subA.subSessionId);
      await hub.start(
        subA.subSessionId,
        { sessionId: subA.subSessionId, agentId: subA.subAgentId, message: "占位" },
        async (_emit, signal) => {
          await Promise.race([
            gateA.gate,
            new Promise<void>((resolve) =>
              signal.addEventListener(
                "abort",
                () => {
                  childAborted = true;
                  resolve();
                },
                { once: true },
              ),
            ),
          ]);
        },
      );

      // 2) A 获唯一槽（maxGlobal=1）保持 running
      const a = (await executeNativeTool(
        "spawn_subagent",
        { task: "TP4级联-A", agentId: subA.subAgentId },
        toolCtx,
      )) as { success?: boolean; status?: string; jobId?: string };
      expect(a.success).toBe(true);
      expect(a.status).toBe("running");
      await vi.waitFor(
        async () => {
          expect((await prisma.task.findUnique({ where: { id: a.jobId! } }))?.status).toBe("running");
        },
        { timeout: 3000, interval: 20 },
      );

      // 3) B 只能排队（reason=global）
      const b = (await executeNativeTool(
        "spawn_subagent",
        { task: "TP4级联-B", agentId: subB.subAgentId },
        toolCtx,
      )) as { success?: boolean; status?: string; jobId?: string };
      expect(b.success).toBe(true);
      expect(b.status).toBe("queued");
      expect(orch.isQueued(b.jobId!)).toBe(true);
      expect(orch.getQueuedReason(b.jobId!)).toBe("global");

      // 4) 取消 B（排队中）：从队列消失 + Task 落 failed 终态
      const cancelB = await cancelAsyncJob(b.jobId!, narrow, ctx.services);
      expect(cancelB.cancelled).toBe(true);
      expect(orch.isQueued(b.jobId!)).toBe(false);
      expect(orch.getPosition(b.jobId!)).toBeUndefined();
      const bRow = await prisma.task.findUnique({ where: { id: b.jobId! } });
      expect(bRow?.status).toBe("failed");
      expect(JSON.stringify(bRow?.output)).toMatch(/取消/);

      // 5) 取消 A（运行中）：signal abort 级联到子会话流（占位流被 hub.stop）
      // 先清 busy 入队的 superior 项，避免 hub.finally → drain 立刻重起流导致 isRunning 又变 true
      await prisma.sessionQueueItem.deleteMany({ where: { sessionId: subA.subSessionId } }).catch(() => {});
      const cancelA = await cancelAsyncJob(a.jobId!, narrow, ctx.services);
      expect(cancelA.cancelled).toBe(true);
      await vi.waitFor(() => expect(childAborted).toBe(true), { timeout: 3000, interval: 20 });
      await vi.waitFor(() => expect(orch.isRunning(a.jobId!)).toBe(false), { timeout: 3000, interval: 20 });
      await vi.waitFor(() => expect(hub.isRunning(subA.subSessionId)).toBe(false), {
        timeout: 3000,
        interval: 20,
      });
      await vi.waitFor(
        async () => {
          expect((await prisma.task.findUnique({ where: { id: a.jobId! } }))?.status).toBe("failed");
        },
        { timeout: 3000, interval: 20 },
      );
    } finally {
      // 清掉 busy 分支入队的 superior 项再结束占位流，避免 drain 续跑干扰后续测试
      await prisma.sessionQueueItem.deleteMany({ where: { sessionId: subA.subSessionId } }).catch(() => {});
      gateA.release();
      releasePlaceholderClaim();
      await tick(80);
      await rmParentFixture(fx);
    }
  }, 20_000);

  it("queuedTimeoutMs 到期回收：排队超时出队 + timeout 事件 + onQueuedDrop，execute 未运行", async () => {
    // 旧实现挂点：无排队超时回收 → 任务永远停在队列（dropped 恒 false → waitFor 超时红；
    // isQueued 恒 true → 同红）。
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 5, taskTimeoutMs: 500 });
    const blocker = makeGate();
    orch.enqueue({ jobId: "blocker", sessionId: "s0", execute: () => blocker.gate });
    const events: string[] = [];
    orch.onAny((ev) => events.push(`${ev.type}:${ev.jobId}`));
    const execute = vi.fn(async () => {});
    let dropped = false;

    orch.enqueue({
      jobId: "slow",
      sessionId: "s1",
      queuedTimeoutMs: 60,
      onQueuedDrop: () => {
        dropped = true;
      },
      execute,
    });
    expect(orch.isQueued("slow")).toBe(true);

    await vi.waitFor(() => expect(dropped).toBe(true), { timeout: 2000, interval: 10 });
    expect(orch.isQueued("slow")).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContain("timeout:slow");
    expect(orch.getStats().queued).toBe(0);

    blocker.release();
    await tick(50);
  });

  it("queuedTimeout 回收不丢 delivery：等槽超时放弃（落告警）→ 下次触发成功 CLAIM 续跑", async () => {
    // 旧实现挂点：autoConsume 无池准入（直起）→ 第一轮 delivered 立即为 true
    // （「未 CLAIM 不丢」断言必红），也不存在「等槽超时放弃本轮」告警（告警断言同红）。
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1, queuedTimeoutMs: 100 },
    });
    const orch = getAsyncJobOrchestrator(narrow);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const agent = await ctx.services.agent.create({
      name: `TP4回收-${Date.now()}`,
      model: "deepseek-chat",
      systemPrompt: "p",
      tools: [],
      tier: "manager",
    });
    const agentId = (agent.data as { id: string }).id;
    const session = await ctx.services.session.create({
      title: "TP4回收会话",
      model: "deepseek-chat",
      agentId,
      status: "active",
    } as any);
    const sessionId = (session.data as { id: string }).id;

    const job = await prisma.task.create({
      data: {
        name: "[async] T-requeue",
        type: "async_agent",
        status: "success",
        sessionId,
        input: {
          kind: "async_agent",
          sessionId,
          task: "t",
          taskLabel: "T-requeue",
          agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [] },
          deliverToQueue: true,
        },
        output: { asyncResult: "回收验证结果" },
      },
    });

    const blocker = makeGate();
    orch.enqueue({ jobId: "blocker", sessionId: "other", execute: () => blocker.gate });

    try {
      // 第一轮：池满 → 等槽 100ms 超时放弃本轮：delivery 未 CLAIM（不丢）+ 落日志告警
      const r1 = await autoConsumeAsyncDelivery({
        sessionId,
        jobId: job.id,
        status: "done",
        taskLabel: "T-requeue",
        services: ctx.services,
        config: narrow,
      });
      expect(r1).toBe("started");
      await tick(400);
      expect((await prisma.task.findUnique({ where: { id: job.id } }))?.delivered).toBe(false);
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("等槽超时放弃本轮"))).toBe(true);
      expect(orch.getStats().queued).toBe(0);

      // 第二轮：放槽后再次触发 → 成功 CLAIM + 真实续跑（delivery 不丢的完整闭环）
      blocker.release();
      const r2 = await autoConsumeAsyncDelivery({
        sessionId,
        jobId: job.id,
        status: "done",
        taskLabel: "T-requeue",
        services: ctx.services,
        config: narrow,
      });
      expect(r2).toBe("started");
      await vi.waitFor(
        async () => {
          expect((await prisma.task.findUnique({ where: { id: job.id } }))?.delivered).toBe(true);
        },
        { timeout: 5000, interval: 50 },
      );
      // 续跑真实发生：结果文本被注入为用户消息，mock 答复落 assistant
      await vi.waitFor(
        async () => {
          const injected = await prisma.chatMessage.findFirst({
            where: { sessionId, role: "user", content: "回收验证结果" },
          });
          expect(injected).toBeTruthy();
          const reply = await prisma.chatMessage.findFirst({ where: { sessionId, role: "assistant" } });
          expect(reply).toBeTruthy();
        },
        { timeout: 5000, interval: 50 },
      );
    } finally {
      blocker.release();
      await tick(50);
      await prisma.task.deleteMany({ where: { id: job.id } }).catch(() => {});
      await prisma.chatMessage.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => {});
    }
  }, 20_000);

  it("Q4 死锁回归：maxGlobal=1 池内 Agent waitForResult=true 派子，子不占新槽跑完", async () => {
    // 旧实现挂点：waitForResult=true 的子执行也入池抢槽 → 父持唯一槽等子、子排队等父 → 死锁；
    // 本测试以 waitFor(parentDone, 12s) 为自身超时上限，旧实现必在此变红，不会真挂死套件。
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 1 },
    });
    const fx = await mkSpawnFixture(ctx, "q4");
    const orch = getAsyncJobOrchestrator(narrow);
    const toolCtx = makeSpawnCtx(ctx, narrow, fx);

    let spawnResult: { success?: boolean; status?: string; content?: string } | undefined;
    let spawnError: unknown;
    let parentDone = false;
    let peakRunning = 0;
    const offSample = orch.onAny(() => {
      peakRunning = Math.max(peakRunning, orch.getStats().runningGlobal);
    });

    try {
      // 父执行体在池内（持唯一槽）发起同步派子——血统让渡必须让子 inline 跑完且不抢新槽
      orch.enqueue({
        jobId: "tp4-parent-run",
        sessionId: fx.parentSessionId,
        execute: async () => {
          try {
            spawnResult = (await executeNativeTool(
              "spawn_subagent",
              { task: "TP4死锁回归验证", agentId: fx.subAgentId, waitForResult: true },
              toolCtx,
            )) as typeof spawnResult;
          } catch (err) {
            spawnError = err;
          } finally {
            parentDone = true;
          }
        },
      });

      await vi.waitFor(() => expect(parentDone).toBe(true), { timeout: 12_000, interval: 25 });

      expect(spawnError).toBeUndefined();
      expect(spawnResult?.success).toBe(true);
      expect(spawnResult?.status).toBe("success");
      expect(spawnResult?.content).toBeTruthy();
      // 子不占新槽：全程只有父 job 一个池内执行体（峰值恰为 1）
      expect(peakRunning).toBe(1);
      // claim 不泄漏（泄漏会低估全局占用、阻塞后续 admit）
      expect(orch.isOccupancyClaimed(fx.subSessionId)).toBe(false);
    } finally {
      offSample();
      orch.cancel("tp4-parent-run");
      await tick(50);
      await rmSpawnFixture(fx);
    }
  }, 20_000);

  it("Q2 口径：真 hub 交互流占用收紧池 admit（maxGlobal=2 仅 admit 1），交互结束恢复", async () => {
    // 旧实现挂点：旧口径只看池内 running → 交互流期间 job2 也被 admit
    // （isQueued(job2) 恒 false → 红；peak 直接到 2 → 同红）。
    const ctx = await createContextInner();
    const narrow = createTestConfig(ctx.config.projectRoot, {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 2, maxPerSession: 10 },
    });
    const orch = getAsyncJobOrchestrator(narrow);
    const hub = getStreamHub()!;

    const chatGate = makeGate();
    const g1 = makeGate();
    const g2 = makeGate();
    let peakRunning = 0;
    const offSample = orch.onAny(() => {
      peakRunning = Math.max(peakRunning, orch.getStats().runningGlobal);
    });

    try {
      // 1) 起 1 条真交互流（非池任务、未被 claim）→ 计入全局占用
      await hub.start(
        "tp4-interactive",
        { sessionId: "tp4-interactive", agentId: "tp4-agent", message: "交互占用" },
        async (emit) => {
          await chatGate.gate;
          emit({
            type: "done",
            sessionId: "tp4-interactive",
            agentId: "tp4-agent",
            content: "ok",
            toolCalls: [],
            model: "m",
            provider: "p",
            roundsUsed: 1,
          });
        },
      );

      // 2) maxGlobal=2：占用 = 1 池 + 1 交互 = 2 → 池只能再 admit 1 个
      orch.enqueue({ jobId: "tp4-job-1", sessionId: "s1", execute: () => g1.gate });
      orch.enqueue({ jobId: "tp4-job-2", sessionId: "s2", execute: () => g2.gate });
      await tick();
      expect(orch.isRunning("tp4-job-1")).toBe(true);
      expect(orch.isQueued("tp4-job-2")).toBe(true);
      expect(orch.getQueuedReason("tp4-job-2")).toBe("global");
      expect(orch.getStats().hubInteractiveRunning).toBe(1);
      expect(peakRunning).toBe(1);

      // 3) 交互流结束 → 占用口径回落 → job2 获槽（恢复 admit 2 个）
      chatGate.release();
      await vi.waitFor(() => expect(orch.isRunning("tp4-job-2")).toBe(true), { timeout: 3000, interval: 20 });
      expect(peakRunning).toBe(2);
      expect(orch.getStats().hubInteractiveRunning).toBe(0);
    } finally {
      offSample();
      chatGate.release();
      g1.release();
      g2.release();
      await tick(50);
    }
  }, 15_000);
});
