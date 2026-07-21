/**
 * 软暂停：半截回复必须先入 MessageStore，再拆 live——否则 commit 后气泡变空。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  localAbortedAssistantId,
  sessionMessagesStore,
} from "@/lib/useSessionMessages";
import { streamLifecycleActions, streamLifecycleStore } from "@/lib/useStreamLifecycle";

describe("localAbortedAssistant 软暂停占位", () => {
  const sid = "sess-soft-pause-test";

  beforeEach(() => {
    sessionMessagesStore.clearSession(sid);
    streamLifecycleActions.resetSession(sid);
  });

  it("upsertLocalAbortedAssistant 写入 finishReason=aborted 且可与 completeStream 对齐 commit", () => {
    streamLifecycleActions.beginStream(sid, {});
    streamLifecycleActions.appendTokenDelta(sid, "半截回复到这里");
    streamLifecycleActions.completeStream(sid, "半截回复到这里");

    const id = sessionMessagesStore.upsertLocalAbortedAssistant(sid, "半截回复到这里");
    expect(id).toBe(localAbortedAssistantId(sid));

    const msgs = sessionMessagesStore.getMessages(sid);
    const aborted = msgs.find((m) => m.id === id);
    expect(aborted?.content).toBe("半截回复到这里");
    expect(aborted?.finishReason).toBe("aborted");

    // upsert 应已 tryCommit → idle；若仍 done 则显式 commit 后也应 idle 且正文仍在 store
    if (streamLifecycleStore.get(sid).phase === "done") {
      streamLifecycleActions.commitStream(sid);
    }
    expect(streamLifecycleStore.get(sid).phase).toBe("idle");
    expect(streamLifecycleStore.get(sid).streamingContent).toBe("");
    expect(sessionMessagesStore.getMessages(sid).some((m) => m.content === "半截回复到这里")).toBe(
      true,
    );
  });

  it("服务端同文案 assistant 到达后摘掉本地占位", () => {
    sessionMessagesStore.upsertLocalAbortedAssistant(sid, "同一段半截");
    sessionMessagesStore.upsertAssistantFromDone(sid, {
      assistantMessageId: "server-msg-1",
      content: "同一段半截",
      finishReason: "aborted",
    });
    const msgs = sessionMessagesStore.getMessages(sid);
    expect(msgs.some((m) => m.id === localAbortedAssistantId(sid))).toBe(false);
    expect(msgs.some((m) => m.id === "server-msg-1" && m.finishReason === "aborted")).toBe(true);
  });
});
