/**
 * mergeUserQueueFromDb —— 发送队列 DB 幂等合并（修「只水合一次 / 空首包锁死」）
 */

import { describe, it, expect } from "vitest";
import {
  mergeUserQueueFromDb,
  sessionQueueItemToChatItem,
  type ChatQueueItem,
  type SessionQueueItemRow,
} from "../chatQueueTypes";

function row(partial: Partial<SessionQueueItemRow> & { id: string; content: string }): SessionQueueItemRow {
  return {
    kind: "superior",
    source: "parent-1",
    sourceName: "父Agent",
    order: 0,
    createdAt: Date.now(),
    ...partial,
  };
}

describe("mergeUserQueueFromDb", () => {
  it("DB 增项进入本地；已删除的 dbId 从本地消失", () => {
    const a = sessionQueueItemToChatItem(row({ id: "db-a", content: "A", order: 0 }));
    const b = sessionQueueItemToChatItem(row({ id: "db-b", content: "B", order: 10 }));
    const local: ChatQueueItem[] = [a, b];

    const merged = mergeUserQueueFromDb(local, [
      row({ id: "db-b", content: "B-updated", order: 0 }),
      row({ id: "db-c", content: "C", order: 10 }),
    ]);

    expect(merged.map((i) => i.dbId)).toEqual(["db-b", "db-c"]);
    expect(merged.find((i) => i.dbId === "db-b")?.text).toBe("B-updated");
    expect(merged.some((i) => i.dbId === "db-a")).toBe(false);
  });

  it("保留尚无 dbId 的本地乐观项", () => {
    const optimistic: ChatQueueItem = {
      id: "q-local",
      kind: "user",
      text: "刚发送",
      status: "pending",
      createdAt: Date.now(),
      source: "user",
    };
    const merged = mergeUserQueueFromDb(
      [optimistic],
      [row({ id: "db-1", content: "上级消息", kind: "superior" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].dbId).toBe("db-1");
    expect(merged[1].id).toBe("q-local");
    expect(merged[1].dbId).toBeUndefined();
  });

  it("空 DB 列表清空已持久化项（消费后 SSE 对齐）", () => {
    const a = sessionQueueItemToChatItem(row({ id: "db-a", content: "A" }));
    const merged = mergeUserQueueFromDb([a], []);
    expect(merged).toEqual([]);
  });

  it("E6：sessionChanged 快照先于 dbId 回填 → 本地项保留且可 patch", () => {
    // 模拟 NEW_STREAM_KEY 迁移后、createSessionQueueItem 尚未回填 dbId 的窗口
    const localPending: ChatQueueItem = {
      id: "q-migrated",
      kind: "user",
      text: "迁移来的排队",
      status: "pending",
      createdAt: Date.now(),
      source: "user",
    };
    // 旧实现 sessionChanged 会 setUserQueue(DB 全量) 抹掉 localPending
    const sessionChangedSnapshot = mergeUserQueueFromDb(
      [localPending],
      [row({ id: "db-sup", content: "上级指令", kind: "superior" })],
    );
    expect(sessionChangedSnapshot.find((i) => i.id === "q-migrated")).toBeDefined();
    expect(sessionChangedSnapshot.find((i) => i.id === "q-migrated")?.dbId).toBeUndefined();

    // 回填 patch：按本地 id 找得到项并写上 dbId
    const afterBackfill = sessionChangedSnapshot.map((i) =>
      i.id === "q-migrated" ? { ...i, dbId: "db-new" } : i,
    );
    expect(afterBackfill.find((i) => i.id === "q-migrated")?.dbId).toBe("db-new");
  });
});
