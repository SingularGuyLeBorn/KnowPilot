/**
 * INV-Send：空闲直发不得闪可见「待发」；占用必须可见排队。
 * 负向：旧实现「一律 enqueue 可见」时 idle 可见计数会 >0。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  countVisibleQueueItems,
  createUserQueueItem,
  filterVisibleQueueItems,
  type ChatQueueItem,
} from "../chatQueueTypes";
import {
  sessionComposeActions,
  sessionComposeStore,
  __resetSessionComposeStoreForTests,
} from "../useSessionComposeState";

const SID = "sess-inv-send";

/** 复刻 useChatEnqueue 的 visibility 分流（纯函数，便于单测） */
function decideEnqueueVisibility(opts: {
  occupied: boolean;
  draining: boolean;
  userQueue: ChatQueueItem[];
}): "visible" | "dispatching" {
  const hasVisiblePending = opts.userQueue.some((i) => i.visibility !== "dispatching");
  return opts.occupied || opts.draining || hasVisiblePending ? "visible" : "dispatching";
}

describe("INV-Send enqueue visibility", () => {
  beforeEach(() => {
    __resetSessionComposeStoreForTests();
  });

  it("空闲且队空：visibility=dispatching，可见队列长度为 0", () => {
    const visibility = decideEnqueueVisibility({
      occupied: false,
      draining: false,
      userQueue: [],
    });
    expect(visibility).toBe("dispatching");

    const item = createUserQueueItem("hello", { visibility });
    sessionComposeActions.enqueueUserQueueItem(SID, item);
    const q = sessionComposeStore.get(SID).userQueue;
    expect(countVisibleQueueItems(q)).toBe(0);
    expect(filterVisibleQueueItems(q)).toHaveLength(0);
    expect(q).toHaveLength(1);
    expect(q[0]!.visibility).toBe("dispatching");
  });

  it("占用中：visibility=visible，可见队列长度 >= 1", () => {
    const visibility = decideEnqueueVisibility({
      occupied: true,
      draining: false,
      userQueue: [],
    });
    expect(visibility).toBe("visible");

    const item = createUserQueueItem("queued", { visibility });
    sessionComposeActions.enqueueUserQueueItem(SID, item);
    const q = sessionComposeStore.get(SID).userQueue;
    expect(countVisibleQueueItems(q)).toBe(1);
    expect(filterVisibleQueueItems(q)[0]!.text).toBe("queued");
  });

  it("已有可见待发时后续条目也必须 visible（FIFO 排队可见）", () => {
    sessionComposeActions.enqueueUserQueueItem(
      SID,
      createUserQueueItem("first", { visibility: "visible" }),
    );
    const visibility = decideEnqueueVisibility({
      occupied: false,
      draining: false,
      userQueue: sessionComposeStore.get(SID).userQueue,
    });
    expect(visibility).toBe("visible");
  });

  it("draining 中新消息为 visible（避免 drain 间隙闪灭后丢可见态）", () => {
    const visibility = decideEnqueueVisibility({
      occupied: false,
      draining: true,
      userQueue: [],
    });
    expect(visibility).toBe("visible");
  });
});
