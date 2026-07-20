/**
 * E1：ACK 瞬态失败不得永久 skip 异步投递
 *
 * 负向断言（旧实现红）：mark 在 ACK 之前 → reject 后标记仍在 → merge 永久 skip。
 * 新实现：claimed:true 之后才 mark；reject / not_claimed 均不标记，delivery 可再出现。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ackThenMarkDelivery,
} from "../useChatQueueDrain";
import {
  sessionComposeActions,
  sessionComposeStore,
  __resetSessionComposeStoreForTests,
} from "../useSessionComposeState";
import { mergeAsyncPollIntoQueue } from "../chatQueueTypes";

const SID = "sess-e1";
const JOB = "job-e1";

describe("E1 ackThenMarkDelivery", () => {
  beforeEach(() => {
    __resetSessionComposeStoreForTests();
  });

  it("ACK reject 后标记未持久化，merge 后 delivery 可再出现", async () => {
    const ackFn = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(ackThenMarkDelivery(SID, JOB, ackFn)).rejects.toThrow("network down");

    expect(sessionComposeStore.get(SID).consumedDeliveries.has(JOB)).toBe(false);

    const merged = mergeAsyncPollIntoQueue(
      [],
      {
        deliveries: [
          {
            id: "del-1",
            jobId: JOB,
            taskLabel: "子任务",
            asyncResult: "结果正文",
            status: "done" as const,
            createdAt: Date.now(),
          },
        ],
      },
      { skipDeliveryJobIds: sessionComposeStore.get(SID).consumedDeliveries },
    );

    expect(merged.some((i) => i.jobId === JOB && i.kind === "async-result")).toBe(true);
  });

  it("ACK not_claimed 不 mark，delivery 可再 claim", async () => {
    const ackFn = vi.fn().mockResolvedValue({ claimed: false });

    const result = await ackThenMarkDelivery(SID, JOB, ackFn);
    expect(result).toBe("not_claimed");
    expect(sessionComposeStore.get(SID).consumedDeliveries.has(JOB)).toBe(false);

    // 再次 claim 成功
    ackFn.mockResolvedValueOnce({ claimed: true });
    const second = await ackThenMarkDelivery(SID, JOB, ackFn);
    expect(second).toBe("claimed");
    expect(sessionComposeStore.get(SID).consumedDeliveries.has(JOB)).toBe(true);
  });

  it("claimed:true 之后才 mark", async () => {
    const order: string[] = [];
    const ackFn = vi.fn().mockImplementation(async () => {
      order.push("ack");
      expect(sessionComposeStore.get(SID).consumedDeliveries.has(JOB)).toBe(false);
      return { claimed: true };
    });

    await ackThenMarkDelivery(SID, JOB, ackFn);
    order.push("marked");
    expect(sessionComposeStore.get(SID).consumedDeliveries.has(JOB)).toBe(true);
    expect(order).toEqual(["ack", "marked"]);
  });

  it("unmarkDeliveryConsumed 可回滚误 mark", () => {
    sessionComposeActions.markDeliveryConsumed(SID, JOB);
    expect(sessionComposeStore.get(SID).consumedDeliveries.has(JOB)).toBe(true);
    sessionComposeActions.unmarkDeliveryConsumed(SID, JOB);
    expect(sessionComposeStore.get(SID).consumedDeliveries.has(JOB)).toBe(false);
  });
});
