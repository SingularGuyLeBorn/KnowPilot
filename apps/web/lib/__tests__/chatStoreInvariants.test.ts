/**
 * Chat 三层 Store 核心不变量锁定（会红即破 INV）。
 *
 * INV-2：occupied 拒二次 beginStream
 * INV-4：done 前 message_upserted → inFlight
 * INV-1：对齐后 commit → idle
 * INV-7 相关：hydrate view 可对齐 done 收口
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  sessionMessagesStore,
  __resetSessionMessageStoreForTests,
} from "../useSessionMessages";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";
import type { ChatMessage } from "@knowpilot/shared";

const SID = "sess-inv-lock";
const SID_B = "sess-inv-lock-b";

function assistant(id: string, content: string, sessionId = SID): ChatMessage {
  return {
    id,
    sessionId,
    role: "assistant",
    content,
    toolCalls: null,
    toolResults: null,
    tokenUsage: null,
    createdAt: new Date(),
  } as ChatMessage;
}

describe("Chat store invariants lock", () => {
  beforeEach(() => {
    __resetStreamLifecycleStoreForTests();
    __resetSessionMessageStoreForTests();
  });

  it("INV-2：streaming 时二次 beginStream 返回 false，不清空过渡内容", () => {
    expect(streamLifecycleActions.beginStream(SID)).toBe(true);
    streamLifecycleActions.appendTokenDelta(SID, "hello");
    expect(streamLifecycleStore.get(SID).phase).toBe("streaming");
    expect(streamLifecycleStore.get(SID).streamingContent).toContain("hello");

    expect(streamLifecycleActions.beginStream(SID)).toBe(false);
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(true);
    expect(streamLifecycleStore.get(SID).streamingContent).toContain("hello");
  });

  it("INV-2：done 相位仍 occupied，二次 beginStream 拒绝", () => {
    expect(streamLifecycleActions.beginStream(SID)).toBe(true);
    streamLifecycleActions.completeStream(SID, "final", { assistantMessageId: "a1" });
    expect(streamLifecycleStore.get(SID).phase).toBe("done");
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(true);

    expect(streamLifecycleActions.beginStream(SID)).toBe(false);
    expect(streamLifecycleStore.get(SID).phase).toBe("done");
  });

  it("INV-4：streaming 中 message_upserted 登记 inFlight，且尚未 commit", () => {
    expect(streamLifecycleActions.beginStream(SID)).toBe(true);
    sessionMessagesStore.upsertMessage(SID, assistant("a-early", "partial from db"));

    expect(streamLifecycleStore.get(SID).inFlightAssistantId).toBe("a-early");
    expect(streamLifecycleStore.get(SID).phase).toBe("streaming");
    expect(streamLifecycleActions.tryCommitStream(SID, { messageId: "a-early" })).toBe(false);
  });

  it("INV-1：complete + upsert 对齐后自动 commit 到 idle", () => {
    expect(streamLifecycleActions.beginStream(SID)).toBe(true);
    streamLifecycleActions.completeStream(SID, "answer body", { assistantMessageId: "a1" });
    expect(streamLifecycleStore.get(SID).phase).toBe("done");

    sessionMessagesStore.upsertMessage(SID, assistant("a1", "answer body"));

    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    expect(streamLifecycleStore.get(SID).inFlightAssistantId).toBeNull();
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(false);
  });

  it("hydrate view：done 待对齐时对账可收口到 idle（切回话路径）", () => {
    expect(streamLifecycleActions.beginStream(SID)).toBe(true);
    streamLifecycleActions.completeStream(SID, "from hydrate", { assistantMessageId: "a-hyd" });
    expect(streamLifecycleStore.get(SID).phase).toBe("done");

    // 模拟切回话后静默对账拉到已落库 assistant
    sessionMessagesStore.hydrateSessionMessages(
      SID,
      [assistant("a-hyd", "from hydrate")],
      "view",
    );

    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(false);
  });

  it("多会话隔离：A streaming 时 B beginStream 不受影响", () => {
    expect(streamLifecycleActions.beginStream(SID)).toBe(true);
    streamLifecycleActions.appendTokenDelta(SID, "A");
    expect(streamLifecycleActions.beginStream(SID_B)).toBe(true);
    streamLifecycleActions.appendTokenDelta(SID_B, "B");

    expect(streamLifecycleStore.get(SID).streamingContent).toContain("A");
    expect(streamLifecycleStore.get(SID_B).streamingContent).toContain("B");
    expect(streamLifecycleActions.beginStream(SID)).toBe(false);
    expect(streamLifecycleActions.beginStream(SID_B)).toBe(false);
  });
});
