/**
 * E3 / P2-4：abort 用 partialAssistantMessageId 对齐；有 id 时禁止靠 hydrate/计时器进 idle。
 *
 * 行为不变量（删掉编排层 hydrate 补丁仍成立）：
 * - abortStream(partialId) → phase=done，推进时间仍 done
 * - HYDRATE_DONE 不能把 done 变成 idle
 * - 仅 tryCommitStream(同 id) 才能 idle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";

const SID = "sess-e3";

describe("E3 abort partialAssistantMessageId（无计时器）", () => {
  beforeEach(() => {
    __resetStreamLifecycleStoreForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("有 partial id：对齐前不 idle；推进 2s+ 仍等待；upsert 对齐后 commit", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "partial-text");
    streamLifecycleActions.setPendingAbortPartial(SID, "msg-partial-e3");
    const partialId = streamLifecycleActions.takePendingAbortPartial(SID);
    expect(partialId).toBe("msg-partial-e3");

    streamLifecycleActions.abortStream(SID, {
      partialAssistantMessageId: partialId!,
      leftoverContent: "partial-text",
    });
    expect(streamLifecycleStore.get(SID).phase).toBe("done");
    expect(streamLifecycleStore.get(SID).pendingAssistantMessageId).toBe("msg-partial-e3");

    vi.advanceTimersByTime(1000);
    expect(streamLifecycleStore.get(SID).phase).toBe("done");
    expect(streamLifecycleStore.get(SID).streamingContent).toBe("partial-text");

    expect(
      streamLifecycleActions.tryCommitStream(SID, {
        messageId: "msg-partial-e3",
        content: "partial-text",
      }),
    ).toBe(true);
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    expect(streamLifecycleStore.get(SID).streamingContent).toBe("");
  });

  it("null id（明确无 partial）立即 commit 到 idle", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "x");
    streamLifecycleActions.setPendingAbortPartial(SID, null);
    const partialId = streamLifecycleActions.takePendingAbortPartial(SID);
    expect(partialId).toBeNull();

    streamLifecycleActions.abortStream(SID, {
      partialAssistantMessageId: null,
      leftoverContent: "x",
    });
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(false);
  });

  it("P2-4：abort 有 partialId 后 HYDRATE_DONE 不能释放占用（禁 hydrate 赌落库）", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.appendTokenDelta(SID, "half");
    streamLifecycleActions.abortStream(SID, {
      partialAssistantMessageId: "msg-p24",
      leftoverContent: "half",
    });
    expect(streamLifecycleStore.get(SID).phase).toBe("done");

    streamLifecycleActions.hydrateDone(SID);
    expect(streamLifecycleStore.get(SID).phase).toBe("done");
    expect(streamLifecycleStore.get(SID).pendingAssistantMessageId).toBe("msg-p24");
    expect(streamLifecycleStore.isRunOccupied(SID)).toBe(true);

    expect(
      streamLifecycleActions.tryCommitStream(SID, {
        messageId: "msg-p24",
        content: "half",
      }),
    ).toBe(true);
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
  });
});
