/**
 * MessageStore upsert field-level merge：补发空/undefined toolResults 不得抹掉已有时间线
 */
import { describe, it, expect, beforeEach } from "vitest";
import { sessionMessagesStore } from "../useSessionMessages";
import type { ChatMessage } from "@knowpilot/shared";

describe("MessageStore upsert merge", () => {
  const sid = "merge-sess-1";

  beforeEach(() => {
    sessionMessagesStore.clearSession(sid);
  });

  it("后到的 toolResults=undefined 保留先前 versionMeta", () => {
    const toolResults = {
      versionMeta: {
        activeIndex: 0,
        versions: [{ content: "hello", toolCalls: [] as never[] }],
      },
    };
    const withTimeline = {
      id: "m1",
      sessionId: sid,
      role: "assistant" as const,
      content: "hello",
      toolCalls: [{ id: "t1", name: "x", arguments: {} }],
      toolResults,
      createdAt: new Date(),
    } as ChatMessage;

    sessionMessagesStore.upsertMessage(sid, withTimeline);

    // 模拟 agentStream 补发：content 更新但未带 toolResults
    sessionMessagesStore.upsertMessage(sid, {
      id: "m1",
      sessionId: sid,
      role: "assistant",
      content: "hello world",
      createdAt: withTimeline.createdAt,
    } as ChatMessage);

    const msg = sessionMessagesStore.getMessages(sid).find((m) => m.id === "m1");
    expect(msg?.content).toBe("hello world");
    expect(msg?.toolResults).toEqual(toolResults);
    expect(msg?.toolCalls).toEqual(withTimeline.toolCalls);
  });

  it("显式 toolResults=null 允许清空（与 undefined 区分）", () => {
    sessionMessagesStore.upsertMessage(sid, {
      id: "m2",
      sessionId: sid,
      role: "assistant",
      content: "x",
      toolResults: { versionMeta: { activeIndex: 0, versions: [] } },
      createdAt: new Date(),
    } as ChatMessage);

    sessionMessagesStore.upsertMessage(sid, {
      id: "m2",
      sessionId: sid,
      role: "assistant",
      content: "x",
      toolResults: null,
      createdAt: new Date(),
    } as ChatMessage);

    const msg = sessionMessagesStore.getMessages(sid).find((m) => m.id === "m2");
    expect(msg?.toolResults).toBeNull();
  });
});
