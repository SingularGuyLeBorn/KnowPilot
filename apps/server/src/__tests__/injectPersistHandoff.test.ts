/**
 * A5：steer/follow_up 接受即持久；run 收尾未消费项移交；take 后 abort 不丢消息
 *
 * 负向断言（旧实现红）：
 * - run 收尾窗口注入 follow_up → 消息不丢（进 user 队列）
 * - takeSteer 后 abort → 消息回到队列（SessionQueueItem 仍在）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../db.js";
import { SessionStreamHub, setStreamHub } from "../infra/sessionStreamHub.js";
import type { AgentChatInput } from "@knowpilot/shared";

const baseInput = { message: "hi" } as AgentChatInput;

describe("A5 inject 持久化与收尾移交", () => {
  let hub: SessionStreamHub;
  let sessionId: string;

  beforeEach(async () => {
    const sess = await prisma.chatSession.create({
      data: { title: "a5-inject", model: "test" },
    });
    sessionId = sess.id;
    hub = new SessionStreamHub({
      ringSize: 50,
      persist: false,
      eventTtlMs: 60_000,
      cleanupIntervalMs: 0,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });
    setStreamHub(hub);
  });

  afterEach(async () => {
    hub.destroy();
    setStreamHub(null);
    await prisma.sessionQueueItem.deleteMany({ where: { sessionId } });
    await prisma.chatSession.deleteMany({ where: { id: sessionId } });
  });

  it("enqueueInject 先写 SessionQueueItem；take 不删库；ack 后删除", async () => {
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await hub.start(sessionId, baseInput, async () => {
      await gate;
    });

    const enq = await hub.enqueueInject(sessionId, "follow_up", "收尾追问");
    expect(enq.ok).toBe(true);
    if (!enq.ok) return;

    const row = await prisma.sessionQueueItem.findUnique({ where: { id: enq.id } });
    expect(row?.kind).toBe("follow_up");
    expect(row?.content).toBe("收尾追问");

    const taken = hub.takeInject(sessionId, "follow_up");
    expect(taken).toHaveLength(1);
    // take 后库行仍在（旧实现仅内存，abort/收尾即蒸发）
    expect(await prisma.sessionQueueItem.findUnique({ where: { id: enq.id } })).toBeTruthy();

    await hub.ackInject(sessionId, [enq.id]);
    expect(await prisma.sessionQueueItem.findUnique({ where: { id: enq.id } })).toBeNull();

    resolveRun();
    await hub.waitFor(sessionId);
  });

  it("takeSteer 后 abort → 收尾移交 user 队列，消息不丢", async () => {
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await hub.start(sessionId, baseInput, async (_emit, signal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
        void gate;
      });
    });

    const enq = await hub.enqueueInject(sessionId, "steer", "改方向后中断");
    expect(enq.ok).toBe(true);
    if (!enq.ok) return;

    const taken = hub.takeInject(sessionId, "steer");
    expect(taken[0]?.content).toBe("改方向后中断");
    // 模拟 take 后尚未 inject 即 abort（不 ack）
    hub.stop(sessionId);
    resolveRun();
    await hub.waitFor(sessionId);
    // finally handoff：steer → user
    await new Promise((r) => setTimeout(r, 30));

    const handed = await prisma.sessionQueueItem.findMany({
      where: { sessionId, content: "改方向后中断" },
    });
    expect(handed).toHaveLength(1);
    expect(handed[0].kind).toBe("user");
  });

  it("run 正常结束时未消费 follow_up 移交 user 队列", async () => {
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await hub.start(sessionId, baseInput, async () => {
      await gate;
    });
    const enq = await hub.enqueueInject(sessionId, "follow_up", "未消费追问");
    expect(enq.ok).toBe(true);
    resolveRun();
    await hub.waitFor(sessionId);
    await new Promise((r) => setTimeout(r, 30));

    const handed = await prisma.sessionQueueItem.findMany({
      where: { sessionId, content: "未消费追问" },
    });
    expect(handed).toHaveLength(1);
    expect(handed[0].kind).toBe("user");
  });
});
