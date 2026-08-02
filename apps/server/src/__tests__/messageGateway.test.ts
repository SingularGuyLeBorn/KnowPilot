import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  __resetMessageGatewayForTests,
  handleIncomingMessage,
  initMessageGateway,
  registerChannelAdapter,
  type ChannelAdapter,
  type UnifiedMessage,
} from "../infra/messageGateway.js";
import { wrapEmitForChannelReply } from "../infra/channelStreamBridge.js";

describe("channelStreamBridge", () => {
  it("token 节流 + done 终稿", async () => {
    const chunks: Array<{ text: string; finish: boolean; reasoning?: string }> = [];
    const emit = vi.fn();
    const wrapped = wrapEmitForChannelReply(emit, (c) => {
      chunks.push({ text: c.text, finish: c.finish, reasoning: c.reasoning });
    });
    wrapped({ type: "token", delta: "你" });
    wrapped({ type: "token", delta: "好" });
    wrapped({
      type: "done",
      sessionId: "s1",
      agentId: "a1",
      content: "你好",
      toolCalls: [],
      model: "m",
      provider: "p",
      roundsUsed: 1,
    });
    expect(emit).toHaveBeenCalled();
    expect(chunks.at(-1)).toEqual({ text: "你好", finish: true, reasoning: undefined });
  });

  it("thinking 事件被收集并在 finish 时带回 reasoning", async () => {
    const chunks: Array<{ text: string; finish: boolean; reasoning?: string }> = [];
    const emit = vi.fn();
    const wrapped = wrapEmitForChannelReply(emit, (c) => {
      chunks.push({ text: c.text, finish: c.finish, reasoning: c.reasoning });
    });
    wrapped({ type: "thinking", delta: "先分析" });
    wrapped({ type: "thinking", delta: "，再回答" });
    wrapped({ type: "token", delta: "答案" });
    wrapped({
      type: "done",
      sessionId: "s1",
      agentId: "a1",
      content: "答案",
      toolCalls: [],
      model: "m",
      provider: "p",
      roundsUsed: 1,
    });
    expect(chunks.at(-1)).toEqual({
      text: "答案",
      finish: true,
      reasoning: "先分析，再回答",
    });
  });
});

describe("messageGateway 幂等（mock deps）", () => {
  beforeEach(async () => {
    await __resetMessageGatewayForTests();
  });

  it("未 init 时返回错误", async () => {
    const r = await handleIncomingMessage({
      envelope: { channel: "qq", peerId: "u1", timestamp: new Date().toISOString() },
      payload: { text: "hi" },
      meta: { eventId: "e1" },
    });
    expect(r.ok).toBe(false);
  });

  it("空消息拒绝", async () => {
    initMessageGateway({
      prisma: {} as never,
      services: {} as never,
      config: {} as never,
    });
    const r = await handleIncomingMessage({
      envelope: { channel: "qq", peerId: "u1", timestamp: new Date().toISOString() },
      payload: { text: "  " },
      meta: { eventId: "e2" },
    });
    expect(r.ok).toBe(false);
  });

  it("可注册 adapter 并读状态", () => {
    const adapter: ChannelAdapter = {
      channel: "qq",
      name: "mock",
      enabled: false,
      getStatus: () => ({ state: "disconnected" }),
      start: async () => {},
      stop: async () => {},
      reply: async () => {},
    };
    registerChannelAdapter(adapter);
    expect(adapter.getStatus().state).toBe("disconnected");
  });
});

describe("UnifiedMessage 形状", () => {
  it("信封字段齐全", () => {
    const msg: UnifiedMessage = {
      envelope: { channel: "qq", peerId: "u", chatId: "g", timestamp: "t" },
      payload: { text: "x" },
      meta: { eventId: "id", replyTo: "req" },
    };
    expect(msg.envelope.channel).toBe("qq");
  });
});
