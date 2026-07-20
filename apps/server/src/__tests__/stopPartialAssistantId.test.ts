/**
 * E3：stopAgentChat 响应契约 — partialAssistantMessageId
 *
 * 负向断言（旧实现红）：
 * - 有 partial → stop 返回预生成 id，且与最终落库 id 一致
 * - 无 partial → 返回 null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../db.js";
import { SessionStreamHub, setStreamHub } from "../infra/sessionStreamHub.js";
import { handleAgentChatStop } from "../infra/agentStream.js";
import { createContextInner } from "../trpc/context.js";
import type { AgentChatInput } from "@knowpilot/shared";

describe("E3 stop partialAssistantMessageId 契约", () => {
  let hub: SessionStreamHub;
  let sessionId: string;

  beforeEach(async () => {
    hub = new SessionStreamHub({
      ringSize: 50,
      persist: false,
      eventTtlMs: 2000,
      cleanupIntervalMs: 0,
    });
    setStreamHub(hub);
    const sess = await prisma.chatSession.create({
      data: { title: "e3-stop", model: "test" },
    });
    sessionId = sess.id;
  });

  afterEach(async () => {
    hub.destroy();
    setStreamHub(null);
    await prisma.chatMessage.deleteMany({ where: { sessionId } });
    await prisma.chatSession.deleteMany({ where: { id: sessionId } });
  });

  it("无 partial 时 stop 返回 null", async () => {
    await hub.start(sessionId, { message: "hi", sessionId } as AgentChatInput, async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    // 未注册/未 mark → null
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    handleAgentChatStop(hub)({ body: { sessionId } } as never, res as never);
    expect(res.json).toHaveBeenCalledWith({
      stopped: true,
      partialAssistantMessageId: null,
    });
    await hub.waitFor(sessionId);
  });

  it("有 partial 时 stop 返回预生成 id，且与落库一致", async () => {
    const ctx = await createContextInner();
    const ac = new AbortController();
    let emitFn: ((e: { type: string; delta?: string }) => void) | null = null;

    const runPromise = hub.start(
      sessionId,
      { message: "请写长文", sessionId } as AgentChatInput,
      async (emit, signal) => {
        emitFn = emit as typeof emitFn;
        // 模拟 chatAgentStream 的注册 + mark（走真实 chatAgentStream 过重，此处测 hub 契约 + 落库 id）
        const pendingId = `c${"a".repeat(24)}`;
        hub.setPendingAssistantMessageId(sessionId, pendingId);
        emit({ type: "token", delta: "partial-text" });
        hub.markPartialAssistant(sessionId);
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        // abort 后模拟落库（与 chatAgentStream abort 分支同 id）
        if (signal.aborted) {
          await ctx.services.message.create({
            id: pendingId,
            sessionId,
            role: "assistant",
            content: "partial-text",
            finishReason: "aborted",
          });
        }
        void emitFn;
        void ac;
      },
    );

    await new Promise((r) => setTimeout(r, 20));

    const json = vi.fn();
    handleAgentChatStop(hub)({ body: { sessionId } } as never, { status: vi.fn(), json } as never);

    expect(json).toHaveBeenCalledWith({
      stopped: true,
      partialAssistantMessageId: `c${"a".repeat(24)}`,
    });

    await runPromise;
    await hub.waitFor(sessionId);

    const msg = await prisma.chatMessage.findFirst({
      where: { sessionId, role: "assistant", finishReason: "aborted" },
    });
    expect(msg?.id).toBe(`c${"a".repeat(24)}`);
    expect(msg?.content).toBe("partial-text");
  });
});
