import { describe, it, expect, vi, afterEach } from "vitest";
import { AsyncJobOrchestrator, resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";

describe("AsyncJobOrchestrator", () => {
  afterEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  it("全局并发上限：第三个任务排队", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 5, taskTimeoutMs: 60_000 });
    const order: string[] = [];
    const gate = { open: false };

    const mk = (id: string) => ({
      jobId: id,
      sessionId: "s1",
      execute: async (_signal: AbortSignal) => {
        order.push(`start-${id}`);
        while (!gate.open) await new Promise((r) => setTimeout(r, 20));
        order.push(`end-${id}`);
      },
    });

    orch.enqueue(mk("a"));
    orch.enqueue(mk("b"));
    orch.enqueue(mk("c"));

    await new Promise((r) => setTimeout(r, 50));
    expect(order.filter((x) => x.startsWith("start"))).toHaveLength(2);
    expect(order.some((x) => x === "start-c")).toBe(false);

    gate.open = true;
    await new Promise((r) => setTimeout(r, 80));
    expect(order.some((x) => x === "start-c")).toBe(true);
  });

  it("单 session 并发上限", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 10, maxPerSession: 1, taskTimeoutMs: 60_000 });
    let running = 0;
    let maxRunning = 0;

    const mk = (id: string) => ({
      jobId: id,
      sessionId: "sess-a",
      execute: async (_signal: AbortSignal) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 30));
        running--;
      },
    });

    orch.enqueue(mk("1"));
    orch.enqueue(mk("2"));
    await new Promise((r) => setTimeout(r, 120));
    expect(maxRunning).toBe(1);
  });

  it("取消运行中任务会 abort signal", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 2, taskTimeoutMs: 60_000 });
    let aborted = false;

    orch.enqueue({
      jobId: "j1",
      sessionId: "s1",
      execute: async (signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise((r) => setTimeout(r, 200));
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(orch.cancel("j1")).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
  });

  it("超时自动 abort", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 2, taskTimeoutMs: 50 });
    let aborted = false;

    orch.enqueue({
      jobId: "j1",
      sessionId: "s1",
      execute: async (signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise((r) => setTimeout(r, 500));
      },
    });

    await new Promise((r) => setTimeout(r, 120));
    expect(aborted).toBe(true);
  });
});
