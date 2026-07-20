/**
 * B7：SessionQueueItem @@unique([sessionId, agentMessageId]) + 事务 create — 负向断言
 *
 * 旧实现：check-then-insert 无 DB 唯一约束，并发双建可双行撞 order。
 * 新实现：唯一约束 + P2002 幂等返回；maxOrder 与 create 同事务。
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { setStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `b7${Date.now().toString(36)}`;

describe("B7 SessionQueueItem 唯一约束与事务 create", () => {
  beforeEach(() => {
    setStreamHub(new SessionStreamHub({ ringSize: 50, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
  });

  afterEach(async () => {
    setStreamHub(null);
    await prisma.sessionQueueItem.deleteMany({ where: { content: { startsWith: "B7-" } } }).catch(() => {});
    await prisma.agentMessage.deleteMany({ where: { content: { startsWith: "B7-" } } }).catch(() => {});
    await prisma.chatSession.deleteMany({ where: { title: { startsWith: `B7-${RUN_ID}` } } }).catch(() => {});
    await prisma.agent.deleteMany({ where: { name: { startsWith: `B7-${RUN_ID}` } } }).catch(() => {});
  });

  it("并发双写同 (sessionId, agentMessageId) → 单行（旧实现可双行 → 旧实现即红）", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `B7-${RUN_ID}-a`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "sub",
    });
    const agentId = (agent.data as { id: string }).id;
    const main = await prisma.chatSession.findFirst({
      where: { agentId, isMainSession: true },
    });
    if (!main) throw new Error("缺主会话");
    const sessionId = main.id;
    await prisma.chatSession.update({ where: { id: sessionId }, data: { title: `B7-${RUN_ID}` } });

    const agentMsg = await prisma.agentMessage.create({
      data: {
        fromAgentId: agentId,
        toAgentId: agentId,
        content: "B7-msg",
        messageType: "command",
        source: "manager",
        status: "pending",
        depth: 1,
      },
    });

    const [r1, r2] = await Promise.all([
      ctx.services.sessionQueueItem.create({
        sessionId,
        kind: "superior",
        content: "B7-dup",
        source: agentId,
        agentMessageId: agentMsg.id,
      }),
      ctx.services.sessionQueueItem.create({
        sessionId,
        kind: "superior",
        content: "B7-dup",
        source: agentId,
        agentMessageId: agentMsg.id,
      }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    const rows = await prisma.sessionQueueItem.findMany({
      where: { sessionId, agentMessageId: agentMsg.id },
    });
    expect(rows).toHaveLength(1);
    expect(r1.data?.id).toBe(rows[0].id);
    expect(r2.data?.id).toBe(rows[0].id);
  });
});
