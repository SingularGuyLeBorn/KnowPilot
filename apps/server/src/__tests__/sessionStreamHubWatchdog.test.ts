/**
 * SessionStreamHub 运行看门狗：
 * - runner 永不结束时，runTimeoutMs / stallTimeoutMs 强制终止并释放内存态
 * - forceStop 可立即结束 stuck run
 * - 正常 runner 不受影响
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStreamHub } from "../infra/sessionStreamHub.js";
import type { AgentStreamEvent } from "../infra/agentStream.js";

function makeHub(opts: { runTimeoutMs?: number; runStallTimeoutMs?: number } = {}) {
  return new SessionStreamHub({
    persist: false,
    cleanupIntervalMs: 0,
    eventTtlMs: 1000,
    runTimeoutMs: 300_000,
    runStallTimeoutMs: 120_000,
    ...opts,
  });
}

async function collectTerminal(sid: string, hub: SessionStreamHub) {
  const events: AgentStreamEvent[] = [];
  const { unsubscribe } = await hub.subscribe(sid, 0, (b) => events.push(b.event));
  await hub.waitFor(sid);
  unsubscribe();
  return events;
}

describe("SessionStreamHub watchdog", () => {
  let hub: SessionStreamHub;

  beforeEach(() => {
    hub = makeHub();
  });

  afterEach(async () => {
    await hub.dispose();
  });

  it("runner 永不结束时，runTimeout 强制终止并允许再次起流", async () => {
    const sid = "watchdog-run-timeout";
    hub = makeHub({ runTimeoutMs: 50 });

    await hub.start(sid, { message: "hi", sessionId: sid, clientMessageId: "m1" }, async () => {
      await new Promise(() => {}); // never resolves
    });

    expect(hub.isRunning(sid)).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    expect(hub.isRunning(sid)).toBe(false);
    expect(hub.listRunning()).toHaveLength(0);

    const events = await collectTerminal(sid, hub);
    expect(events.some((e) => e.type === "error")).toBe(true);

    let started = false;
    const result = await hub.startIfNotRunning(
      sid,
      { message: "again", sessionId: sid, clientMessageId: "m2" },
      async () => {
        started = true;
      },
    );
    expect(result).toBe("started");
    expect(started).toBe(true);
    await hub.waitFor(sid);
  });

  it("runner 长时间无事件时，stallTimeout 强制终止", async () => {
    const sid = "watchdog-stall-timeout";
    hub = makeHub({ runStallTimeoutMs: 50, runTimeoutMs: 300_000 });

    await hub.start(sid, { message: "hi", sessionId: sid, clientMessageId: "m1" }, async (emit) => {
      emit({ type: "token", delta: "hello" });
      await new Promise(() => {}); // no more events
    });

    expect(hub.isRunning(sid)).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    expect(hub.isRunning(sid)).toBe(false);

    const events = await collectTerminal(sid, hub);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("forceStop 可立即结束 stuck runner", async () => {
    const sid = "watchdog-force-stop";
    hub = makeHub({ runTimeoutMs: 300_000 });

    await hub.start(sid, { message: "hi", sessionId: sid, clientMessageId: "m1" }, async () => {
      await new Promise(() => {});
    });

    expect(hub.isRunning(sid)).toBe(true);
    expect(hub.forceStop(sid)).toBe(true);
    await hub.waitFor(sid);
    expect(hub.isRunning(sid)).toBe(false);

    const events = await collectTerminal(sid, hub);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("正常 runner 在 runTimeout 内完成时不触发 watchdog", async () => {
    const sid = "watchdog-normal";
    hub = makeHub({ runTimeoutMs: 50 });

    await hub.start(sid, { message: "hi", sessionId: sid, clientMessageId: "m1" }, async (emit) => {
      emit({ type: "token", delta: "ok" });
      emit({ type: "done", sessionId: sid, agentId: "a", content: "ok", toolCalls: [], model: "m", provider: "p", roundsUsed: 1 });
    });

    await hub.waitFor(sid);
    expect(hub.isRunning(sid)).toBe(false);

    const events = await collectTerminal(sid, hub);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("stop(abort) 仍能让响应的 runner 正常收尾", async () => {
    const sid = "watchdog-stop-normal";
    hub = makeHub({ runTimeoutMs: 300_000 });
    let aborted = false;

    await hub.start(sid, { message: "hi", sessionId: sid, clientMessageId: "m1" }, async (_emit, signal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      aborted = signal.aborted;
    });

    expect(hub.stop(sid)).toBe(true);
    await hub.waitFor(sid);
    expect(aborted).toBe(true);
    expect(hub.isRunning(sid)).toBe(false);
  });
});
