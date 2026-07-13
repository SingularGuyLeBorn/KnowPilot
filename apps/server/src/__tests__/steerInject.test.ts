/**
 * Steering / Follow-up 投递队列单测（SessionStreamHub）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStreamHub, setStreamHub } from "../infra/sessionStreamHub.js";
import type { AgentChatInput } from "@knowpilot/shared";

const baseInput = { message: "hi" } as AgentChatInput;

describe("SessionStreamHub inject queues", () => {
  let hub: SessionStreamHub;

  beforeEach(() => {
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

  afterEach(() => {
    hub.destroy();
    setStreamHub(null);
  });

  it("无活跃 run 时 enqueue 失败", () => {
    const r = hub.enqueueInject("clxxxxxxxxxxxxxxxxxxxxxxxxx", "steer", "改方向");
    expect(r.ok).toBe(false);
  });

  it("活跃 run 可入队，takeInject one-at-a-time", async () => {
    const sid = "clxxxxxxxxxxxxxxxxxxxxxxxx1";
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await hub.start(sid, baseInput, async () => {
      await gate;
    });

    expect(hub.enqueueInject(sid, "steer", "第一条").ok).toBe(true);
    expect(hub.enqueueInject(sid, "steer", "第二条").ok).toBe(true);

    const first = hub.takeInject(sid, "steer");
    expect(first).toHaveLength(1);
    expect(first[0]?.content).toBe("第一条");

    const second = hub.takeInject(sid, "steer");
    expect(second.map((x) => x.content)).toEqual(["第二条"]);

    resolveRun();
    await hub.waitFor(sid);
  });

  it("follow_up 与 steer 队列隔离；abort 清空", async () => {
    const sid = "clxxxxxxxxxxxxxxxxxxxxxxxx2";
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await hub.start(sid, baseInput, async (_emit, signal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
        void gate.then(() => {
          /* keep waiting abort */
        });
      });
    });

    hub.enqueueInject(sid, "steer", "steer-msg");
    hub.enqueueInject(sid, "follow_up", "fu-msg");
    expect(hub.takeInject(sid, "follow_up")[0]?.content).toBe("fu-msg");
    expect(hub.takeInject(sid, "steer")[0]?.content).toBe("steer-msg");

    hub.enqueueInject(sid, "steer", "will-clear");
    hub.stop(sid);
    expect(hub.takeInject(sid, "steer")).toHaveLength(0);
    resolveRun();
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
    const sid = "clxxxxxxxxxxxxxxxxxxxxxxxx3";
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => {
      resolveRun = r;
    });
    await allHub.start(sid, baseInput, async () => {
      await gate;
    });
    allHub.enqueueInject(sid, "steer", "a");
    allHub.enqueueInject(sid, "steer", "b");
    const batch = allHub.takeInject(sid, "steer");
    expect(batch.map((x) => x.content)).toEqual(["a", "b"]);
    resolveRun();
    await allHub.waitFor(sid);
    allHub.destroy();
  });
});
