/**
 * Agent prepare 段互斥锁。
 *
 * - local：进程内 Promise 链（串行化同一 agentId 的 prepare）
 * - redis（SWARM_MODE=redis）：Redis SET key NX PX + token 安全释放
 *
 * 锁只盖 prepare（会话解析 / busy / 写消息 / 起流），不盖整轮 run。
 */

import { randomUUID } from "crypto";
import { getRedisClient, isSwarmRedisMode } from "./redisClient.js";

const LOCK_TTL_MS = 30_000;
const ACQUIRE_TIMEOUT_MS = 60_000;
const RETRY_MS = 40;

const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface AgentRunLock {
  withLock<T>(agentId: string, fn: () => Promise<T>): Promise<T>;
}

/** 进程内互斥：串行化同一 agentId 的 prepare */
export class LocalAgentRunLock implements AgentRunLock {
  /** agentId → 链尾（当前持有者释放时 resolve） */
  private tails = new Map<string, Promise<void>>();

  async withLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(agentId) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    // 后继 waiter 等我们 release
    this.tails.set(
      agentId,
      prev.then(() => held),
    );
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Redis 分布式互斥 */
export class RedisAgentRunLock implements AgentRunLock {
  constructor(
    private readonly redis = getRedisClient(),
    private readonly ttlMs = LOCK_TTL_MS,
    private readonly acquireTimeoutMs = ACQUIRE_TIMEOUT_MS,
  ) {}

  private key(agentId: string): string {
    return `knowpilot:agent-run-lock:${agentId}`;
  }

  async withLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const key = this.key(agentId);
    const token = randomUUID();
    const deadline = Date.now() + this.acquireTimeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.redis.set(key, token, "PX", this.ttlMs, "NX");
      if (ok === "OK") {
        try {
          return await fn();
        } finally {
          try {
            await this.redis.eval(UNLOCK_LUA, 1, key, token);
          } catch {
            /* 进程崩溃靠 TTL 回收 */
          }
        }
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
    throw new Error(
      `获取 Agent 运行锁超时（${this.acquireTimeoutMs}ms）：agentId=${agentId}。请检查 Redis 与并发 prepare。`,
    );
  }
}

let _lock: AgentRunLock | null = null;

export function getAgentRunLock(): AgentRunLock {
  if (!_lock) {
    _lock = isSwarmRedisMode() ? new RedisAgentRunLock() : new LocalAgentRunLock();
  }
  return _lock;
}

/** 仅测试 */
export function __resetAgentRunLockForTests(lock?: AgentRunLock | null): void {
  _lock = lock === undefined ? null : lock;
}

export function __createLocalAgentRunLockForTests(): LocalAgentRunLock {
  return new LocalAgentRunLock();
}

export function __createRedisAgentRunLockForTests(
  redis: ReturnType<typeof getRedisClient>,
  opts?: { ttlMs?: number; acquireTimeoutMs?: number },
): RedisAgentRunLock {
  return new RedisAgentRunLock(redis, opts?.ttlMs, opts?.acquireTimeoutMs);
}
