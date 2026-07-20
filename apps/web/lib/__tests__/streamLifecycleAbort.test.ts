/**
 * E2：INV-1 收进 reducer — COMMIT_STREAM 相位守卫 + ABORT_STREAM
 *
 * 负向断言（旧实现红）：
 * - streaming 相位 COMMIT_STREAM → 状态被清成 idle（非法直跳）
 * - 无 ABORT_STREAM，强制释放只能靠 commitStream 绕过 INV-1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";

const SID = "sess-e2";

describe("E2 StreamLifecycle COMMIT / ABORT", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetStreamLifecycleStoreForTests();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("streaming 相位 COMMIT_STREAM → 状态不变 + dev 报错", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "hello");
    expect(streamLifecycleStore.get(SID).phase).toBe("streaming");
    expect(streamLifecycleStore.get(SID).streamingContent).toBe("hello");

    streamLifecycleActions.commitStream(SID);

    const st = streamLifecycleStore.get(SID);
    expect(st.phase).toBe("streaming");
    expect(st.streamingContent).toBe("hello");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("ABORT_STREAM(null) 从 streaming 释放占用并清空 leftover", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "partial");
    streamLifecycleActions.abortStream(SID, {
      partialAssistantMessageId: null,
      leftoverContent: "partial",
    });

    const st = streamLifecycleStore.get(SID);
    expect(st.phase).toBe("idle");
    expect(st.streamingContent).toBe("");
    expect(st.liveTimeline).toEqual([]);
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(false);
  });

  it("ABORT_STREAM(id) 进入 done 等待对齐，不立即 idle", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "partial-text");
    streamLifecycleActions.abortStream(SID, {
      partialAssistantMessageId: "msg-partial-1",
      leftoverContent: "partial-text",
    });

    const st = streamLifecycleStore.get(SID);
    expect(st.phase).toBe("done");
    expect(st.pendingAssistantMessageId).toBe("msg-partial-1");
    expect(st.streamingContent).toBe("partial-text");
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(true);

    // 对齐后可 COMMIT
    expect(
      streamLifecycleActions.tryCommitStream(SID, {
        messageId: "msg-partial-1",
        content: "partial-text",
      }),
    ).toBe(true);
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
  });

  it("idle 收到 stale COMPLETE_STREAM / FAIL_STREAM 为 no-op", () => {
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    streamLifecycleActions.completeStream(SID, "stale");
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    streamLifecycleActions.failStream(SID, "stale error");
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    expect(streamLifecycleStore.get(SID).error).toBeNull();
  });

  it("done 相位允许 COMMIT_STREAM", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.completeStream(SID, "done-text", {
      assistantMessageId: null,
    });
    expect(streamLifecycleStore.get(SID).phase).toBe("done");
    streamLifecycleActions.commitStream(SID);
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
  });
});
