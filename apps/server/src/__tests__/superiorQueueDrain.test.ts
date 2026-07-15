/**
 * W-E：给 running 子 Agent 发消息 → 服务端持久队列 + 空闲自动 drain（T7 负向断言）
 *
 * 旧实现（断言即红）：triggerAgentRun 遇 hub.isRunning 先把消息写进 ChatMessage，
 * 等子本轮结束后直接返回旧 assistant——新消息躺在历史里无人处理，且工具结果没有 queued 标记。
 *
 * 新实现：
 * - busy 判定前移到写 ChatMessage 之前；busy 时 bus.send 写 AgentMessage（pending）+
 *   sessionQueueItem.create（superior 镜像，幂等）+ 注册服务端 drain，不写 ChatMessage；
 * - drain 复用 enqueueSessionAutoConsume 的 per-session 串行链：waitFor 空闲 →
 *   consume 原子认领（删除即认领，落选静默）→ 重入 prepareAgentRun 起流 → 下一项；
 * - consume 软认领：item 不存在 / 并发双 consume 落选方返回 claimed:false，不抛错；
 * - waitForRun=true + busy：入队后等该 item 的 drain 完成（链 promise），再读最后 assistant。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import { setStreamHub, getStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";
import { resetSwarmBus } from "../infra/swarmBus.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

interface DrainFixture {
  parentAgentId: string;
  subAgentId: string;
  parentSessionId: string;
  subSessionId: string;
}

const RUN_ID = `we${Date.now().toString(36)}`;

async function createDrainFixture(ctx: Ctx): Promise<DrainFixture> {
  const suffix = `${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`;
  const parent = await ctx.services.agent.create({
    name: `WE父Agent-${suffix}`,
    model: "deepseek-chat",
    systemPrompt: "test parent",
    tools: [],
    tier: "manager",
  });
  const parentAgentId = (parent.data as { id: string }).id;
  const sub = await ctx.services.agent.create({
    name: `WE子Agent-${suffix}`,
    model: "deepseek-chat",
    systemPrompt: "test sub",
    tools: [],
    tier: "sub",
    parentId: parentAgentId,
  });
  const subAgentId = (sub.data as { id: string }).id;

  const parentSession = await ctx.services.session.create({
    title: "W-E 父会话",
    model: "deepseek-chat",
    agentId: parentAgentId,
  } as any);
  const parentSessionId = (parentSession.data as { id: string }).id;

  // 子 Agent 主会话：triggerAgentRun/prepareAgentRun 按 isMainSession 找回此会话
  const subSession = await ctx.services.session.create({
    title: "W-E 子主会话",
    model: "deepseek-chat",
    agentId: subAgentId,
    isMainSession: true,
    kind: "subagent",
    parentSessionId,
  } as any);
  const subSessionId = (subSession.data as { id: string }).id;

  return { parentAgentId, subAgentId, parentSessionId, subSessionId };
}

async function cleanupDrainFixture(fx: DrainFixture) {
  await prisma.agentMessage.deleteMany({
    where: { OR: [{ fromAgentId: fx.parentAgentId }, { toAgentId: fx.subAgentId }] },
  }).catch(() => {});
  await prisma.sessionQueueItem.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.chatMessage.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.chatSession.deleteMany({
    where: { id: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: { in: [fx.subAgentId, fx.parentAgentId] } } }).catch(() => {});
}

function makeSendCtx(ctx: Ctx, fx: DrainFixture) {
  return {
    ...ctx,
    sessionId: fx.parentSessionId,
    agentSnapshot: {
      id: fx.parentAgentId,
      model: "deepseek-chat",
      systemPrompt: "test parent",
      tools: [],
      tier: "manager" as const,
      workspaceId: null,
      parentId: null,
    },
    invokeTrpc: async () => ({ ok: true }),
  };
}

/** 用一个被闸门卡住的运行占用子会话（模拟子 Agent 正在跑），返回释放函数 */
async function occupySession(sessionId: string, agentId: string): Promise<() => void> {
  const hub = getStreamHub();
  if (!hub) throw new Error("测试需要 SessionStreamHub");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await hub.start(sessionId, { sessionId, agentId, message: "占用中" }, async (emit) => {
    await gate;
    emit({
      type: "done",
      sessionId,
      agentId,
      content: "占用轮完成",
      toolCalls: [],
      model: "m",
      provider: "p",
      roundsUsed: 1,
    });
  });
  if (!hub.isRunning(sessionId)) throw new Error("占用失败：会话未处于 running");
  return release;
}

describe("W-E running 子 Agent 消息服务端队列 + 空闲自动 drain", () => {
  beforeEach(() => {
    resetSwarmBus();
    process.env.MOCK_LLM = "true";
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
    delete process.env.MOCK_LLM;
  });

  it("T7：busy 时入队（queued + AgentMessage pending + 队列项存在 + 不写 ChatMessage）；转闲后 drain 自动处理并记账 consumed", async () => {
    const ctx = await createContextInner();
    const fx = await createDrainFixture(ctx);
    const release = await occupySession(fx.subSessionId, fx.subAgentId);
    // 旧实现会 waitFor 挂住：保险释放，保证负向断言能跑到（先红后绿）
    const autoRelease = setTimeout(release, 3000);
    try {
      const result = (await executeNativeTool(
        "agent_send_message",
        { toAgentId: fx.subAgentId, content: "W-E 排队任务" },
        makeSendCtx(ctx, fx),
      )) as { success?: boolean; queued?: boolean; message?: string; error?: string };
      clearTimeout(autoRelease);

      // ── busy 阶段（闸门仍持有，子会话仍 running）──
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      // 旧实现无 queued 标记（返回旧 assistant）→ 此断言旧实现即红
      expect(result.queued).toBe(true);
      expect(result.message).toContain("已入队");

      // AgentMessage 落账且仍 pending（drain 未触发，闸门未释放）
      const agentMsg = await prisma.agentMessage.findFirst({
        where: { toAgentId: fx.subAgentId, content: "W-E 排队任务" },
        orderBy: { createdAt: "desc" },
      });
      expect(agentMsg).toBeTruthy();
      expect(agentMsg!.status).toBe("pending");

      // SessionQueueItem 存在且关联 AgentMessage
      const items = await ctx.services.sessionQueueItem.listBySession(fx.subSessionId);
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe("superior");
      expect(items[0].content).toBe("W-E 排队任务");
      expect(items[0].agentMessageId).toBe(agentMsg!.id);

      // 负向断言：busy 分支不写 ChatMessage（旧实现会先写一条 user 消息 → 旧实现即红）
      const leaked = await prisma.chatMessage.findMany({
        where: { sessionId: fx.subSessionId, content: "W-E 排队任务" },
      });
      expect(leaked).toHaveLength(0);

      // ── 转闲：drain 自动起一轮 ──
      // 完成判定＝队列空 + user 消息写入 + assistant 产出（consume 先于起流，单看队列空会抢跑）
      release();
      await vi.waitFor(
        async () => {
          const remaining = await ctx.services.sessionQueueItem.listBySession(fx.subSessionId);
          expect(remaining).toHaveLength(0);
          const userMsg = await prisma.chatMessage.findFirst({
            where: { sessionId: fx.subSessionId, role: "user", content: "W-E 排队任务" },
          });
          expect(userMsg).toBeTruthy();
          const assistant = await prisma.chatMessage.findFirst({
            where: { sessionId: fx.subSessionId, role: "assistant", createdAt: { gte: userMsg!.createdAt } },
            orderBy: { createdAt: "desc" },
          });
          expect(assistant).toBeTruthy();
          expect(assistant!.content.length).toBeGreaterThan(0);
        },
        { timeout: 10_000, interval: 50 },
      );

      // consume 后 AgentMessage 记账 consumed（deliveredAt 兜底补齐，pending 不泄漏）
      const consumedMsg = await prisma.agentMessage.findUnique({ where: { id: agentMsg!.id } });
      expect(consumedMsg!.status).toBe("consumed");
      expect(consumedMsg!.deliveredAt).toBeTruthy();
    } finally {
      clearTimeout(autoRelease);
      release();
      await cleanupDrainFixture(fx);
    }
  });

  it("T7b：waitForRun=true + busy——入队后等 drain 完成，再返回子会话最后 assistant", async () => {
    const ctx = await createContextInner();
    const fx = await createDrainFixture(ctx);
    const release = await occupySession(fx.subSessionId, fx.subAgentId);
    const autoRelease = setTimeout(release, 3000);
    try {
      const toolPromise = executeNativeTool(
        "agent_send_message",
        { toAgentId: fx.subAgentId, content: "W-E 同步等待任务", waitForRun: true },
        makeSendCtx(ctx, fx),
      ) as Promise<{ success?: boolean; queued?: boolean; content?: string; error?: string }>;

      // 等入队发生（旧实现不写队列 → 轮询超时后保险释放，断言 queued 即红）
      let sawItem = false;
      for (let i = 0; i < 40 && !sawItem; i++) {
        await new Promise((r) => setTimeout(r, 50));
        sawItem = (await ctx.services.sessionQueueItem.listBySession(fx.subSessionId)).length > 0;
      }
      expect(sawItem).toBe(true);

      // 转闲 → drain 处理 → 工具返回最终 assistant
      release();
      clearTimeout(autoRelease);
      const result = await toolPromise;

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.queued).toBe(true);
      expect(result.content).toBeTruthy();
      expect(result.content).not.toBe("(无文本输出)");

      // drain 已完成：队列空、user/assistant 均已落库
      expect(await ctx.services.sessionQueueItem.listBySession(fx.subSessionId)).toHaveLength(0);
      const userMsg = await prisma.chatMessage.findFirst({
        where: { sessionId: fx.subSessionId, role: "user", content: "W-E 同步等待任务" },
      });
      expect(userMsg).toBeTruthy();
    } finally {
      clearTimeout(autoRelease);
      release();
      await cleanupDrainFixture(fx);
    }
  });

  it("T7c：idle 但队列有残留——新消息入队尾，drain 立即触发，FIFO 保序", async () => {
    const ctx = await createContextInner();
    const fx = await createDrainFixture(ctx);
    try {
      // 残留 superior 项（模拟服务端重启链丢失后留存的 pending 项）
      await ctx.services.sessionQueueItem.create({
        sessionId: fx.subSessionId,
        kind: "superior",
        content: "W-E 残留消息",
        source: fx.parentAgentId,
      });

      // idle 状态下发新消息：同样入队尾而不是直接起流（FIFO）
      const result = (await executeNativeTool(
        "agent_send_message",
        { toAgentId: fx.subAgentId, content: "W-E 新消息" },
        makeSendCtx(ctx, fx),
      )) as { success?: boolean; queued?: boolean; error?: string };
      expect(result.error).toBeUndefined();
      expect(result.queued).toBe(true);

      // drain 立即触发（链上空步直接执行）：两条都按序处理完
      await vi.waitFor(
        async () => {
          const stale = await prisma.chatMessage.findFirst({
            where: { sessionId: fx.subSessionId, role: "user", content: "W-E 残留消息" },
          });
          const fresh = await prisma.chatMessage.findFirst({
            where: { sessionId: fx.subSessionId, role: "user", content: "W-E 新消息" },
          });
          expect(stale).toBeTruthy();
          expect(fresh).toBeTruthy();
        },
        { timeout: 10_000, interval: 50 },
      );
      expect(await ctx.services.sessionQueueItem.listBySession(fx.subSessionId)).toHaveLength(0);

      // FIFO：残留消息先于新消息进入子历史
      const stale = await prisma.chatMessage.findFirst({
        where: { sessionId: fx.subSessionId, role: "user", content: "W-E 残留消息" },
      });
      const fresh = await prisma.chatMessage.findFirst({
        where: { sessionId: fx.subSessionId, role: "user", content: "W-E 新消息" },
      });
      expect(stale!.createdAt.getTime()).toBeLessThanOrEqual(fresh!.createdAt.getTime());
    } finally {
      await cleanupDrainFixture(fx);
    }
  });

  it("consume 软认领：不存在 item 返回 claimed:false 不抛错；竞态双 consume 一胜一静默", async () => {
    const ctx = await createContextInner();
    const fx = await createDrainFixture(ctx);
    try {
      // ① 不存在的 item：软认领返回 claimed:false（旧实现抛 TRPCError NOT_FOUND → 旧实现即红）
      const miss = await ctx.services.sessionQueueItem.consume("clwe0nonexistent000000001");
      expect(miss).toEqual({ success: true, claimed: false });

      // ② 竞态双 consume：删除即认领，落选方静默（旧实现落选方抛 P2025/NOT_FOUND → 旧实现即红）
      const created = await ctx.services.sessionQueueItem.create({
        sessionId: fx.subSessionId,
        kind: "superior",
        content: "W-E 竞态认领",
        source: fx.parentAgentId,
      });
      const itemId = (created.data as { id: string }).id;
      const [r1, r2] = await Promise.all([
        ctx.services.sessionQueueItem.consume(itemId),
        ctx.services.sessionQueueItem.consume(itemId),
      ]);
      const claimedCount = [r1, r2].filter((r) => r.claimed).length;
      expect(claimedCount).toBe(1);
      expect([r1, r2].every((r) => r.success)).toBe(true);
      expect(await ctx.services.sessionQueueItem.listBySession(fx.subSessionId)).toHaveLength(0);
    } finally {
      await cleanupDrainFixture(fx);
    }
  });
});
