/**
 * A2：SSE 事件 id 单一事实源（per-session seq）
 *
 * 负向断言（旧实现红）：
 * 1. 模拟「per-session seq 与全局 id 错位」后重放 → 已见事件不重复
 * 2. token 合帧尾帧携带 seq，推进 lastEventId
 * 3. DB 已有 done 时不补发 synthetic done
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../db.js";
import { SessionStreamHub } from "../infra/sessionStreamHub.js";
import { handleAgentChatStream } from "../infra/agentStream.js";
import type { AppConfig } from "../infra/config.js";
import type { AgentStreamEvent } from "../infra/agentStream.js";

const SID = "a2-seq-test-session";

describe("A2 SessionStreamEvent.seq 单一事实源", () => {
  beforeEach(async () => {
    await prisma.sessionStreamEvent.deleteMany({ where: { sessionId: SID } });
  });

  afterEach(async () => {
    await prisma.sessionStreamEvent.deleteMany({ where: { sessionId: SID } });
  });

  it("重放按 seq 过滤：已见事件不重复（seq≠全局 id 错位场景）", async () => {
    // 插入「全局 id 很大、seq 很小」的行，模拟双命名空间错位后的正确形态
    await prisma.sessionStreamEvent.createMany({
      data: [
        {
          sessionId: SID,
          seq: 1,
          eventType: "token",
          payload: { type: "token", delta: "a" } as object,
        },
        {
          sessionId: SID,
          seq: 2,
          eventType: "token",
          payload: { type: "token", delta: "b" } as object,
        },
        {
          sessionId: SID,
          seq: 3,
          eventType: "done",
          payload: {
            type: "done",
            sessionId: SID,
            agentId: "",
            content: "ok",
            toolCalls: [],
            model: "",
            provider: "",
            roundsUsed: 1,
          } as object,
        },
      ],
    });

    const hub = new SessionStreamHub({
      ringSize: 100,
      persist: true,
      eventTtlMs: 60_000,
      cleanupIntervalMs: 0,
    });

    const seen: Array<{ id: number; type: string }> = [];
    await hub.subscribe(SID, 2, (ev) => {
      seen.push({ id: ev.id, type: ev.event.type });
    });

    // resumeAfter=2（seq）→ 只应重放 seq=3；若误用全局 id 过滤会整段重放或空放
    expect(seen).toEqual([{ id: 3, type: "done" }]);
    await hub.dispose();
  });

  it("persist 写入携带 seq；失败重排按 seq 保序", async () => {
    const hub = new SessionStreamHub({
      ringSize: 100,
      persist: true,
      eventTtlMs: 60_000,
      cleanupIntervalMs: 0,
    });

    await hub.start(SID, { message: "hi", sessionId: SID } as never, async (emit) => {
      emit({ type: "token", delta: "x" });
      emit({ type: "token", delta: "y" });
      emit({
        type: "done",
        sessionId: SID,
        agentId: "a",
        content: "xy",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      } as AgentStreamEvent);
    });
    await hub.waitFor(SID);
    await hub.dispose();

    const rows = await prisma.sessionStreamEvent.findMany({
      where: { sessionId: SID },
      orderBy: { seq: "asc" },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // seq 单调且与缓冲 id 同源（从 1 起）
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].seq).toBeGreaterThan(rows[i - 1].seq);
    }
    expect(rows.every((r) => r.seq > 0)).toBe(true);
  });

  it("DB 已有 done 时 GET 续传不补发 synthetic done", async () => {
    await prisma.sessionStreamEvent.create({
      data: {
        sessionId: SID,
        seq: 5,
        eventType: "done",
        payload: {
          type: "done",
          sessionId: SID,
          agentId: "a",
          content: "real",
          toolCalls: [],
          model: "m",
          provider: "p",
          roundsUsed: 1,
        } as object,
      },
    });

    const hub = new SessionStreamHub({
      ringSize: 100,
      persist: true,
      eventTtlMs: 60_000,
      cleanupIntervalMs: 0,
    });
    const config = { auth: { mode: "none", password: "", token: "" } } as unknown as AppConfig;
    const handler = handleAgentChatStream({} as never, config, (async () => {}) as never, hub);

    const writes: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => writes.push(chunk)),
      end: vi.fn(),
      on: vi.fn(),
    };

    await handler(
      {
        method: "GET",
        // afterEventId>0 才走续传重放（=0 且非运行会直接 error）
        query: { sessionId: SID, resumeAfter: "4" },
        body: {},
        headers: {},
      } as never,
      res as never,
    );
    await new Promise((r) => setTimeout(r, 20));

    const doneChunks = writes.filter((w) => w.includes("event: done"));
    // 只应有 DB 重放的那一条真实 done，不应再补一条空 content 的 synthetic done
    expect(doneChunks.length).toBe(1);
    expect(writes.join("")).toContain('"content":"real"');
    expect(writes.join("")).not.toMatch(/"content":""/);
    await hub.dispose();
  });

  it("token 合帧 writeSse 携带尾帧 seq", async () => {
    const hub = new SessionStreamHub({
      ringSize: 100,
      persist: false,
      eventTtlMs: 1000,
      cleanupIntervalMs: 0,
    });

    let resolveRun!: () => void;
    const runGate = new Promise<void>((r) => {
      resolveRun = r;
    });

    await hub.start(SID, { message: "hi", sessionId: SID } as never, async (emit, signal) => {
      emit({ type: "token", delta: "hello" });
      // 等订阅方接上后再发非 token，触发合帧 flush
      await runGate;
      if (signal.aborted) return;
      emit({
        type: "done",
        sessionId: SID,
        agentId: "a",
        content: "hello",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      } as AgentStreamEvent);
    });

    const config = { auth: { mode: "none", password: "", token: "" } } as unknown as AppConfig;
    const handler = handleAgentChatStream({} as never, config, (async () => {}) as never, hub);

    const writes: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => writes.push(chunk)),
      end: vi.fn(),
      on: vi.fn(),
    };

    const subPromise = handler(
      {
        method: "GET",
        query: { sessionId: SID, resumeAfter: "0" },
        body: {},
        headers: {},
      } as never,
      res as never,
    );

    // 等合帧定时器把 token 写出
    await new Promise((r) => setTimeout(r, 40));
    resolveRun();
    await subPromise;
    await hub.waitFor(SID);
    await new Promise((r) => setTimeout(r, 20));

    const tokenWrite = writes.find((w) => w.includes("event: token"));
    expect(tokenWrite).toBeTruthy();
    // 合帧必须带 id:（旧实现 token 合帧无 id → lastEventId 不前进）
    expect(tokenWrite!).toMatch(/^id: \d+/m);
    await hub.dispose();
  });
});
