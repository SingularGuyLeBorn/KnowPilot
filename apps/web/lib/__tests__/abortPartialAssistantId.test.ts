/**
 * E3：abort 用 stopAgentChat 的 partialAssistantMessageId，无 setTimeout(2000)
 *
 * 负向断言（旧实现红）：
 * - 无 partial id 契约时靠 2s 强制 commit → 慢于 2s 落库会闪断
 * - 有 id 时对齐前被计时器拆掉 live 块
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

    // 旧实现会在 2s 强制 commit；新实现无计时器，推进时间仍保持 done
    vi.advanceTimersByTime(2500);
    expect(streamLifecycleStore.get(SID).phase).toBe("done");
    expect(streamLifecycleStore.get(SID).streamingContent).toBe("partial-text");

    // 迟到 upsert 对齐 → commit，气泡不闪断（live 一直撑到对齐）
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

  it("useChatRunStream abort 路径无 setTimeout(2000) 兜底", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "../useChatRunStream.ts"), "utf8");
    expect(src).not.toMatch(/setTimeout\s*\(\s*[^)]*2000\s*\)/);
    expect(src).toMatch(/takePendingAbortPartial/);
    expect(src).toMatch(/abortStream/);
  });
});
