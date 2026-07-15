/**
 * W14 AgentMessage 投递记账回写 — 集成测试
 *
 * 机制：report_back ① swarmBus.send 写 AgentMessage（旁路邮箱，非投递载具）
 * ② 完成跟踪 Task 并调 notifyAndAutoConsumeAsyncDelivery，由 autoConsumeAsyncDelivery
 * 原子认领（CLAIM）注入父会话气泡。W14 给旁路邮箱补记账：
 * - taskRef=jobId 关联（report_back 写入点）
 * - delivered：Task 管道原子认领成功（CLAIM 同事务）
 * - consumed：注入气泡随会话历史被 ReAct 循环读入上下文（chatAgentStream 挂点）
 * - 幂等防线：superior 镜像投递前对账（已记账 / 滞留 pending + 同内容消息 → 不重复注入）
 * - 存量修复脚本对账（fix-agent-message-ledger.ts）
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentStream from "../infra/agentStream.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import { autoConsumeAsyncDelivery, markAsyncDeliveryConsumed } from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";
import {
  markAgentMessageConsumedByTaskRef,
  markAgentMessageDeliveredByTaskRef,
} from "../infra/agentMessageLedger.js";
import { reconcileAgentMessageLedger } from "../scripts/fix-agent-message-ledger.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

interface SwarmFixture {
  parentAgentId: string;
  subAgentId: string;
  parentSessionId: string;
  subSessionId: string;
  trackingTaskId: string;
}

const RUN_ID = `w14${Date.now().toString(36)}`;

async function createSwarmFixture(ctx: Ctx, opts?: { withTrackingTask?: boolean }): Promise<SwarmFixture> {
  const parent = await ctx.services.agent.create({
    name: `W14父Agent-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    model: "deepseek-chat",
    systemPrompt: "test parent",
    tools: [],
    tier: "manager",
  });
  const parentAgentId = (parent.data as { id: string }).id;
  const sub = await ctx.services.agent.create({
    name: `W14子Agent-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    model: "deepseek-chat",
    systemPrompt: "test sub",
    tools: [],
    tier: "sub",
    parentId: parentAgentId,
  });
  const subAgentId = (sub.data as { id: string }).id;

  const parentSession = await ctx.services.session.create({
    title: "W14 父会话",
    model: "deepseek-chat",
    agentId: parentAgentId,
  } as any);
  const parentSessionId = (parentSession.data as { id: string }).id;

  const subSession = await ctx.services.session.create({
    title: "W14 子会话",
    model: "deepseek-chat",
    agentId: subAgentId,
    parentSessionId,
    kind: "subagent",
  } as any);
  const subSessionId = (subSession.data as { id: string }).id;

  let trackingTaskId = "";
  if (opts?.withTrackingTask !== false) {
    const task = await prisma.task.create({
      data: {
        name: "[async] W14 跟踪任务",
        type: "async_agent",
        status: "running",
        sessionId: parentSessionId,
        delivered: false,
        input: {
          kind: "async_agent",
          sessionId: parentSessionId,
          task: "W14 跟踪任务",
          taskLabel: "W14 跟踪任务",
          agentSnapshot: {
            id: subAgentId,
            model: "deepseek-chat",
            systemPrompt: "",
            tools: [],
            tier: "sub",
            parentId: parentAgentId,
          },
          subagentSessionId: subSessionId,
          sourceType: "subagent",
        },
      },
    });
    trackingTaskId = task.id;
  }

  return { parentAgentId, subAgentId, parentSessionId, subSessionId, trackingTaskId };
}

async function cleanupSwarmFixture(fx: SwarmFixture) {
  await prisma.agentMessage.deleteMany({
    where: { OR: [{ fromAgentId: fx.subAgentId }, { toAgentId: fx.parentAgentId }] },
  }).catch(() => {});
  await prisma.task.deleteMany({ where: { sessionId: fx.parentSessionId } }).catch(() => {});
  await prisma.chatMessage.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.run.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.sessionQueueItem.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.chatSession.deleteMany({
    where: { id: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: { in: [fx.subAgentId, fx.parentAgentId] } } }).catch(() => {});
}

function makeReportCtx(ctx: Ctx, fx: SwarmFixture) {
  return {
    ...ctx,
    sessionId: fx.subSessionId,
    agentSnapshot: {
      id: fx.subAgentId,
      model: "deepseek-chat",
      systemPrompt: "test sub",
      tools: [],
      tier: "sub" as const,
      workspaceId: null,
      parentId: fx.parentAgentId,
    },
    invokeTrpc: async () => ({ ok: true }),
  };
}

describe("W14 AgentMessage 投递记账回写", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
    const hub = new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 });
    setStreamHub(hub);
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
    delete process.env.MOCK_LLM;
  });

  it("report_back：AgentMessage 写入 taskRef=jobId 关联跟踪 Task；CLAIM 后记账 delivered", async () => {
    // chatAgentStream 打桩：只验证到 delivered（不触发 consumed 挂点）
    const chatSpy = vi.spyOn(agentStream, "chatAgentStream").mockImplementation(async (_s, _c, input, _inv, emit) => {
      emit({
        type: "done",
        sessionId: input.sessionId!,
        agentId: "w14-spy",
        content: "已消化",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      });
    });

    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx);
    try {
      const report = (await executeNativeTool(
        "agent_report_back",
        { content: "W14 子 Agent 回报：任务完成" },
        makeReportCtx(ctx, fx),
      )) as { success?: boolean; error?: string };
      expect(report.error).toBeUndefined();
      expect(report.success).toBe(true);

      // ① taskRef 写入点：report_back 返回后 AgentMessage 已关联跟踪 Task
      const agentMsg = await prisma.agentMessage.findFirst({
        where: { fromAgentId: fx.subAgentId, toAgentId: fx.parentAgentId },
        orderBy: { createdAt: "desc" },
      });
      expect(agentMsg).toBeTruthy();
      expect(agentMsg!.taskRef).toBe(fx.trackingTaskId);

      // ② delivered 回写：autoConsume 原子认领（fire-and-forget，等待异步链完成）
      await vi.waitFor(
        async () => {
          const row = await prisma.agentMessage.findUnique({ where: { id: agentMsg!.id } });
          expect(row?.status).toBe("delivered");
          expect(row?.deliveredAt).toBeTruthy();
        },
        { timeout: 5000, interval: 50 },
      );
      const task = await prisma.task.findUnique({ where: { id: fx.trackingTaskId } });
      expect(task?.delivered).toBe(true);
      // chatAgentStream 被打桩，不经过 consumed 挂点：状态停留在 delivered
      expect(chatSpy).toHaveBeenCalled();
      const finalRow = await prisma.agentMessage.findUnique({ where: { id: agentMsg!.id } });
      expect(finalRow?.status).toBe("delivered");
    } finally {
      await cleanupSwarmFixture(fx);
    }
  }, 15_000);

  it("report_back → Task 管道消费全链路：delivered → consumed（MOCK_LLM 真实 chatAgentStream）", async () => {
    process.env.MOCK_LLM = "true";

    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx);
    try {
      const report = (await executeNativeTool(
        "agent_report_back",
        { content: "W14 全链路回报：请查收" },
        makeReportCtx(ctx, fx),
      )) as { success?: boolean; error?: string };
      expect(report.error).toBeUndefined();

      const agentMsg = await prisma.agentMessage.findFirst({
        where: { fromAgentId: fx.subAgentId, toAgentId: fx.parentAgentId },
        orderBy: { createdAt: "desc" },
      });
      expect(agentMsg!.taskRef).toBe(fx.trackingTaskId);

      // ③ consumed 挂点：气泡随历史进入 ReAct 上下文（真实 chatAgentStream + MOCK_LLM）
      await vi.waitFor(
        async () => {
          const row = await prisma.agentMessage.findUnique({ where: { id: agentMsg!.id } });
          expect(row?.status).toBe("consumed");
          expect(row?.deliveredAt).toBeTruthy();
        },
        { timeout: 8000, interval: 50 },
      );

      // 气泡已注入父会话（携带 subagentResult.jobId 台账）
      const bubble = await prisma.chatMessage.findFirst({
        where: { sessionId: fx.parentSessionId, role: "user" },
        orderBy: { createdAt: "desc" },
      });
      expect(bubble?.content).toBe("W14 全链路回报：请查收");
      const toolResults = bubble?.toolResults as { subagentResult?: { jobId?: string } } | null;
      expect(toolResults?.subagentResult?.jobId).toBe(fx.trackingTaskId);

      // ReAct 循环确实跑完（MOCK_LLM 给出 assistant 回复）
      await vi.waitFor(
        async () => {
          const assistant = await prisma.chatMessage.findFirst({
            where: { sessionId: fx.parentSessionId, role: "assistant" },
          });
          expect(assistant).toBeTruthy();
        },
        { timeout: 8000, interval: 50 },
      );
    } finally {
      await cleanupSwarmFixture(fx);
    }
  }, 20_000);

  it("重复消费幂等拒绝：二次 autoConsume skipped、前端 ack 返回 false、delivered 不重复回写", async () => {
    const chatSpy = vi.spyOn(agentStream, "chatAgentStream").mockImplementation(async (_s, _c, input, _inv, emit) => {
      emit({
        type: "done",
        sessionId: input.sessionId!,
        agentId: "w14-spy",
        content: "已消化",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      });
    });

    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx);
    try {
      // 跟踪 Task 直接置 success（模拟 report_back 已完成任务），AgentMessage 关联 taskRef
      await prisma.task.update({ where: { id: fx.trackingTaskId }, data: { status: "success", output: { asyncResult: "结果" } } });
      const agentMsg = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.subAgentId,
          toAgentId: fx.parentAgentId,
          content: "结果",
          messageType: "report",
          source: "sub",
          taskRef: fx.trackingTaskId,
          status: "pending",
        },
      });

      const first = await autoConsumeAsyncDelivery({
        sessionId: fx.parentSessionId,
        jobId: fx.trackingTaskId,
        status: "done",
        taskLabel: "W14 跟踪任务",
        services: ctx.services,
        config: ctx.config,
      });
      expect(first).toBe("started");
      expect((await prisma.agentMessage.findUnique({ where: { id: agentMsg.id } }))?.status).toBe("delivered");

      // 二次认领：原子 CLAIM 拒绝 → skipped；AgentMessage 状态不被重复改写
      const second = await autoConsumeAsyncDelivery({
        sessionId: fx.parentSessionId,
        jobId: fx.trackingTaskId,
        status: "done",
        taskLabel: "W14 跟踪任务",
        services: ctx.services,
        config: ctx.config,
      });
      expect(second).toBe("skipped");
      expect(chatSpy).toHaveBeenCalledTimes(1);

      // 前端 ack 竞态同样抢不到
      expect(await markAsyncDeliveryConsumed(fx.trackingTaskId)).toBe(false);
      const finalRow = await prisma.agentMessage.findUnique({ where: { id: agentMsg.id } });
      expect(finalRow?.status).toBe("delivered");
    } finally {
      await cleanupSwarmFixture(fx);
    }
  }, 15_000);

  it("markAsyncDeliveryConsumed（前端认领路径）同样在 CLAIM 事务里回写 delivered", async () => {
    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx);
    try {
      await prisma.task.update({ where: { id: fx.trackingTaskId }, data: { status: "success", output: { asyncResult: "结果" } } });
      const agentMsg = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.subAgentId,
          toAgentId: fx.parentAgentId,
          content: "结果",
          messageType: "report",
          source: "sub",
          taskRef: fx.trackingTaskId,
          status: "pending",
        },
      });

      expect(await markAsyncDeliveryConsumed(fx.trackingTaskId)).toBe(true);
      const row = await prisma.agentMessage.findUnique({ where: { id: agentMsg.id } });
      expect(row?.status).toBe("delivered");
      expect(row?.deliveredAt).toBeTruthy();
    } finally {
      await cleanupSwarmFixture(fx);
    }
  });

  it("幂等防线：已 delivered 的 AgentMessage 不再镜像入队", async () => {
    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx, { withTrackingTask: false });
    try {
      const agentMsg = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.parentAgentId,
          toAgentId: fx.subAgentId,
          content: "已投递过的任务",
          messageType: "command",
          source: "manager",
          status: "delivered",
          deliveredAt: new Date(),
        },
      });

      const res = await ctx.services.sessionQueueItem.create({
        sessionId: fx.subSessionId,
        kind: "superior",
        content: agentMsg.content,
        source: "manager",
        agentMessageId: agentMsg.id,
      } as any);
      expect(res.success).toBe(true);
      expect(res.data).toBeUndefined();
      const items = await ctx.services.sessionQueueItem.listBySession(fx.subSessionId);
      expect(items).toHaveLength(0);
    } finally {
      await cleanupSwarmFixture(fx);
    }
  });

  it("幂等防线：滞留 pending + 会话已有同内容消息 → 只回写 consumed 不注入（taskRef 缺失兜底对账）", async () => {
    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx, { withTrackingTask: false });
    try {
      // 无 taskRef 的存量消息（W14 前的遗留形态），创建时间回拨到阈值之前
      const agentMsg = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.parentAgentId,
          toAgentId: fx.subAgentId,
          content: "遗留任务内容",
          messageType: "command",
          source: "manager",
          taskRef: null,
          status: "pending",
        },
      });
      await prisma.agentMessage.update({
        where: { id: agentMsg.id },
        data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      });
      // 目标会话里已存在同内容消息（曾被其它管道注入过）
      await ctx.services.message.create({
        sessionId: fx.subSessionId,
        role: "user",
        content: "遗留任务内容",
        source: "manager",
      } as any);

      const res = await ctx.services.sessionQueueItem.create({
        sessionId: fx.subSessionId,
        kind: "superior",
        content: agentMsg.content,
        source: "manager",
        agentMessageId: agentMsg.id,
      } as any);
      expect(res.success).toBe(true);
      expect(res.data).toBeUndefined();
      expect(await ctx.services.sessionQueueItem.listBySession(fx.subSessionId)).toHaveLength(0);

      // 只回写状态：pending → consumed，不再注入
      const row = await prisma.agentMessage.findUnique({ where: { id: agentMsg.id } });
      expect(row?.status).toBe("consumed");
      expect(row?.deliveredAt).toBeTruthy();
    } finally {
      await cleanupSwarmFixture(fx);
    }
  });

  it("幂等防线：滞留 pending 但会话无同内容消息 → 正常镜像入队；新鲜 pending 不受防线影响", async () => {
    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx, { withTrackingTask: false });
    try {
      // 滞留 pending 但会话里没有同内容消息 → 正常投递
      const stale = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.parentAgentId,
          toAgentId: fx.subAgentId,
          content: "滞留但未投递的任务",
          messageType: "command",
          source: "manager",
          status: "pending",
        },
      });
      await prisma.agentMessage.update({
        where: { id: stale.id },
        data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
      });
      const resStale = await ctx.services.sessionQueueItem.create({
        sessionId: fx.subSessionId,
        kind: "superior",
        content: stale.content,
        source: "manager",
        agentMessageId: stale.id,
      } as any);
      expect(resStale.success).toBe(true);
      expect(resStale.data?.id).toBeTruthy();
      expect((await prisma.agentMessage.findUnique({ where: { id: stale.id } }))?.status).toBe("pending");

      // 新鲜 pending（< 阈值）即使会话有同内容消息也照常入队（不干扰正常流程）
      const fresh = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.parentAgentId,
          toAgentId: fx.subAgentId,
          content: "滞留但未投递的任务",
          messageType: "command",
          source: "manager",
          status: "pending",
        },
      });
      const resFresh = await ctx.services.sessionQueueItem.create({
        sessionId: fx.subSessionId,
        kind: "superior",
        content: fresh.content,
        source: "manager",
        agentMessageId: fresh.id,
      } as any);
      expect(resFresh.success).toBe(true);
      expect(resFresh.data?.id).toBeTruthy();
      expect(await ctx.services.sessionQueueItem.listBySession(fx.subSessionId)).toHaveLength(2);
    } finally {
      await cleanupSwarmFixture(fx);
    }
  });

  it("ledger helper：delivered/consumed 幂等，重复调用与乱序调用安全", async () => {
    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx, { withTrackingTask: false });
    try {
      const msg = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.subAgentId,
          toAgentId: fx.parentAgentId,
          content: "helper 对账",
          messageType: "report",
          source: "sub",
          taskRef: "w14-fake-job",
          status: "pending",
        },
      });

      expect(await markAgentMessageDeliveredByTaskRef(prisma, "w14-fake-job")).toBe(1);
      expect((await prisma.agentMessage.findUnique({ where: { id: msg.id } }))?.status).toBe("delivered");
      // 重复 delivered：no-op
      expect(await markAgentMessageDeliveredByTaskRef(prisma, "w14-fake-job")).toBe(0);
      // consumed：delivered → consumed
      expect(await markAgentMessageConsumedByTaskRef(prisma, "w14-fake-job")).toBe(1);
      expect((await prisma.agentMessage.findUnique({ where: { id: msg.id } }))?.status).toBe("consumed");
      // 乱序/重复：consumed 后 delivered 不再生效
      expect(await markAgentMessageDeliveredByTaskRef(prisma, "w14-fake-job")).toBe(0);
      expect(await markAgentMessageConsumedByTaskRef(prisma, "w14-fake-job")).toBe(0);
      expect((await prisma.agentMessage.findUnique({ where: { id: msg.id } }))?.status).toBe("consumed");
      // taskRef 无匹配：安全 no-op
      expect(await markAgentMessageDeliveredByTaskRef(prisma, "w14-no-such-job")).toBe(0);
    } finally {
      await cleanupSwarmFixture(fx);
    }
  });

  it("存量修复脚本：已注入的滞留 pending 置 consumed，未注入的保持 pending 并告警", async () => {
    const ctx = await createContextInner();
    const fx = await createSwarmFixture(ctx);
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      // ① taskRef 关联 + 目标会话已有同内容消息 → 置 consumed
      const resolved = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.subAgentId,
          toAgentId: fx.parentAgentId,
          content: "已注入的回报",
          messageType: "report",
          source: "sub",
          taskRef: fx.trackingTaskId,
          status: "pending",
          createdAt: twoHoursAgo,
        },
      });
      await ctx.services.message.create({
        sessionId: fx.parentSessionId,
        role: "user",
        content: "已注入的回报",
        source: "sub",
      } as any);
      // ② 滞留 pending 但会话无同内容消息 → 保持 pending + 告警
      const orphan = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.subAgentId,
          toAgentId: fx.parentAgentId,
          content: "从未注入的回报",
          messageType: "report",
          source: "sub",
          taskRef: fx.trackingTaskId,
          status: "pending",
          createdAt: twoHoursAgo,
        },
      });
      // ③ 新鲜 pending → 不在扫描范围
      const fresh = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.subAgentId,
          toAgentId: fx.parentAgentId,
          content: "新鲜消息",
          messageType: "report",
          source: "sub",
          status: "pending",
        },
      });

      const result = await reconcileAgentMessageLedger(prisma);
      expect(result.scanned).toBeGreaterThanOrEqual(2);
      expect(result.markedConsumed).toBeGreaterThanOrEqual(1);

      expect((await prisma.agentMessage.findUnique({ where: { id: resolved.id } }))?.status).toBe("consumed");
      const orphanRow = await prisma.agentMessage.findUnique({ where: { id: orphan.id } });
      expect(orphanRow?.status).toBe("pending");
      expect(result.warnings.some((w) => w.messageId === orphan.id)).toBe(true);
      expect((await prisma.agentMessage.findUnique({ where: { id: fresh.id } }))?.status).toBe("pending");
      expect(result.warnings.some((w) => w.messageId === fresh.id)).toBe(false);
    } finally {
      // 脚本对账是全局扫描：把本测试已 consumed 的遗留清掉，避免影响其它用例计数断言
      await cleanupSwarmFixture(fx);
    }
  });
});
