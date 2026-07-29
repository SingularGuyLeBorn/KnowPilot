/**
 * INV-4 live 所有权：幽灵 RESTORE（streaming + !connected + 无载荷）不得盖住 stored assistant。
 */

import { describe, it, expect } from "vitest";

/** 与 chatMessageList 渲染条件同构（抽出便于负向断言） */
function ownsLiveRender(opts: {
  isStreaming: boolean;
  streamConnected: boolean;
  streamTargetUserId: string | null;
  userMessageId: string;
  hasLivePayload: boolean;
  inFlightAssistantId: string | null;
  assistantMessageId: string | null;
}): boolean {
  const asTarget =
    opts.isStreaming &&
    opts.streamTargetUserId === opts.userMessageId &&
    (opts.streamConnected || opts.hasLivePayload);
  const asInFlight =
    !!opts.assistantMessageId && opts.assistantMessageId === opts.inFlightAssistantId;
  return asTarget || asInFlight;
}

describe("live stream ownership", () => {
  it("负向：RESTORE 幽灵 streaming 无载荷 → 不抢 stored", () => {
    expect(
      ownsLiveRender({
        isStreaming: true,
        streamConnected: false,
        streamTargetUserId: "u1",
        userMessageId: "u1",
        hasLivePayload: false,
        inFlightAssistantId: null,
        assistantMessageId: "a1",
      }),
    ).toBe(false);
  });

  it("正路径：SSE 已接通 → 可显示空 Thinking", () => {
    expect(
      ownsLiveRender({
        isStreaming: true,
        streamConnected: true,
        streamTargetUserId: "u1",
        userMessageId: "u1",
        hasLivePayload: false,
        inFlightAssistantId: null,
        assistantMessageId: "a1",
      }),
    ).toBe(true);
  });

  it("正路径：未接通但有恢复的 streamingContent → 显示 live", () => {
    expect(
      ownsLiveRender({
        isStreaming: true,
        streamConnected: false,
        streamTargetUserId: "u1",
        userMessageId: "u1",
        hasLivePayload: true,
        inFlightAssistantId: null,
        assistantMessageId: "a1",
      }),
    ).toBe(true);
  });
});
