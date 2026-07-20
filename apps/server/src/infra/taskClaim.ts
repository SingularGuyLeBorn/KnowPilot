/**
 * Task 执行认领 — 三入口（TaskService.run / TaskScheduler / TriggerEngine）共用单点。
 *
 * 不变量：status≠running → running 的条件写是唯一互斥点；落选方 count=0，禁止 check-then-act。
 */

import type { PrismaClient } from "@prisma/client";

/**
 * 原子认领：仅当任务当前不是 running 时置为 running。
 * @returns true = 本调用方获执行权；false = 已有执行体在跑（或任务不存在）
 */
export async function claimTaskRun(
  db: PrismaClient,
  taskId: string,
): Promise<boolean> {
  const claimed = await db.task.updateMany({
    where: { id: taskId, status: { not: "running" } },
    data: {
      status: "running",
      startedAt: new Date(),
    },
  });
  return claimed.count > 0;
}

/**
 * 心跳会话重叠闸：在「本 task 非 running」且「同 session 无其他 running」时认领。
 * 落选 → 调用方应把已建 queued 行收尾（cancelled/failed），不得起跑。
 */
export async function claimExclusiveSessionTaskRun(
  db: PrismaClient,
  taskId: string,
  sessionId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const conflict = await tx.task.findFirst({
      where: { sessionId, status: "running", NOT: { id: taskId } },
      select: { id: true },
    });
    if (conflict) return false;
    const claimed = await tx.task.updateMany({
      where: { id: taskId, status: { not: "running" } },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });
    return claimed.count > 0;
  });
}
