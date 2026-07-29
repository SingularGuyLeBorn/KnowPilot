/**
 * 发送队列 drain：起流成功才 tombstone；失败回滚后 merge 可回潮。
 *
 * 负向（旧实现红）：先 claimUserQueueItem（tombstone）再起流，409/begin 拒后
 * unclaim 推 SSE → mergeUserQueueFromDb 被 tombstone 挡住 → 待发蒸发。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  mergeUserQueueFromDb,
  type ChatQueueItem,
  type SessionQueueItemRow,
} from "../chatQueueTypes";
import {
  sessionComposeActions,
  sessionComposeStore,
  __resetSessionComposeStoreForTests,
} from "../useSessionComposeState";

const SID = "sess-drain-rollback";

function row(partial: Partial<SessionQueueItemRow> & { id: string; content: string }): SessionQueueItemRow {
  return {
    kind: "user",
    source: "user",
    order: 0,
    createdAt: Date.now(),
    ...partial,
  };
}

function userItem(overrides: Partial<ChatQueueItem> & { id: string; dbId: string }): ChatQueueItem {
  return {
    kind: "user",
    text: "queued-msg",
    status: "pending",
    createdAt: Date.now(),
    source: "user",
    ...overrides,
  };
}

describe("queue drain claim / tombstone 契约", () => {
  beforeEach(() => {
    __resetSessionComposeStoreForTests();
  });

  it("负向：先 tombstone 再 unclaim → merge 仍被挡住（旧路径蒸发）", () => {
    const item = userItem({ id: "local-1", dbId: "db-1" });
    sessionComposeActions.enqueueUserQueueItem(SID, item);
    sessionComposeActions.claimUserQueueItem(SID, item);
    expect(sessionComposeStore.get(SID).userQueue).toEqual([]);
    expect(sessionComposeStore.get(SID).consumedQueueDbIds.has("db-1")).toBe(true);

    const merged = mergeUserQueueFromDb(
      sessionComposeStore.get(SID).userQueue,
      [row({ id: "db-1", content: "queued-msg" })],
      sessionComposeStore.get(SID).consumedQueueDbIds,
    );
    expect(merged).toEqual([]);
  });

  it("正路径：仅 detach 无 tombstone → unclaim 后 merge 回潮", () => {
    const item = userItem({ id: "local-2", dbId: "db-2" });
    sessionComposeActions.enqueueUserQueueItem(SID, item);
    sessionComposeActions.patchUserQueue(SID, (q) =>
      q.filter((i) => i.id !== item.id && i.dbId !== item.dbId),
    );
    expect(sessionComposeStore.get(SID).consumedQueueDbIds.has("db-2")).toBe(false);

    const merged = mergeUserQueueFromDb(
      sessionComposeStore.get(SID).userQueue,
      [row({ id: "db-2", content: "queued-msg" })],
      sessionComposeStore.get(SID).consumedQueueDbIds,
    );
    expect(merged.some((i) => i.dbId === "db-2")).toBe(true);
  });

  it("正路径：streamed 后才 tombstone，挡住迟到 list", () => {
    sessionComposeActions.markQueueDbIdConsumed(SID, "db-3");
    const merged = mergeUserQueueFromDb(
      [],
      [row({ id: "db-3", content: "queued-msg" })],
      sessionComposeStore.get(SID).consumedQueueDbIds,
    );
    expect(merged).toEqual([]);
  });
});
