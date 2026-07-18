/**
 * 跨实例 session running 宣称（假 Redis）。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  isSessionRunningClaimed,
  releaseSessionRunning,
  tryClaimSessionRunning,
} from "../infra/sessionRunningSignal.js";
import { __setRedisClientForTests } from "../infra/redisClient.js";

afterEach(() => {
  __setRedisClientForTests(null);
  delete process.env.SWARM_MODE;
});

function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string, _m?: string, _t?: number, nx?: string) {
      if (nx === "NX" && store.has(key)) return null;
      store.set(key, value);
      return "OK" as const;
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
  } as any;
}

describe("sessionRunningSignal", () => {
  it("local 模式始终可 claim，且 isClaimed=false", async () => {
    process.env.SWARM_MODE = "local";
    expect(await tryClaimSessionRunning("s1")).toBe(true);
    expect(await isSessionRunningClaimed("s1")).toBe(false);
  });

  it("redis 模式第二次 claim 失败，release 后可再 claim", async () => {
    process.env.SWARM_MODE = "redis";
    const fake = createFakeRedis();
    __setRedisClientForTests(fake);
    expect(await tryClaimSessionRunning("s1")).toBe(true);
    expect(await tryClaimSessionRunning("s1")).toBe(false);
    expect(await isSessionRunningClaimed("s1")).toBe(true);
    await releaseSessionRunning("s1");
    expect(await isSessionRunningClaimed("s1")).toBe(false);
    expect(await tryClaimSessionRunning("s1")).toBe(true);
  });
});
