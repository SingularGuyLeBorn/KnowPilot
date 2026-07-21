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
});
