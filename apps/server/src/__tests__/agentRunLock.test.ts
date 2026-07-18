/**
 * Agent prepare 互斥锁：local 串行 + Redis SET NX（内存假客户端）。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  __createLocalAgentRunLockForTests,
  __createRedisAgentRunLockForTests,
  __resetAgentRunLockForTests,
} from "../infra/agentRunLock.js";
import { __setRedisClientForTests } from "../infra/redisClient.js";

afterEach(() => {
  __resetAgentRunLockForTests();
  __setRedisClientForTests(null);
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 最小 ioredis 假客户端：支持 SET NX PX + EVAL unlock */
function createFakeRedis() {
  const store = new Map<string, { value: string; expireAt: number }>();
  return {
    store,
    async set(
      key: string,
      value: string,
      mode?: string,
      ttl?: number,
      nx?: string,
    ): Promise<"OK" | null> {
      const now = Date.now();
      const cur = store.get(key);
      if (cur && cur.expireAt > now && nx === "NX") return null;
      if (mode === "PX" && typeof ttl === "number") {
        store.set(key, { value, expireAt: now + ttl });
        return "OK";
      }
      store.set(key, { value, expireAt: Number.MAX_SAFE_INTEGER });
      return "OK";
    },
    async eval(_script: string, _numKeys: number, key: string, token: string): Promise<number> {
      const cur = store.get(key);
      if (!cur || cur.value !== token) return 0;
      store.delete(key);
      return 1;
    },
  } as any;
}

describe("LocalAgentRunLock", () => {
  it("同一 agentId 并发 withLock 串行执行", async () => {
    const lock = __createLocalAgentRunLockForTests();
    const order: number[] = [];
    const p1 = lock.withLock("a1", async () => {
      order.push(1);
      await sleep(40);
      order.push(2);
      return "one";
    });
    const p2 = lock.withLock("a1", async () => {
      order.push(3);
      return "two";
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("one");
    expect(r2).toBe("two");
    expect(order).toEqual([1, 2, 3]);
  });

  it("不同 agentId 可并行", async () => {
    const lock = __createLocalAgentRunLockForTests();
    let overlap = false;
    let aRunning = false;
    await Promise.all([
      lock.withLock("x", async () => {
        aRunning = true;
        await sleep(30);
        aRunning = false;
      }),
      lock.withLock("y", async () => {
        await sleep(5);
        if (aRunning) overlap = true;
      }),
    ]);
    expect(overlap).toBe(true);
  });
});

describe("RedisAgentRunLock", () => {
  it("假 Redis 下同一 agentId 串行", async () => {
    const fake = createFakeRedis();
    const lock = __createRedisAgentRunLockForTests(fake, { acquireTimeoutMs: 5_000 });
    const order: number[] = [];
    const p1 = lock.withLock("a1", async () => {
      order.push(1);
      await sleep(40);
      order.push(2);
    });
    const p2 = lock.withLock("a1", async () => {
      order.push(3);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]);
    expect(fake.store.size).toBe(0);
  });

  it("持锁期间他人 SET NX 失败，释放后可获锁", async () => {
    const fake = createFakeRedis();
    const lock = __createRedisAgentRunLockForTests(fake, { acquireTimeoutMs: 5_000 });
    let secondStarted = false;
    const first = lock.withLock("z", async () => {
      await sleep(50);
      expect(secondStarted).toBe(false);
    });
    const second = (async () => {
      await sleep(5);
      await lock.withLock("z", async () => {
        secondStarted = true;
      });
    })();
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
  });
});
