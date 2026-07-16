/**
 * R-1 S3「认领了但气泡没进会话」根治 — 集成测试（负向断言）
 *
 * 洞 S3 现场：autoConsumeAsyncDelivery 原子 CLAIM（delivered=true + W14 账本 delivered）之后、
 * 气泡注入之前失败（被交互式运行抢线 / chatAgentStream 早期抛错 / 进程重启）→ 结果永久丢失。
 *
 * 两层根治（design-decisions Q1，不做分布式事务）：
 * 第一层 同链即时回滚：CLAIM 后 startIfNotRunning=false（被抢线，确定未写消息的唯一可判定路径）
 *   → 同事务回滚 delivered + W14 账本 → 重挂消费链队尾（不丢、不重复）。
 *   其它失败一律不回滚（宁漏勿错：消息可能已写入，回滚会导致重复投喂）。
 * 第二层 reconciler 对账者：扫「delivered=true 且终态但会话无 toolResults.subagentResult.jobId=X
 *   气泡」的孤儿 → 条件写回滚（与正常消费竞态原子）→ 重新走 notify/autoConsume 管道。
 *   ChatMessage 是唯一 ground truth，全部动作幂等。
 *
 * 负向断言（旧实现下必红的断言已逐条标注）：
 * - T1：旧实现抢线后 delivered 卡 true、永不重试 → chatAgentStream 永不被调用（waitFor 超时红）、
 *       startIfNotRunning 仅 1 次调用（无重排队）；
 * - T2：旧实现无 reconciler，孤儿 delivered 恒 true、气泡永不出现 → rolledBack/气泡/账本新 deliveredAt
 *       断言全红（函数缺失或超时）；
 * - T4：旧实现回滚不存在，ack 恒输、孤儿恒滞留 → 断言红。
 * 负向验证方式：git stash 生产代码（asyncJobManager.ts / agentMessageLedger.ts / index.ts）后跑本文件应红。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentStream from "../infra/agentStream.js";
import { createContextInner } from "../trpc/context.js";
import {
  autoConsumeAsyncDelivery,
  markAsyncDeliveryConsumed,
  pullAsyncDeliveries,
  reconcileOrphanedAsyncDeliveries,
} from "../infra/asyncJobManager.js";
import {
  getAsyncJobOrchestrator,
  resetAsyncJobOrchestratorForTests,
} from "../infra/asyncJobOrchestrator.js";
import { getStreamHub, setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `r1${Date.now().toString(36)}`;

interface Fixture {
  agentId: string;
  sessionId: string;
  taskId: string;
}

/** 创建 agent + session + 终态 async 任务（deliverToQueue 缺省 true） */
async function createFixture(
  ctx: Ctx,
  opts?: { delivered?: boolean; status?: "success" | "failed" },
): Promise<Fixture> {
  const agent = await ctx.services.agent.create({
    name: `R1-Agent-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [],
  });
  const agentId = (agent.data as { id: string }).id;
  const session = await ctx.services.session.create({
    title: "R1 投递可靠性会话",
    model: "deepseek-chat",
    agentId,
  } as any);
  const sessionId = (session.data as { id: string }).id;
  const status = opts?.status ?? "success";
  const task = await prisma.task.create({
    data: {
      name: "[async] R1 任务",
      type: "async_agent",
      status,
      sessionId,
      delivered: opts?.delivered ?? false,
      ...(opts?.delivered ? { deliveredAt: new Date() } : {}),
      input: {
        kind: "async_agent",
        sessionId,
        task: "R1 任务",
        taskLabel: "R1 任务",
        agentSnapshot: { id: agentId, model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: null },
        sourceType: "subagent",
      },
      output: status === "success" ? { asyncResult: "R1 结果文本" } : { error: "R1 失败" },
    },
  });
  return { agentId, sessionId, taskId: task.id };
}

async function cleanupFixture(fx: Fixture) {
  await prisma.agentMessage.deleteMany({ where: { taskRef: fx.taskId } }).catch(() => {});
  await prisma.task.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.run.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.sessionQueueItem.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { id: fx.sessionId } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: fx.agentId } }).catch(() => {});
}

/**
 * chatAgentStream 打桩：模拟真实注入——user 气泡携带 toolResults.subagentResult.jobId 台账
 * （reconciler 的 ground truth），随后 emit done 让 hub 运行收尾。不触 LLM。
 */
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
      agentId: "r1-spy",
      content: "已消化",
      toolCalls: [],
      model: "m",
      provider: "p",
      roundsUsed: 1,
    });
  });
}

describe("R-1 S3 投递可靠性（同链即时回滚 + reconciler 对账者）", () => {
  beforeEach(async () => {
    resetAsyncJobOrchestratorForTests();
    const hub = new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 });
    setStreamHub(hub);
    // 单 fork 串行下 test.db 跨文件共享：清掉前序测试文件可能遗留的 delivered=true 终态任务，
    // 保证 reconciler 扫描面只含本文件构造的数据（计数断言确定性）
    await prisma.task.deleteMany({ where: { delivered: true, status: { in: ["success", "failed"] } } });
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
  });

  it("T1 同链即时回滚：CLAIM 后被抢线（startIfNotRunning=false）→ delivered 回滚并重挂链尾，稍后被正常消费", async () => {
    const chatSpy = mockChatAgentStreamWithBubble();
    const ctx = await createContextInner();
    const fx = await createFixture(ctx);
    const hub = getStreamHub()!;
    // 第一轮强制抢线：startIfNotRunning 返回 false（别的流占线，chatAgentStream 确定未执行）
    const startSpy = vi.spyOn(hub, "startIfNotRunning").mockResolvedValueOnce(false);
    try {
      const r = await autoConsumeAsyncDelivery({
        sessionId: fx.sessionId,
        jobId: fx.taskId,
        status: "done",
        taskLabel: "R1 任务",
        services: ctx.services,
        config: ctx.config,
      });
      expect(r).toBe("started");

      // 旧实现即红：抢线后 delivered 卡 true、永不重试——chatAgentStream 永不被调用（此处超时），气泡永不出现
      await vi.waitFor(
        async () => {
          expect((await prisma.task.findUnique({ where: { id: fx.taskId } }))?.delivered).toBe(true);
          expect(chatSpy).toHaveBeenCalled();
        },
        { timeout: 8000, interval: 50 },
      );

      // 重挂链尾的确定性证据：startIfNotRunning 至少 2 次调用（首轮被抢线 false + 重排队后新一轮）
      // 旧实现仅 1 次调用，本断言必红
      expect(startSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      // 气泡注入且携带 jobId 台账
      const bubble = await prisma.chatMessage.findFirst({
        where: { sessionId: fx.sessionId, role: "user" },
      });
      const toolResults = bubble?.toolResults as { subagentResult?: { jobId?: string } } | null;
      expect(toolResults?.subagentResult?.jobId).toBe(fx.taskId);
    } finally {
      await cleanupFixture(fx);
    }
  }, 15_000);

  it("T2 孤儿交付（delivered=true 但无气泡）：reconciler 一轮回滚 + 重新补投，第二轮幂等", async () => {
    const chatSpy = mockChatAgentStreamWithBubble();
    const ctx = await createContextInner();
    const fx = await createFixture(ctx, { delivered: true });
    try {
      const originalDeliveredAt = new Date(Date.now() - 10 * 60_000);
      await prisma.task.update({ where: { id: fx.taskId }, data: { deliveredAt: originalDeliveredAt } });
      const agentMsg = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.agentId,
          toAgentId: fx.agentId,
          content: "R1 结果文本",
          messageType: "report",
          source: "sub",
          taskRef: fx.taskId,
          status: "delivered",
          deliveredAt: originalDeliveredAt,
        },
      });

      // S3 现场（新旧实现一致）：孤儿对前端/自动管道永久隐形——delivered=true 永不进拉取队列
      expect(await pullAsyncDeliveries(fx.sessionId)).toHaveLength(0);

      const round1 = await reconcileOrphanedAsyncDeliveries({
        services: ctx.services,
        config: ctx.config,
        minDeliveredAgeMs: 0,
      });
      // 旧实现无 reconciler：孤儿 delivered 恒 true、永不补投，以下断言必红
      expect(round1.rolledBack).toBe(1);
      expect(round1.renotified).toBe(1);

      // 补投走正常 notify/autoConsume 管道：气泡最终注入
      await vi.waitFor(
        async () => {
          expect((await prisma.task.findUnique({ where: { id: fx.taskId } }))?.delivered).toBe(true);
          expect(chatSpy).toHaveBeenCalled();
        },
        { timeout: 8000, interval: 50 },
      );

      // 账本真账：回滚（delivered→pending、deliveredAt 清空）后重新 CLAIM 落新 deliveredAt。
      // 旧实现下 deliveredAt 保持原值，下一行断言必红
      const msgRow = await prisma.agentMessage.findUnique({ where: { id: agentMsg.id } });
      expect(msgRow?.status).toBe("delivered");
      expect(msgRow?.deliveredAt).toBeTruthy();
      expect(msgRow!.deliveredAt!.getTime()).toBeGreaterThan(originalDeliveredAt.getTime());

      // 第二轮：气泡已成 ground truth → 幂等零动作
      const round2 = await reconcileOrphanedAsyncDeliveries({
        services: ctx.services,
        config: ctx.config,
        minDeliveredAgeMs: 0,
      });
      expect(round2.rolledBack).toBe(0);
      expect(round2.renotified).toBe(0);
      expect(round2.skippedHasMessage).toBeGreaterThanOrEqual(1);

      // 气泡有且仅有一个（补投不重复）
      const bubbles = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "ChatMessage"
        WHERE sessionId = ${fx.sessionId}
          AND json_extract(toolResults, '$.subagentResult.jobId') = ${fx.taskId}
      `;
      expect(bubbles).toHaveLength(1);
    } finally {
      await cleanupFixture(fx);
    }
  }, 20_000);

  it("T3 正常已消费记录 reconciler 零误伤：连跑三轮幂等，状态不变", async () => {
    const chatSpy = mockChatAgentStreamWithBubble();
    const ctx = await createContextInner();
    const fx = await createFixture(ctx, { delivered: true });
    try {
      const originalDeliveredAt = new Date(Date.now() - 10 * 60_000);
      await prisma.task.update({ where: { id: fx.taskId }, data: { deliveredAt: originalDeliveredAt } });
      // ground truth：气泡已注入（携带 jobId 台账）
      await ctx.services.message.create({
        sessionId: fx.sessionId,
        role: "user",
        content: "R1 结果文本",
        toolResults: { subagentResult: { jobId: fx.taskId, taskLabel: "R1 任务" } },
        source: "sub",
      } as any);
      const agentMsg = await prisma.agentMessage.create({
        data: {
          fromAgentId: fx.agentId,
          toAgentId: fx.agentId,
          content: "R1 结果文本",
          messageType: "report",
          source: "sub",
          taskRef: fx.taskId,
          status: "consumed",
          deliveredAt: originalDeliveredAt,
        },
      });
      // 在途交付（deliveredAt 新鲜、无气泡）：超龄过滤必须跳过（宁漏勿错，真孤儿下一轮再收）
      const inflight = await prisma.task.create({
        data: {
          name: "[async] R1 在途",
          type: "async_agent",
          status: "success",
          sessionId: fx.sessionId,
          delivered: true,
          deliveredAt: new Date(),
          input: {
            kind: "async_agent",
            sessionId: fx.sessionId,
            task: "在途",
            taskLabel: "在途",
            agentSnapshot: { id: fx.agentId, model: "m", systemPrompt: "", tools: [] },
            sourceType: "subagent",
          },
          output: { asyncResult: "在途结果" },
        },
      });

      // 默认超龄阈值连跑三轮：任何一轮误回滚/误补投，后续断言即红
      // （旧实现下本用例无法运行——reconciler 不存在；本用例防的是 reconciler 误伤正常记录）
      for (let round = 1; round <= 3; round++) {
        const result = await reconcileOrphanedAsyncDeliveries({ services: ctx.services, config: ctx.config });
        expect(result.rolledBack).toBe(0);
        expect(result.renotified).toBe(0);
      }

      const taskRow = await prisma.task.findUnique({ where: { id: fx.taskId } });
      expect(taskRow?.delivered).toBe(true);
      expect(taskRow?.deliveredAt?.getTime()).toBe(originalDeliveredAt.getTime());
      const msgRow = await prisma.agentMessage.findUnique({ where: { id: agentMsg.id } });
      expect(msgRow?.status).toBe("consumed");
      expect(msgRow?.deliveredAt?.getTime()).toBe(originalDeliveredAt.getTime());
      const inflightRow = await prisma.task.findUnique({ where: { id: inflight.id } });
      expect(inflightRow?.delivered).toBe(true);
      // 零补投 ⇒ chatAgentStream 从未被触发
      expect(chatSpy).not.toHaveBeenCalled();
    } finally {
      await cleanupFixture(fx);
    }
  }, 15_000);

  it("T4 竞态：reconciler 回滚与 markAsyncDeliveryConsumed 并发 → 条件写保证只有一个生效", async () => {
    const chatSpy = mockChatAgentStreamWithBubble();
    const ctx = await createContextInner();
    const fx = await createFixture(ctx, { delivered: true });
    const hub = getStreamHub()!;
    try {
      // 会话被交互式运行占线：补投的 autoConsume 链会停在 CLAIM 前的 waitFor（确定性控制竞态时序）
      let releaseInteractive!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseInteractive = resolve;
      });
      await hub.start(fx.sessionId, { sessionId: fx.sessionId, message: "交互占用" } as any, () => gate);
      expect(hub.isRunning(fx.sessionId)).toBe(true);

      // ① 回滚前到达的 ack 必输：delivered 已是 true，ack 条件写（delivered=false→true）不命中
      expect(await markAsyncDeliveryConsumed(fx.taskId)).toBe(false);

      // ② reconciler 判定孤儿 → 条件写回滚成功；补投链因会话占线停在 waitFor，不会抢先 CLAIM
      //    旧实现无回滚：delivered 恒 true，本断言与 ③ 必红
      const round = await reconcileOrphanedAsyncDeliveries({
        services: ctx.services,
        config: ctx.config,
        minDeliveredAgeMs: 0,
      });
      expect(round.rolledBack).toBe(1);
      expect((await prisma.task.findUnique({ where: { id: fx.taskId } }))?.delivered).toBe(false);

      // ③ 回滚后到达的 ack 必赢：delivered=false→true 条件写命中（与补投链竞态原子，同一行同一时刻至多一个写方）
      expect(await markAsyncDeliveryConsumed(fx.taskId)).toBe(true);

      // ④ 放行交互流：补投链恢复后 CLAIM 必落选（count=0）→ 不注入、不重复投喂
      releaseInteractive();
      await vi.waitFor(
        () => {
          expect(getAsyncJobOrchestrator(ctx.config).getStats().runningGlobal).toBe(0);
        },
        { timeout: 5000, interval: 50 },
      );
      expect(chatSpy).not.toHaveBeenCalled();
      expect((await prisma.task.findUnique({ where: { id: fx.taskId } }))?.delivered).toBe(true);
      // 二次 ack 幂等拒绝——终态一致：恰好一个生效方，不丢不重
      expect(await markAsyncDeliveryConsumed(fx.taskId)).toBe(false);
    } finally {
      await cleanupFixture(fx);
    }
  }, 15_000);
});
