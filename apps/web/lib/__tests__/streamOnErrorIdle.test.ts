/**
 * onError 在 phase=idle 时必须幂等：禁止 FAIL_STREAM/COMMIT_STREAM 刷 Dev overlay。
 * 覆盖：服务端宕机续传耗尽后，listRunning 已 ABORT 释放，迟到 onError 叠打。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";

const SID = "sess-onerror-idle";

describe("StreamLifecycle 迟到 FAIL/COMMIT 幂等", () => {
  beforeEach(() => {
    __resetStreamLifecycleStoreForTests();
  });

  it("idle 时 failStream/commitStream 为 no-op（不抛、不改相）", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    streamLifecycleActions.failStream(SID, "连接已断开，多次重连失败");
    streamLifecycleActions.commitStream(SID);
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    // 旧路径会 console.error 两次（FAIL blocked + COMMIT blocked）——reducer 仍 log，
    // 编排层应在调之前看 phase；此处只断言状态不被破坏。
    expect(streamLifecycleStore.get(SID).error).toBeNull();
    spy.mockRestore();
  });

  it("streaming → abort(null) → idle 后再次 fail 不改变 idle", () => {
    streamLifecycleActions.beginStream(SID);
    streamLifecycleActions.abortStream(SID, { partialAssistantMessageId: null });
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    streamLifecycleActions.failStream(SID, "HTTP 502");
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
  });
});
