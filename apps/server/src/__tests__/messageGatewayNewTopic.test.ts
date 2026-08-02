/**
 * /new 与「新话题」指令：创建新 session 后，下一条无 chatId 的消息必须回到新 session，
 * 而不是被旧的默认绑定拉回旧 session。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import {
  __resetMessageGatewayForTests,
  handleIncomingMessage,
  initMessageGateway,
  registerChannelAdapter,
  type ChannelAdapter,
  type UnifiedMessage,
} from "../infra/messageGateway.js";
import { SessionStreamHub, setStreamHub } from "../infra/sessionStreamHub.js";
import { createContextInner } from "../trpc/context.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";
import type { AgentStreamEvent } from "../infra/agentStream.js";

vi.mock("../infra/agentStream.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/agentStream.js")>();
  const callSessionIds: string[] = [];
  return {
    ...mod,
    chatAgentStream: async (
      _services: unknown,
      _config: unknown,
      body: { sessionId: string; message: string },
      _invoke: unknown,
      emit: (e: AgentStreamEvent) => void,
      _signal: AbortSignal,
    ) => {
      callSessionIds.push(body.sessionId);
      emit({
        type: "done",
        sessionId: body.sessionId,
        agentId: "a",
        content: "ok",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      });
    },
    __getCallSessionIds: () => callSessionIds,
    __resetCallSessionIds: () => {
      callSessionIds.length = 0;
    },
  };
});

import * as agentStream from "../infra/agentStream.js";

describe("messageGateway /new 话题切换", () => {
  let hub: SessionStreamHub;
  let ctx: Awaited<ReturnType<typeof createContextInner>>;
  let agentId: string;
  let adapter: ChannelAdapter;

  beforeEach(async () => {
    await __resetMessageGatewayForTests();
    (agentStream as unknown as { __resetCallSessionIds: () => void }).__resetCallSessionIds();
    hub = new SessionStreamHub({
      persist: false,
      cleanupIntervalMs: 0,
      eventTtlMs: 1000,
      runTimeoutMs: 300_000,
      runStallTimeoutMs: 120_000,
    });
    setStreamHub(hub);
    ctx = await createContextInner();
    const agent = await prisma.agent.create({
      data: { name: "assistant", sourceSlug: "assistant", model: "test" },
    });
    agentId = agent.id;
    adapter = {
      channel: "qq",
      name: "mock",
      enabled: true,
      getStatus: () => ({ state: "connected" }),
      start: async () => {},
      stop: async () => {},
      reply: async () => {},
    };
    registerChannelAdapter(adapter);
    initMessageGateway({
      prisma,
      services: ctx.services,
      config: createTestConfig(process.cwd(), { auth: { mode: "none", password: "", token: "" } }),
    });
  });

  afterEach(async () => {
    await hub.dispose();
    setStreamHub(null);
    await prisma.channelBinding.deleteMany({});
    await prisma.chatSession.deleteMany({});
    await prisma.chatMessage.deleteMany({});
    await prisma.agent.deleteMany({ where: { id: agentId } });
    await prisma.processedWebhookEvent.deleteMany({});
  });

  function makeMsg(peerId: string, text: string, eventId: string): UnifiedMessage {
    return {
      envelope: { channel: "qq", peerId, timestamp: new Date().toISOString() },
      payload: { text },
      meta: { eventId },
    };
  }

  function getCallIds() {
    return (agentStream as unknown as { __getCallSessionIds: () => string[] }).__getCallSessionIds();
  }

  it("/new 后同 peer 的下一条消息进入新 session，不再回到旧 session", async () => {
    const peerId = "new-topic-user";
    const ids = getCallIds();

    const r1 = await handleIncomingMessage(makeMsg(peerId, "第一轮", "e-1"));
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("unexpected");
    const s1 = r1.sessionId;
    expect(s1).toBeTruthy();

    await handleIncomingMessage(makeMsg(peerId, "/new", "e-2"));
    const r3 = await handleIncomingMessage(makeMsg(peerId, "第二轮", "e-3"));
    expect(r3.ok).toBe(true);
    if (!r3.ok) throw new Error("unexpected");
    const s2 = r3.sessionId;
    expect(s2).toBeTruthy();
    expect(s2).not.toBe(s1);

    // 三轮都应成功路由；第三轮必须跟第二轮同一 session（即 /new 后的新 session）
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(s1);
    expect(ids[1]).toBe(s2);
    expect(ids[2]).toBe(s2);
  });

  it("自然语言「开启一个新话题」也能触发新 session 切换", async () => {
    const peerId = "new-topic-natural";
    const ids = getCallIds();

    const r1 = await handleIncomingMessage(makeMsg(peerId, "旧话题", "e-n1"));
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("unexpected");
    const s1 = r1.sessionId;

    await handleIncomingMessage(makeMsg(peerId, "开启一个新话题", "e-n2"));
    const r3 = await handleIncomingMessage(makeMsg(peerId, "新内容", "e-n3"));
    expect(r3.ok).toBe(true);
    if (!r3.ok) throw new Error("unexpected");
    const s2 = r3.sessionId;

    expect(s2).toBeTruthy();
    expect(s2).not.toBe(s1);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(s1);
    expect(ids[1]).toBe(s2);
    expect(ids[2]).toBe(s2);
  });
});
