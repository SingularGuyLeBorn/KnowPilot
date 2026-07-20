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
    let reason: unknown;

    orch.enqueue({
      jobId: "j1",
      sessionId: "s1",
      execute: async (signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reason = signal.reason;
        });
        await new Promise((r) => setTimeout(r, 200));
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(orch.cancel("j1")).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
    expect(reason).toBe("cancel");
  });

  it("lightweight 不占全局 LLM 槽：满槽时 sleep 类仍立即 start", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 5, taskTimeoutMs: 60_000 });
    const gate = { open: false };
    const started: string[] = [];

    orch.enqueue({
      jobId: "llm-1",
      sessionId: "s1",
      slotClass: "llm",
      execute: async () => {
        started.push("llm-1");
        while (!gate.open) await new Promise((r) => setTimeout(r, 15));
      },
    });
    orch.enqueue({
      jobId: "llm-2",
      sessionId: "s1",
      slotClass: "llm",
      execute: async () => {
        started.push("llm-2");
      },
    });
    orch.enqueue({
      jobId: "sleep-1",
      sessionId: "s1",
      slotClass: "lightweight",
      execute: async () => {
        started.push("sleep-1");
      },
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(started).toContain("llm-1");
    expect(started).toContain("sleep-1");
    expect(started).not.toContain("llm-2");
    expect(orch.getStats().runningGlobal).toBe(1);

    gate.open = true;
    await new Promise((r) => setTimeout(r, 60));
    expect(started).toContain("llm-2");
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

  it("任务级 timeoutMs 覆盖全局默认值", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 2, taskTimeoutMs: 60_000 });
    let aborted = false;

    orch.enqueue({
      jobId: "j1",
      sessionId: "s1",
      timeoutMs: 50,
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

  it("stopSubagent 会 abort 运行中的 subagent 任务", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 2, taskTimeoutMs: 60_000 });
    let aborted = false;

    orch.enqueue({
      jobId: "j-sub",
      sessionId: "s1",
      metadata: { subagentSessionId: "sub-1" },
      execute: async (signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise((r) => setTimeout(r, 500));
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(orch.stopSubagent("sub-1")).toEqual({ stopped: true, wasRunning: true, jobId: "j-sub" });
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
  });

  it("stopSubagent 可以移除排队中的 subagent 任务", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 1, taskTimeoutMs: 60_000 });
    let started = false;

    orch.enqueue({
      jobId: "j-first",
      sessionId: "s1",
      execute: async () => {
        started = true;
        await new Promise((r) => setTimeout(r, 200));
      },
    });

    orch.enqueue({
      jobId: "j-sub",
      sessionId: "s1",
      metadata: { subagentSessionId: "sub-queued" },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 50));
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(started).toBe(true);
    expect(orch.isQueued("j-sub")).toBe(true);
    // 排队中移除：wasRunning=false，jobId 返回供调用方回写 Task
    expect(orch.stopSubagent("sub-queued")).toEqual({ stopped: true, wasRunning: false, jobId: "j-sub" });
    expect(orch.isQueued("j-sub")).toBe(false);
  });

  it("stopSubagent 未命中返回 stopped=false", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 1, maxPerSession: 1, taskTimeoutMs: 60_000 });
    expect(orch.stopSubagent("nonexistent")).toEqual({ stopped: false, wasRunning: false });
  });

  it("B6：execute 同步 throw → runningGlobal 归零（旧实现泄漏槽位 → 旧实现即红）", async () => {
    const orch = new AsyncJobOrchestrator({ maxGlobal: 2, maxPerSession: 2, taskTimeoutMs: 60_000 });
    orch.enqueue({
      jobId: "sync-throw",
      sessionId: "s1",
      execute: () => {
        throw new Error("B6 同步抛错");
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(orch.getStats().runningGlobal).toBe(0);
  });
});
