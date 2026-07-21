/**
 * D8：supersedeUpdate 两步写必须在事务内；中断不得留下双 active
 *
 * 禁止 vi.spyOn(prisma, "$transaction")：PrismaClient 上 spy/restore 会弄坏单例方法，
 * 污染后续套件（$transaction is not a function）。改为临时替换 + finally 复位。
 */

import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../db.js";
import { getEventBus } from "../infra/eventBus.js";
import { getAppConfig } from "../infra/config.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import { createMemoryRepository } from "../infra/memoryRepository.js";
import { MEMORY_TYPES, memoryAgentScope } from "@knowpilot/shared";

const RUN = `d8-${Date.now().toString(36)}`;
const createdIds: string[] = [];
const originalTransaction = prisma.$transaction.bind(prisma);

afterEach(async () => {
  (prisma as { $transaction: typeof prisma.$transaction }).$transaction =
    originalTransaction as typeof prisma.$transaction;
  const services = getServiceContainer(prisma, getEventBus(), getAppConfig());
  for (const id of createdIds.splice(0)) {
    await services.memory.delete(id).catch(() => undefined);
  }
});

describe("D8 supersedeUpdate 事务", () => {
  it("supersede 第二步失败时不出现双 active", async () => {
    const services = getServiceContainer(prisma, getEventBus(), getAppConfig());
    const repo = createMemoryRepository(services);
    const agentId = `${RUN}-agent`;
    const token = `${RUN}-token`;
    const scope = memoryAgentScope(agentId);

    const v1 = await repo.write({
      content: `事实 v1 ${token}`,
      type: MEMORY_TYPES.SEMANTIC,
      scope,
      keywords: [token],
    });
    createdIds.push(v1.id);

    (prisma as { $transaction: typeof prisma.$transaction }).$transaction = (() =>
      Promise.reject(new Error("模拟 supersede 中断"))) as typeof prisma.$transaction;

    try {
      await expect(
        repo.supersedeUpdate({
          id: v1.id,
          content: `事实 v2 ${token}`,
          actor: { agentId, tier: "manager" },
        }),
      ).rejects.toThrow(/模拟 supersede 中断/);
    } finally {
      (prisma as { $transaction: typeof prisma.$transaction }).$transaction =
        originalTransaction as typeof prisma.$transaction;
    }

    const actives = await prisma.memory.findMany({
      where: { scope, status: "active", content: { contains: token } },
    });
    expect(actives).toHaveLength(1);
    expect(actives[0]!.id).toBe(v1.id);

    // 清理可能残留的孤儿行
    const orphans = await prisma.memory.findMany({ where: { content: { contains: token } } });
    for (const o of orphans) createdIds.push(o.id);
  });
});
