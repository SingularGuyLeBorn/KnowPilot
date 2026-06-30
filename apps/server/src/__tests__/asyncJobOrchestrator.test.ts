import { describe, it, expect, vi, afterEach } from "vitest";
import { AsyncJobOrchestrator, resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";

describe("AsyncJobOrchestrator", () => {
  afterEach(() => {
    resetAsyncJobOrchestratorForTests();
  });

  it("全局并发上限：第三个任务排队", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 5 });
    const order: string[] = [];
    const gate = { open: false };

    const mk = (id: string) => ({
      jobId: id,
      sessionId: "s1",
      execute: async () => {
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
    const orch = new AsyncJobOrchestrator({ maxGlobal: 10, maxPerSession: 1 });
    let running = 0;
    let maxRunning = 0;

    const mk = (id: string) => ({
      jobId: id,
      sessionId: "sess-a",
      execute: async () => {
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
});
