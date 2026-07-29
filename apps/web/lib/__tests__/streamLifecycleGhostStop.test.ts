/**
 * 幽灵 streaming Stop 不变量：
 * phase=streaming 且无 AbortController 时，applyUserStop 必须直接 ABORT_STREAM 释放占用。
 * 负向（旧实现红）：只 ?.abort() → no-op，Thinking/队列永久卡住。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";

const SID = "sess-ghost-stop";

describe("幽灵 streaming applyUserStop", () => {
  beforeEach(() => {
    __resetStreamLifecycleStoreForTests();
  });

  it("无 AC：applyUserStop(null) → 立即 idle（Stop 可点）", () => {
    streamLifecycleActions.restoreStreamSnapshot(SID, {
      streamingContent: "半截回复",
      liveTimeline: [{ type: "thinking", content: "还在想", round: 1 }],
      lastEventId: 9,
    });
    expect(streamLifecycleStore.isStreaming(SID)).toBe(true);

    const path = streamLifecycleActions.applyUserStop(SID, {
      partialAssistantMessageId: null,
      abortController: null,
    });
    expect(path).toBe("lifecycle");
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(false);
    expect(streamLifecycleStore.get(SID).liveTimeline).toEqual([]);
  });

  it("有活 AC：applyUserStop → abort controller，留给 AbortError 路径", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "x");
    const ac = new AbortController();
    const path = streamLifecycleActions.applyUserStop(SID, {
      partialAssistantMessageId: "msg-partial",
      abortController: ac,
    });
    expect(path).toBe("controller");
    expect(ac.signal.aborted).toBe(true);
    // 生命周期仍由 AbortError 路径 abortStream；此处尚未释放
    expect(streamLifecycleStore.get(SID).phase).toBe("streaming");
    expect(streamLifecycleActions.takePendingAbortPartial(SID)).toBe("msg-partial");
  });

  it("已 aborted 的 AC 视为无 AC → lifecycle 释放", () => {
    streamLifecycleActions.restoreStreamSnapshot(SID, {
      streamingContent: "stale",
      lastEventId: 1,
    });
    const ac = new AbortController();
    ac.abort();
    const path = streamLifecycleActions.applyUserStop(SID, {
      partialAssistantMessageId: null,
      abortController: ac,
    });
    expect(path).toBe("lifecycle");
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
  });
});
