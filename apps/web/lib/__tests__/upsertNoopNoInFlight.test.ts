/**
 * INV-4 前置不变量：no-op upsert 不得触发 in-flight assistant 登记。
 *
 * 刷新丢回复根因：regenerate 完成后推入 externalRing 的 message_upserted 在刷新时
 * 被 subscribeExternal 重放，该 upsert 在 MessageStore 中字段全等、reducer 为 no-op，
 * 但旧实现仍调 tryCommitAfterAssistant → markInFlightAssistant，使该组 stored 气泡被
 * 顶替成本轮 live 块。本测试覆盖该负向断言。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { sessionMessagesStore } from "../useSessionMessages";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";
import type { ChatMessage } from "@knowpilot/shared";

const SID = "sess-inv4-noop";

function assistantMsg(
  id: string,
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    sessionId: SID,
    role: "assistant",
    content,
    createdAt: new Date(),
    ...extra,
  } as ChatMessage;
}

describe("INV-4 no-op upsert 不得误标 in-flight", () => {
  beforeEach(() => {
    __resetStreamLifecycleStoreForTests();
    sessionMessagesStore.clearSession(SID);
  });

  it("流式中，重复 upsert 字段全等的已存在消息，in-flight 保持 null", () => {
    const msg = assistantMsg("m1", "hello");
    sessionMessagesStore.upsertMessage(SID, msg);
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "typing");

    expect(streamLifecycleStore.get(SID).phase).toBe("streaming");
    expect(streamLifecycleStore.get(SID).inFlightAssistantId).toBeNull();

    // 模拟 stale 重放：与 store 中完全相同的字段再次 upsert
    sessionMessagesStore.upsertMessage(SID, { ...msg });
    expect(streamLifecycleStore.get(SID).inFlightAssistantId).toBeNull();
  });

  it("流式中，新增（或真变更）的 assistant upsert 仍正常登记 in-flight", () => {
    streamLifecycleActions.beginStream(SID);
    expect(streamLifecycleStore.get(SID).phase).toBe("streaming");

    sessionMessagesStore.upsertMessage(SID, assistantMsg("m2", "hello"));
    expect(streamLifecycleStore.get(SID).inFlightAssistantId).toBe("m2");
  });
});
