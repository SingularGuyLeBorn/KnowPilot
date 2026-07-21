/**
 * E5：hydrate 合并新鲜度 — stale 快照不得覆盖 SSE 已 upsert 的新内容
 *
 * 负向断言（旧实现红）：id 集合不同时整列以 incoming 为准 → v2 被回写 v1。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  sessionMessagesStore,
  __resetSessionMessageStoreForTests,
} from "../useSessionMessages";
import { __resetStreamLifecycleStoreForTests } from "../useStreamLifecycle";
import type { ChatMessage } from "@knowpilot/shared";

const SID = "sess-e5";

function msg(partial: Partial<ChatMessage> & { id: string; content: string }): ChatMessage {
  return {
    sessionId: SID,
    role: "assistant",
    toolCalls: null,
    toolResults: null,
    tokenUsage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  };
}

describe("E5 hydrate 新鲜度合并", () => {
  beforeEach(() => {
    __resetSessionMessageStoreForTests();
    __resetStreamLifecycleStoreForTests();
  });

  it("hydrate 快照旧、SSE 已 upsert 新 → 新内容不被回写", () => {
    // 先 hydrate 一页（含 user + 短 assistant）
    sessionMessagesStore.hydrateSessionMessages(
      SID,
      [
        msg({ id: "u1", role: "user", content: "问" }),
        msg({ id: "a1", content: "短" }),
      ],
      "view",
    );

    // SSE upsert 更长正文（v2）
    sessionMessagesStore.upsertAssistantFromDone(SID, {
      assistantMessageId: "a1",
      content: "短答已扩展为完整回复 v2",
    });
    expect(sessionMessagesStore.getMessages(SID).find((m) => m.id === "a1")?.content).toBe(
      "短答已扩展为完整回复 v2",
    );

    // 迟到的 stale hydrate：id 集合不同（多了 u2），但 a1 仍是旧短文
    sessionMessagesStore.hydrateSessionMessages(
      SID,
      [
        msg({ id: "u1", role: "user", content: "问" }),
        msg({ id: "a1", content: "短" }),
        msg({ id: "u2", role: "user", content: "追问" }),
      ],
      "view",
    );

    const list = sessionMessagesStore.getMessages(SID);
    expect(list.find((m) => m.id === "a1")?.content).toBe("短答已扩展为完整回复 v2");
    expect(list.some((m) => m.id === "u2")).toBe(true);
  });

  it("整列 id 相等且内容未变 → 快路径跳过（引用稳定）", () => {
    const items = [
      msg({ id: "u1", role: "user", content: "问" }),
      msg({ id: "a1", content: "答" }),
    ];
    sessionMessagesStore.hydrateSessionMessages(SID, items, "view");
    const before = sessionMessagesStore.getMessages(SID);

    sessionMessagesStore.hydrateSessionMessages(
      SID,
      [
        msg({ id: "u1", role: "user", content: "问" }),
        msg({ id: "a1", content: "答" }),
      ],
      "view",
    );
    expect(sessionMessagesStore.getMessages(SID)).toBe(before);
  });
});
