/**
 * A4：startIfNotRunning 三态 + 占位键唯一
 *
 * 负向断言（旧实现红）：
 * - 运行中 POST 新消息 → busy（非静默附着），消息入队不丢
 * - 同 clientMessageId 重试 → duplicate（允许降级订阅）
 * - 两新会话并发首消息（无 sessionId）→ 各自起流不串（不共享 ""）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { SessionStreamHub } from "../infra/sessionStreamHub.js";
import { handleAgentChatStream, handleBusyHubPost } from "../infra/agentStream.js";
import { createContextInner } from "../trpc/context.js";
import type { AppConfig } from "../infra/config.js";
import type { AgentChatInput } from "@knowpilot/shared";

describe("A4 startIfNotRunning 三态", () => {
  let hub: SessionStreamHub;

  beforeEach(() => {
    hub = new SessionStreamHub({
      ringSize: 50,
      persist: false,
      eventTtlMs: 1000,
      cleanupIntervalMs: 0,
    });
  });

  afterEach(async () => {
    await hub.dispose();
  });

  it("同 clientMessageId 重试 → duplicate；不同消息 → busy", async () => {
    const sid = "a4-tri-session";
    const input: AgentChatInput = {
      sessionId: sid,
      message: "hello",
      clientMessageId: "msg-1",
    };

    const started = await hub.startIfNotRunning(sid, input, async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(started).toBe("started");

    const dup = await hub.startIfNotRunning(sid, { ...input }, async () => {});
    expect(dup).toBe("duplicate");

    const busy = await hub.startIfNotRunning(
      sid,
      { sessionId: sid, message: "other", clientMessageId: "msg-2" },
      async () => {},
    );
    expect(busy).toBe("busy");

    await hub.waitFor(sid);
  });

  it("两 pending 占位键并发起流互不覆盖", async () => {
    const keyA = `pending:${randomUUID()}`;
    const keyB = `pending:${randomUUID()}`;
    const startedKeys: string[] = [];

    const rA = hub.startIfNotRunning(keyA, { message: "a", clientMessageId: "ca" }, async (emit) => {
      startedKeys.push(keyA);
      emit({ type: "session_start", sessionId: "real-a" });
      await new Promise((r) => setTimeout(r, 30));
    });
    const rB = hub.startIfNotRunning(keyB, { message: "b", clientMessageId: "cb" }, async (emit) => {
      startedKeys.push(keyB);
      emit({ type: "session_start", sessionId: "real-b" });
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(await rA).toBe("started");
    expect(await rB).toBe("started");
    await hub.waitFor(keyA);
    await hub.waitFor(keyB);
    expect(startedKeys.sort()).toEqual([keyA, keyB].sort());
  });

  it("运行中 POST 新消息 → 409 且消息入队", async () => {
    const ctx = await createContextInner();
    const sess = await prisma.chatSession.create({
      data: { title: "a4-busy-post", model: "test" },
    });
    const sid = sess.id;

    await hub.startIfNotRunning(
      sid,
      { sessionId: sid, message: "first", clientMessageId: "c1" },
      async () => {
        await new Promise((r) => setTimeout(r, 200));
      },
    );

    const config = { auth: { mode: "none", password: "", token: "" } } as unknown as AppConfig;
    const handler = handleAgentChatStream(ctx.services, config, async () => ({}), hub);

    let statusCode = 200;
    const jsonBody: unknown[] = [];
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        jsonBody.push(payload);
        return this;
      },
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    await handler(
      {
        method: "POST",
        query: {},
        body: {
          sessionId: sid,
          message: "second-new-msg",
          clientMessageId: "c2",
        },
        headers: {},
      } as never,
      res as never,
    );

    expect(statusCode).toBe(409);
    expect(jsonBody[0]).toMatchObject({
      code: "SESSION_BUSY",
      sessionId: sid,
    });

    const queued = await prisma.sessionQueueItem.findMany({
      where: { sessionId: sid, kind: "user", content: "second-new-msg" },
    });
    expect(queued.length).toBeGreaterThanOrEqual(1);

    await hub.waitFor(sid);
    await prisma.sessionQueueItem.deleteMany({ where: { sessionId: sid } });
    await prisma.chatSession.delete({ where: { id: sid } });
  });

  it("handleBusyHubPost：重试/编辑在忙碌时 rejected", async () => {
    const ctx = await createContextInner();
    const r = await handleBusyHubPost(ctx.services, "any", {
      sessionId: "any",
      regenerate: true,
      message: "x",
    } as AgentChatInput);
    expect(r?.kind).toBe("rejected");
  });
});
