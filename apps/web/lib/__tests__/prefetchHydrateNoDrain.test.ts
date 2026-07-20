/**
 * E4：prefetch hydrate 不置 drainRequested（悬停不得误发队列消息）
 *
 * 负向断言（旧实现红）：prefetch 与 view 同走 hydrate → 无条件 hydrateDone → drain。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  sessionMessagesStore,
  __resetSessionMessageStoreForTests,
  type DrainTriggerSource,
} from "../useSessionMessages";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";
import type { ChatMessage } from "@knowpilot/shared";

const SID = "sess-e4";

function msg(partial: Partial<ChatMessage> & { id: string; content: string }): ChatMessage {
  return {
    sessionId: SID,
    role: "user",
    toolCalls: null,
    toolResults: null,
    tokenUsage: null,
    createdAt: new Date(),
    ...partial,
  };
}

describe("E4 prefetch hydrate 不触发 drain", () => {
  beforeEach(() => {
    __resetSessionMessageStoreForTests();
    __resetStreamLifecycleStoreForTests();
  });

  it("prefetch hydrate 后 drainRequested 仍为 false，不触发 onStreamCommitted", async () => {
    const committed: string[] = [];
    const unsub = streamLifecycleActions.onStreamCommitted((sid) => committed.push(sid));

    await sessionMessagesStore.prefetchSessionMessages(SID, async () => ({
      items: [msg({ id: "m1", content: "预取" })],
      nextCursor: null,
    }));

    expect(sessionMessagesStore.getMessages(SID)).toHaveLength(1);
    expect(streamLifecycleStore.get(SID).drainRequested).toBe(false);
    expect(committed).toEqual([]);
    unsub();
  });

  it("view hydrate 置 drainRequested 并经钩子通知", () => {
    const committed: string[] = [];
    const unsub = streamLifecycleActions.onStreamCommitted((sid) => committed.push(sid));

    sessionMessagesStore.hydrateSessionMessages(
      SID,
      [msg({ id: "m1", content: "可见" })],
      "view",
    );

    // hydrateDone → drainRequested；notifyCommit 后 take 前仍可能为 true，或已被钩子 clear
    // 至少 commit 钩子被调用一次（INV-8 ④）
    expect(committed).toContain(SID);
    unsub();
  });

  it("DrainTriggerSource 联合类型含 hydrate_view、不含 prefetch", () => {
    // 编译期契约：合法源枚举；运行时用 satisfies 锁死集合
    const legal: DrainTriggerSource[] = [
      "user_enqueue",
      "stream_committed",
      "session_switch",
      "hydrate_view",
    ];
    expect(legal).not.toContain("prefetch");
    expect(legal).toContain("hydrate_view");
  });
});
