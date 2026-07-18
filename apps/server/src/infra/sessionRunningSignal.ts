/**
 * 跨实例「会话正在跑 Agent 流」信号（SWARM_MODE=redis）。
 *
 * local 模式全部 no-op（永远未占用 / 宣称成功），行为与单进程 hub 一致。
 * redis：SET knowpilot:session-running:{id} NX PX，TTL 防僵尸。
 */

import { getRedisClient, isSwarmRedisMode } from "./redisClient.js";

/** 长任务兜底；正常路径在 hub 终态显式 DEL */
const RUNNING_TTL_MS = 2 * 60 * 60 * 1000;

function key(sessionId: string): string {
  return `knowpilot:session-running:${sessionId}`;
}

/** 尝试宣称会话 running；已占用返回 false */
export async function tryClaimSessionRunning(sessionId: string): Promise<boolean> {
  if (!isSwarmRedisMode()) return true;
  const redis = getRedisClient();
  const ok = await redis.set(key(sessionId), "1", "PX", RUNNING_TTL_MS, "NX");
  return ok === "OK";
}

export async function releaseSessionRunning(sessionId: string): Promise<void> {
  if (!isSwarmRedisMode()) return;
  try {
    await getRedisClient().del(key(sessionId));
  } catch {
    /* ignore */
  }
}

export async function isSessionRunningClaimed(sessionId: string): Promise<boolean> {
  if (!isSwarmRedisMode()) return false;
  try {
    const v = await getRedisClient().get(key(sessionId));
    return v != null;
  } catch {
    return false;
  }
}
