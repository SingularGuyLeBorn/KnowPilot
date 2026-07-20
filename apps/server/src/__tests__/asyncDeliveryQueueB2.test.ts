/**
 * B2：superior drain 软认领（claimedAt）— 负向断言
 *
 * 旧实现：consume = 物理删除 + 同事务 AgentMessage→consumed，消息写入在之后的 prepareAgentRun。
 * 崩溃/抛错 → 行已删、账已 consumed、气泡未写，永久丢失。
 *
 * 新实现：consume 只置 claimedAt；ChatMessage 落地后 finalize 删行；
 * 启动恢复扫超龄 claimedAt 重置重投。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { enqueueSuperiorQueueDrain, runStartupRecovery } from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";
import { SESSION_QUEUE_CLAIM_STALE_MS } from "../services.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `b2${Date.now().toString(36)}`;

async function mkFixture(ctx: Ctx) {
  const agent = await ctx.services.agent.create({
    name: `B2-Agent-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [],
    tier: "sub",
  });
  const agentId = (agent.data as { id: string }).id;
  const session = await ctx.services.session.create({
    title: "B2 软认领会话",
    model: "deepseek-chat",
    agentId,
    kind: "subagent",
    isMainSession: true,
  } as any);
  const sessionId = (session.data as { id: string }).id;
  const agentMsg = await prisma.agentMessage.create({
    data: {
      fromAgentId: agentId,
      toAgentId: agentId,
      content: "B2 上级指令",
      messageType: "command",
      source: "manager",
      status: "pending",
      depth: 1,
    },
  });
  const created = await ctx.services.sessionQueueItem.create({
    sessionId,
    kind: "superior",
    content: "B2 上级指令",
    source: agentId,
    agentMessageId: agentMsg.id,
  });
  const itemId = (created.data as { id: string }).id;
  return { agentId, sessionId, itemId, agentMsgId: agentMsg.id };
}

async function cleanup(fx: { agentId: string; sessionId: string }) {
  await prisma.sessionQueueItem.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.agentMessage.deleteMany({ where: { OR: [{ fromAgentId: fx.agentId }, { toAgentId: fx.agentId }] } }).catch(() => {});
  await prisma.chatMessage.deleteMany({ where: { sessionId: fx.sessionId } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { id: fx.sessionId } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: fx.agentId } }).catch(() => {});
}

describe("B2 SessionQueueItem 软认领 claimedAt", () => {
  beforeEach(() => {
    resetAsyncJobOrchestratorForTests();
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
  });

  it("runItem 抛错：item 保留（claimedAt 置位），AgentMessage 仍 pending（旧实现行消失 → 旧实现即红）", async () => {
    const ctx = await createContextInner();
    const fx = await mkFixture(ctx);
    try {
      await enqueueSuperiorQueueDrain({
        sessionId: fx.sessionId,
        config: ctx.config,
        services: ctx.services,
        runItem: async () => {
          throw new Error("B2 模拟 prepareAgentRun 崩溃");
        },
      });

      await vi.waitFor(
        async () => {
          const row = await prisma.sessionQueueItem.findUnique({ where: { id: fx.itemId } });
          expect(row).toBeTruthy();
          expect(row!.claimedAt).toBeTruthy();
        },
        { timeout: 5000, interval: 30 },
      );

      // listBySession 对已认领项不可见
      expect(await ctx.services.sessionQueueItem.listBySession(fx.sessionId)).toHaveLength(0);

      const msg = await prisma.agentMessage.findUnique({ where: { id: fx.agentMsgId } });
      expect(msg?.status).toBe("pending");
    } finally {
      await cleanup(fx);
    }
  });

  it("正常路径：consume→落地→finalize 删行，AgentMessage consumed", async () => {
    const ctx = await createContextInner();
    const fx = await mkFixture(ctx);
    try {
      await enqueueSuperiorQueueDrain({
        sessionId: fx.sessionId,
        config: ctx.config,
        services: ctx.services,
        runItem: async (item) => {
          await ctx.services.message.create({
            sessionId: fx.sessionId,
            role: "user",
            content: item.content,
            source: "manager",
          } as any);
        },
      });

      await vi.waitFor(
        async () => {
          expect(await prisma.sessionQueueItem.findUnique({ where: { id: fx.itemId } })).toBeNull();
        },
        { timeout: 5000, interval: 30 },
      );

      const bubble = await prisma.chatMessage.findFirst({
        where: { sessionId: fx.sessionId, content: "B2 上级指令" },
      });
      expect(bubble).toBeTruthy();
      const msg = await prisma.agentMessage.findUnique({ where: { id: fx.agentMsgId } });
      expect(msg?.status).toBe("consumed");
    } finally {
      await cleanup(fx);
    }
  });

  it("超龄 claimedAt：releaseStaleClaims / 启动恢复后可重投", async () => {
    const ctx = await createContextInner();
    const fx = await mkFixture(ctx);
    try {
      const claim = await ctx.services.sessionQueueItem.consume(fx.itemId);
      expect(claim.claimed).toBe(true);
      await prisma.sessionQueueItem.update({
        where: { id: fx.itemId },
        data: { claimedAt: new Date(Date.now() - SESSION_QUEUE_CLAIM_STALE_MS - 1000) },
      });

      const released = await ctx.services.sessionQueueItem.releaseStaleClaims();
      expect(released).toBeGreaterThanOrEqual(1);

      const row = await prisma.sessionQueueItem.findUnique({ where: { id: fx.itemId } });
      expect(row?.claimedAt).toBeNull();
      expect(await ctx.services.sessionQueueItem.listBySession(fx.sessionId)).toHaveLength(1);

      // 再置超龄，走启动恢复入口。摘掉 hub，避免 release 后 superior drain 立刻重认领干扰断言。
      setStreamHub(null);
      await ctx.services.sessionQueueItem.consume(fx.itemId);
      await prisma.sessionQueueItem.update({
        where: { id: fx.itemId },
        data: { claimedAt: new Date(Date.now() - SESSION_QUEUE_CLAIM_STALE_MS - 1000) },
      });
      const recovery = await runStartupRecovery({ config: ctx.config, services: ctx.services });
      expect(recovery.staleQueueClaimsReleased).toBeGreaterThanOrEqual(1);
      expect((await prisma.sessionQueueItem.findUnique({ where: { id: fx.itemId } }))?.claimedAt).toBeNull();
    } finally {
      await cleanup(fx);
    }
  });

  it("竞态双 consume：恰一胜；落选 claimed:false", async () => {
    const ctx = await createContextInner();
    const fx = await mkFixture(ctx);
    try {
      const [r1, r2] = await Promise.all([
        ctx.services.sessionQueueItem.consume(fx.itemId),
        ctx.services.sessionQueueItem.consume(fx.itemId),
      ]);
      expect([r1, r2].filter((r) => r.claimed)).toHaveLength(1);
      expect([r1, r2].every((r) => r.success)).toBe(true);
      expect(await ctx.services.sessionQueueItem.listBySession(fx.sessionId)).toHaveLength(0);
      expect((await prisma.sessionQueueItem.findUnique({ where: { id: fx.itemId } }))?.claimedAt).toBeTruthy();
    } finally {
      await cleanup(fx);
    }
  });
});
