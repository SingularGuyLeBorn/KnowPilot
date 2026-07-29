/**
 * StreamLifecycle：done 超时强制 commit + resolveResumeAfter（INV-5）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  DONE_COMMIT_TIMEOUT_MS,
} from "../useStreamLifecycle";

describe("StreamLifecycle done watchdog / resumeAfter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    streamLifecycleActions.deleteSession("wd-1");
    streamLifecycleActions.deleteSession("ra-1");
  });

  it("done 超时未对齐 MessageStore → 强制 commit 释放占用", () => {
    const sid = "wd-1";
    streamLifecycleActions.beginStream(sid, {});
    streamLifecycleActions.completeStream(sid, "终稿", { assistantMessageId: "msg-missing" });
    expect(streamLifecycleStore.get(sid).phase).toBe("done");
    expect(streamLifecycleStore.isRunOccupied(sid)).toBe(true);

    vi.advanceTimersByTime(DONE_COMMIT_TIMEOUT_MS + 50);
    expect(streamLifecycleStore.get(sid).phase).toBe("idle");
    expect(streamLifecycleStore.isRunOccupied(sid)).toBe(false);
  });

  it("resolveResumeAfter：无本地进度 → 0；有 lastEventId → 接尾巴", () => {
    const sid = "ra-1";
    expect(streamLifecycleStore.resolveResumeAfter(sid)).toBe(0);

    streamLifecycleActions.beginStream(sid, { resume: true });
    streamLifecycleActions.setLastEventId(sid, 42);
    expect(streamLifecycleStore.resolveResumeAfter(sid)).toBe(42);
  });

  it("RESUME_CLAIM：并发 resume beginStream 第二次拒绝", () => {
    const sid = "wd-1";
    expect(streamLifecycleActions.beginStream(sid, { resume: true })).toBe(true);
    expect(streamLifecycleActions.beginStream(sid, { resume: true })).toBe(false);
  });

  it("RESTORE_STREAM_SNAPSHOT 不占 RESUME_CLAIM：随后 beginStream(resume) 必须成功", () => {
    const sid = "wd-1";
    streamLifecycleActions.restoreStreamSnapshot(sid, {
      streamingContent: "半截",
      liveTimeline: [{ type: "thinking", content: "想…", round: 1 }],
      lastEventId: 17,
      streamTargetUserId: "u1",
    });
    const restored = streamLifecycleStore.get(sid);
    expect(restored.phase).toBe("streaming");
    expect(restored.resumeClaimed).toBe(false);
    expect(restored.connected).toBe(false);
    expect(restored.lastEventId).toBe(17);
    expect(restored.streamingContent).toBe("半截");

    // 负向：旧 mount 先 beginStream(resume) 再 runStream 会把这里拒掉 → 幽灵 streaming
    expect(streamLifecycleActions.beginStream(sid, { resume: true })).toBe(true);
    expect(streamLifecycleStore.get(sid).resumeClaimed).toBe(true);
    expect(streamLifecycleStore.get(sid).connected).toBe(true);
    expect(streamLifecycleStore.get(sid).streamingContent).toBe("半截");
    expect(streamLifecycleStore.resolveResumeAfter(sid)).toBe(17);

    // claim 后第二次仍拒
    expect(streamLifecycleActions.beginStream(sid, { resume: true })).toBe(false);
  });
});
