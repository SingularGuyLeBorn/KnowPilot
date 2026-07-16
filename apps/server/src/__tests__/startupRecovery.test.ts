/**
 * R-2 重启恢复四动作 — 集成测试（负向断言）
 *
 * 统一入口 runStartupRecovery（asyncJobManager.ts，启动序列一次性首扫；周期对账由
 * startAsyncDeliveryReconciler 负责，动作 2 与 R-1 孤儿共用 reconcileAsyncDeliveries 同一幂等入口）：
 * 1. 僵尸 running/queued async Task → failed「服务重启，任务中断」——不自动重跑
 *    （tool 任务有副作用，进程死亡时进度未知，盲目重跑可能重复执行；retryAsyncJob 手动重试）；
 * 2. 僵尸 running ChatSession → paused（条件写；重启后 hub 无活跃流，running 皆尸体）；
 * 3. superior 孤儿 SessionQueueItem → 重新注册 drain（v7 W-E 机制，consume 删除即认领）；
 * 4. delivered=false 终态未投递 → 重新 notify（reconcileAsyncDeliveries Pass 2）。
 *
 * 负向断言（旧实现下必红的断言已逐条标注；旧实现 = 恢复函数不处理该项 / 函数不存在）：
 * - C1：僵尸会话永远停 running（无动作 2）、stale 子会话不被标 failed 之外的收口；
 * - C2：未投递终态 delivered 恒 false、气泡永不出现（无 Pass 2）；
 * - C3：孤儿队列项永久滞留（无 drain 重注册）、user 消息永不写入；
 * 负向验证方式：git stash 生产代码后跑本文件应红。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentStream from "../infra/agentStream.js";
import { createContextInner } from "../trpc/context.js";
import { runStartupRecovery } from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";
import { resetSwarmBus } from "../infra/swarmBus.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `r2${Date.now().toString(36)}`;

async function createAgent(ctx: Ctx, label: string, tier: string, parentId?: string): Promise<string> {
  const agent = await ctx.services.agent.create({
    name: `R2-${label}-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [],
    tier,
    ...(parentId ? { parentId } : {}),
  } as any);
  return (agent.data as { id: string }).id;
}

async function createSession(
  ctx: Ctx,
  agentId: string,
  opts?: { status?: string; isMainSession?: boolean; kind?: string; parentSessionId?: string },
): Promise<string> {
  const session = await ctx.services.session.create({
    title: "R2 会话",
    model: "deepseek-chat",
    agentId,
    ...(opts?.isMainSession ? { isMainSession: true } : {}),
    ...(opts?.kind ? { kind: opts.kind } : {}),
    ...(opts?.parentSessionId ? { parentSessionId: opts.parentSessionId } : {}),
  } as any);
  const id = (session.data as { id: string }).id;
  if (opts?.status) {
    await prisma.chatSession.update({ where: { id }, data: { status: opts.status } });
  }
  return id;
}

/** 终态 async 任务（deliverToQueue 缺省 true） */
async function createTerminalTask(data: {
  sessionId: string;
  agentId: string;
  status: "success" | "failed";
  delivered: boolean;
  agedFinishedAt?: boolean;
  deliverToQueue?: boolean;
  subagentSessionId?: string;
}) {
  return prisma.task.create({
    data: {
      name: "[async] R2 任务",
      type: "async_agent",
      status: data.status,
      sessionId: data.sessionId,
      delivered: data.delivered,
      ...(data.delivered ? { deliveredAt: new Date() } : {}),
      finishedAt: new Date(Date.now() - (data.agedFinishedAt ? 10 * 60_000 : 0)),
      input: {
        kind: "async_agent",
        sessionId: data.sessionId,
        task: "R2 任务",
        taskLabel: "R2 任务",
        agentSnapshot: { id: data.agentId, model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: null },
        sourceType: "subagent",
        ...(data.deliverToQueue === false ? { deliverToQueue: false } : {}),
        ...(data.subagentSessionId ? { subagentSessionId: data.subagentSessionId } : {}),
      },
      output: data.status === "success" ? { asyncResult: "R2 结果文本" } : { error: "R2 失败" },
    },
  });
}

/** 僵尸（running/queued）async 任务 */
async function createStaleTask(data: {
  sessionId: string;
  agentId: string;
  status: "running" | "queued";
  subagentSessionId?: string;
}) {
  return prisma.task.create({
    data: {
      name: "[async] R2 僵尸任务",
      type: "async_agent",
      status: data.status,
      sessionId: data.sessionId,
      delivered: false,
      input: {
        kind: "async_agent",
        sessionId: data.sessionId,
        task: "R2 僵尸任务",
        taskLabel: "R2 僵尸任务",
        agentSnapshot: { id: data.agentId, model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: null },
        sourceType: "subagent",
        ...(data.subagentSessionId ? { subagentSessionId: data.subagentSessionId } : {}),
      },
    },
  });
}

/** chatAgentStream 打桩：模拟真实注入（user 气泡携带 jobId 台账）+ emit done，不触 LLM */
function mockChatAgentStreamWithBubble() {
  return vi.spyOn(agentStream, "chatAgentStream").mockImplementation(async (s, _c, input, _inv, emit) => {
    await s.message.create({
      sessionId: input.sessionId!,
      role: "user",
      content: input.message,
      toolResults: input.toolResults as never,
      source: input.source ?? "user",
    } as any);
    emit({
      type: "done",
      sessionId: input.sessionId!,
      agentId: "r2-spy",
      content: "已消化",
      toolCalls: [],
      model: "m",
      provider: "p",
      roundsUsed: 1,
    });
  });
}

async function cleanupIds(ids: { agentIds: string[]; sessionIds: string[] }) {
  await prisma.sessionQueueItem.deleteMany({ where: { sessionId: { in: ids.sessionIds } } }).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { sessionId: { in: ids.sessionIds } } }).catch(() => {});
  await prisma.run.deleteMany({ where: { sessionId: { in: ids.sessionIds } } }).catch(() => {});
  await prisma.task.deleteMany({ where: { sessionId: { in: ids.sessionIds } } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { id: { in: ids.sessionIds } } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: { in: ids.agentIds } } }).catch(() => {});
}

describe("R-2 重启恢复四动作（runStartupRecovery 首扫）", () => {
  beforeEach(async () => {
    resetAsyncJobOrchestratorForTests();
    resetSwarmBus();
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
    // 单 fork 串行下 test.db 跨文件共享：清掉前序文件遗留，保证 runStartupRecovery 扫描面
    // 只含本文件构造的数据（staleTasksFailed / zombieSessionsPaused / renotifiedUndelivered 计数确定性）
    await prisma.task.deleteMany({ where: { status: { in: ["running", "queued", "success", "failed"] } } });
    await prisma.chatSession.updateMany({ where: { status: "running" }, data: { status: "paused" } });
    await prisma.sessionQueueItem.deleteMany({ where: { kind: "superior" } });
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
    delete process.env.MOCK_LLM;
  });

  it("C1 动作 1+2：僵尸 Task 标 failed（文案正确、不自动重跑）+ 僵尸 running 会话标 paused；连跑两次幂等", async () => {
    const ctx = await createContextInner();
    const agentId = await createAgent(ctx, "C1", "manager");
    const zombieSessionId = await createSession(ctx, agentId, { status: "running" });
    const subSessionId = await createSession(ctx, agentId, { status: "running", kind: "subagent" });
    const staleRunning = await createStaleTask({ sessionId: zombieSessionId, agentId, status: "running", subagentSessionId: subSessionId });
    const staleQueued = await createStaleTask({ sessionId: zombieSessionId, agentId, status: "queued" });
    // 新鲜终态任务：不属于恢复范围（终态时间未超龄，Pass 2 在途保护跳过）
    const freshTerminal = await createTerminalTask({ sessionId: zombieSessionId, agentId, status: "success", delivered: false });

    try {
      const r1 = await runStartupRecovery({ config: ctx.config, services: ctx.services });

      // 动作 1：僵尸 running/queued → failed + error 文案
      expect(r1.staleTasksFailed).toBe(2);
      const rowRunning = await prisma.task.findUnique({ where: { id: staleRunning.id } });
      const rowQueued = await prisma.task.findUnique({ where: { id: staleQueued.id } });
      expect(rowRunning?.status).toBe("failed");
      expect(rowQueued?.status).toBe("failed");
      expect((rowRunning?.output as { error?: string })?.error).toContain("服务重启");
      // 不自动重跑：没有新 run/新任务被创建，任务只是被标 failed（重试走 retryAsyncJob 手动）
      expect(rowRunning?.startedAt).toBeNull();
      // stale 任务的 subagent 会话同步标 failed（既有 recoverStaleAsyncJobs 语义收拢）
      const subSession = await prisma.chatSession.findUnique({ where: { id: subSessionId } });
      expect(subSession?.status).toBe("failed");

      // 动作 2：僵尸 running 会话 → paused（旧实现无人收口，会话永久停 running，本断言必红）
      expect(r1.zombieSessionsPaused).toBe(1);
      const zombieSession = await prisma.chatSession.findUnique({ where: { id: zombieSessionId } });
      expect(zombieSession?.status).toBe("paused");

      // 新鲜终态任务零误伤（旧实现无 Pass 2 时不红；防的是恢复函数误投在途交付）
      const freshRow = await prisma.task.findUnique({ where: { id: freshTerminal.id } });
      expect(freshRow?.status).toBe("success");
      expect(freshRow?.delivered).toBe(false);
      expect(r1.reconcile.renotifiedUndelivered).toBe(0);

      // 幂等：连跑第二次，状态不变、计数全零
      const r2 = await runStartupRecovery({ config: ctx.config, services: ctx.services });
      expect(r2.staleTasksFailed).toBe(0);
      expect(r2.zombieSessionsPaused).toBe(0);
      expect((await prisma.task.findUnique({ where: { id: staleRunning.id } }))?.status).toBe("failed");
      expect((await prisma.chatSession.findUnique({ where: { id: zombieSessionId } }))?.status).toBe("paused");
    } finally {
      await cleanupIds({ agentIds: [agentId], sessionIds: [zombieSessionId, subSessionId] });
    }
  }, 20_000);

  it("C2 动作 4：delivered=false 终态未投递 → 重新 notify → 管道认领 + 气泡注入；sync 任务不误投", async () => {
    const chatSpy = mockChatAgentStreamWithBubble();
    const ctx = await createContextInner();
    const agentId = await createAgent(ctx, "C2", "manager");
    const sessionId = await createSession(ctx, agentId);
    // 重启前完成但 notify 丢失的终态结果（delivered=false、终态时间超龄）
    const undelivered = await createTerminalTask({ sessionId, agentId, status: "success", delivered: false, agedFinishedAt: true });
    // 同步任务（deliverToQueue=false）：结果走 tool return，永不进队列——不属于补投范围
    const syncTask = await createTerminalTask({ sessionId, agentId, status: "success", delivered: false, agedFinishedAt: true, deliverToQueue: false });

    try {
      const r = await runStartupRecovery({ config: ctx.config, services: ctx.services });
      // 旧实现无 Pass 2：undelivered 恒 delivered=false、气泡永不出现，以下断言必红
      expect(r.reconcile.scannedUndelivered).toBe(2);
      expect(r.reconcile.renotifiedUndelivered).toBe(1);

      // 重新走正常 notify/autoConsume 管道：CLAIM → 气泡注入
      await vi.waitFor(
        async () => {
          expect((await prisma.task.findUnique({ where: { id: undelivered.id } }))?.delivered).toBe(true);
          expect(chatSpy).toHaveBeenCalled();
        },
        { timeout: 8000, interval: 50 },
      );
      const bubble = await prisma.chatMessage.findFirst({ where: { sessionId, role: "user" } });
      const toolResults = bubble?.toolResults as { subagentResult?: { jobId?: string } } | null;
      expect(toolResults?.subagentResult?.jobId).toBe(undelivered.id);

      // sync 任务零误投
      expect((await prisma.task.findUnique({ where: { id: syncTask.id } }))?.delivered).toBe(false);
    } finally {
      await cleanupIds({ agentIds: [agentId], sessionIds: [sessionId] });
    }
  }, 20_000);

  it("C3 动作 3：superior 孤儿队列项 → drain 重注册 → 项被消费 + AgentMessage 记账 consumed", async () => {
    process.env.MOCK_LLM = "true";
    const ctx = await createContextInner();
    const parentAgentId = await createAgent(ctx, "C3父", "manager");
    const subAgentId = await createAgent(ctx, "C3子", "sub", parentAgentId);
    // 跨重启留存的子 Agent 主会话（重启前 running 尸体 → 动作 2 先 paused，drain 重跑后 completed）
    const subSessionId = await createSession(ctx, subAgentId, {
      status: "running",
      isMainSession: true,
      kind: "subagent",
    });
    const agentMsg = await prisma.agentMessage.create({
      data: {
        fromAgentId: parentAgentId,
        toAgentId: subAgentId,
        content: "R-2 遗留队列任务",
        messageType: "command",
        source: "manager",
        status: "pending",
      },
    });
    await prisma.sessionQueueItem.create({
      data: {
        sessionId: subSessionId,
        kind: "superior",
        content: "R-2 遗留队列任务",
        source: parentAgentId,
        agentMessageId: agentMsg.id,
      },
    });

    try {
      const r = await runStartupRecovery({ config: ctx.config, services: ctx.services });
      // 旧实现无重注册：孤儿队列项永久滞留（listBySession 恒 1）、user 消息永不写入，以下断言必红
      expect(r.superiorDrainsRegistered).toBe(1);

      // drain 自动处理：队列项被 consume（删除即认领）→ prepareAgentRun 写 user 消息并起流（MOCK_LLM）
      await vi.waitFor(
        async () => {
          const remaining = await ctx.services.sessionQueueItem.listBySession(subSessionId);
          expect(remaining).toHaveLength(0);
          const userMsg = await prisma.chatMessage.findFirst({
            where: { sessionId: subSessionId, role: "user", content: "R-2 遗留队列任务" },
          });
          expect(userMsg).toBeTruthy();
          const assistant = await prisma.chatMessage.findFirst({
            where: { sessionId: subSessionId, role: "assistant" },
          });
          expect(assistant).toBeTruthy();
        },
        { timeout: 10_000, interval: 50 },
      );

      // 账本：consume 事务内 pending → consumed
      const msgRow = await prisma.agentMessage.findUnique({ where: { id: agentMsg.id } });
      expect(msgRow?.status).toBe("consumed");
      // 会话生命周期：running（尸体）→ paused（动作 2）→ running（drain 起流）→ completed（跑完）
      const session = await prisma.chatSession.findUnique({ where: { id: subSessionId } });
      expect(session?.status).toBe("completed");
    } finally {
      await prisma.agentMessage.deleteMany({ where: { id: agentMsg.id } }).catch(() => {});
      await cleanupIds({ agentIds: [parentAgentId, subAgentId], sessionIds: [subSessionId] });
    }
  }, 25_000);
});
