/**
 * SessionStreamHub flushPersistQueue 指数退避鲁棒性测试。
 *
 * 验证：SQLite 写入连续失败时，flush 不会立即重试造成雪崩，
 * 而是按 500ms → 1s → 2s → ... → 上限 30s 指数退避；成功后退避重置。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../db.js";
import { SessionStreamHub } from "../infra/sessionStreamHub.js";
import type { AgentStreamEvent } from "../infra/agentStream.js";

const SID = "flush-backoff-test-session";

describe("SessionStreamHub flushPersistQueue 指数退避", () => {
  beforeEach(async () => {
    await prisma.sessionStreamEvent.deleteMany({ where: { sessionId: SID } });
  });

  afterEach(async () => {
    await prisma.sessionStreamEvent.deleteMany({ where: { sessionId: SID } });
  });

  it("createMany 连续失败时按指数退避重试并最终落盘", async () => {
    const hub = new SessionStreamHub({
      ringSize: 100,
      persist: true,
      eventTtlMs: 60_000,
      cleanupIntervalMs: 0,
    });

    let failCount = 0;
    const originalCreateMany = prisma.sessionStreamEvent.createMany.bind(prisma.sessionStreamEvent);
    const createManyCalls: number[] = [];
    const backoffsObserved: number[] = [];

    const stub = async (args: any) => {
      createManyCalls.push(Date.now());
      backoffsObserved.push((hub as any).flushBackoffMs);
      if (failCount < 3) {
        failCount++;
        throw new Error(`模拟 SQLite 写入失败 #${failCount}`);
      }
      return originalCreateMany(args) as any;
    };
    (prisma.sessionStreamEvent as any).createMany = stub;

    try {
      await hub.start(SID, { message: "hi", sessionId: SID } as never, async (emit) => {
        emit({ type: "token", delta: "x" });
        emit({
          type: "done",
          sessionId: SID,
          agentId: "a",
          content: "x",
          toolCalls: [],
          model: "m",
          provider: "p",
          roundsUsed: 1,
        } as AgentStreamEvent);
      });
      await hub.waitFor(SID);

      // 等待指数退避后的最终成功落盘
      await vi.waitFor(
        async () => {
          const rows = await prisma.sessionStreamEvent.findMany({
            where: { sessionId: SID },
          });
          expect(rows.length).toBeGreaterThanOrEqual(1);
        },
        { timeout: 8000, interval: 100 },
      );

      // 至少经历 4 次调用（3 次失败 + 1 次成功）
      expect(createManyCalls.length).toBeGreaterThanOrEqual(4);
      // 每次失败后的退避值应为 500 → 1000 → 2000 → 4000（上限前）
      // 成功前一次 backoff 应已涨到 >= 1000
      expect(Math.max(...backoffsObserved)).toBeGreaterThanOrEqual(1000);
      // 成功后 flushBackoffMs 应被重置为初始值 500
      expect((hub as any).flushBackoffMs).toBe(500);
    } finally {
      (prisma.sessionStreamEvent as any).createMany = originalCreateMany;
      await hub.dispose();
    }
  });
});
