/**
 * Steering / Follow-up 投递队列单测（SessionStreamHub）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../db.js";
import { SessionStreamHub, setStreamHub } from "../infra/sessionStreamHub.js";
import type { AgentChatInput } from "@knowpilot/shared";

const baseInput = { message: "hi" } as AgentChatInput;

describe("SessionStreamHub inject queues", () => {
  let hub: SessionStreamHub;
  let sessionId: string;

  beforeEach(async () => {
    const sess = await prisma.chatSession.create({
      data: { title: "steer-inject-test", model: "test" },
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

  it("无活跃 run 时 enqueue 失败", async () => {
    const r = await hub.enqueueInject(sessionId, "steer", "改方向");
    expect(r.ok).toBe(false);
  });

  it("活跃 run 可入队，takeInject one-at-a-time", async () => {
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await hub.start(sessionId, baseInput, async () => {
      await gate;
    });

    expect((await hub.enqueueInject(sessionId, "steer", "第一条")).ok).toBe(true);
    expect((await hub.enqueueInject(sessionId, "steer", "第二条")).ok).toBe(true);

    const first = hub.takeInject(sessionId, "steer");
    expect(first).toHaveLength(1);
    expect(first[0]?.content).toBe("第一条");

    const second = hub.takeInject(sessionId, "steer");
    expect(second.map((x) => x.content)).toEqual(["第二条"]);

    // ack 以免 finally handoff 干扰
    await hub.ackInject(
      sessionId,
      [...first, ...second].map((x) => x.id),
    );
    resolveRun();
    await hub.waitFor(sessionId);
  });

  it("follow_up 与 steer 队列隔离；abort 清空内存但持久行移交", async () => {
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await hub.start(sessionId, baseInput, async (_emit, signal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
        void gate.then(() => {
          /* keep waiting abort */
        });
      });
    });

    await hub.enqueueInject(sessionId, "steer", "steer-msg");
    await hub.enqueueInject(sessionId, "follow_up", "fu-msg");
    expect(hub.takeInject(sessionId, "follow_up")[0]?.content).toBe("fu-msg");
    expect(hub.takeInject(sessionId, "steer")[0]?.content).toBe("steer-msg");

    await hub.enqueueInject(sessionId, "steer", "will-clear");
    hub.stop(sessionId);
    expect(hub.takeInject(sessionId, "steer")).toHaveLength(0);
    resolveRun();
    await hub.waitFor(sessionId);
    await new Promise((r) => setTimeout(r, 30));
    // 未 ack 的 will-clear 应移交为 user
    const handed = await prisma.sessionQueueItem.findMany({
      where: { sessionId, content: "will-clear" },
    });
    expect(handed).toHaveLength(1);
    expect(handed[0].kind).toBe("user");
  });

  it("steeringMode=all 一次取光", async () => {
    const allHub = new SessionStreamHub({
      ringSize: 50,
      persist: false,
      eventTtlMs: 60_000,
      cleanupIntervalMs: 0,
      steeringMode: "all",
      followUpMode: "all",
    });
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await allHub.start(sessionId, baseInput, async () => {
      await gate;
    });
    await allHub.enqueueInject(sessionId, "steer", "a");
    await allHub.enqueueInject(sessionId, "steer", "b");
    const batch = allHub.takeInject(sessionId, "steer");
    expect(batch.map((x) => x.content)).toEqual(["a", "b"]);
    await allHub.ackInject(
      sessionId,
      batch.map((x) => x.id),
    );
    resolveRun();
    await allHub.waitFor(sessionId);
    allHub.destroy();
  });
});
