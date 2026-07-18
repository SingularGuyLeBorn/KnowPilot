/**
 * Redis 连接单例 — SWARM_MODE=redis 时供分布式锁 / busy 信号 / SwarmBus 复用。
 * local 模式不建立连接。
 */

import IORedis from "ioredis";

let client: IORedis | null = null;

export function getRedisUrl(): string {
  return (process.env.REDIS_URL || "redis://127.0.0.1:6379").trim();
}

export function isSwarmRedisMode(): boolean {
  return (process.env.SWARM_MODE || "local").trim().toLowerCase() === "redis";
}

/** 获取（或惰性创建）ioredis 客户端。调用方需保证 SWARM_MODE=redis。 */
export function getRedisClient(): IORedis {
  if (!client) {
    client = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }
  return client;
}

/** 测试或进程退出时断开并清空单例 */
export async function closeRedisClient(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  try {
    await c.quit();
  } catch {
    c.disconnect();
  }
}

/** 仅测试：注入假客户端或清空 */
export function __setRedisClientForTests(fake: IORedis | null): void {
  client = fake;
}
