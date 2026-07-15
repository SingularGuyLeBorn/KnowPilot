/**
 * AgentMessage 投递记账（W14）— 叶子模块（仅依赖 @prisma/client 类型，无循环依赖风险）
 *
 * 背景：report_back 的投递载具是 Task 管道（asyncJobManager 原子认领 → 注入父会话气泡），
 * AgentMessage 只是同一动作顺手写的旁路邮箱/审计记录。W14 之前没人给它记账，
 * status 永远停 pending = 重复投递定时炸弹。本模块把「消息链路账」补齐，全部按
 * taskRef=jobId 对账，updateMany 条件幂等（重复调用 / 并发竞态安全）：
 *
 * - delivered：Task 管道原子认领成功（气泡即将注入父会话）
 * - consumed：注入气泡随会话历史被 ReAct 循环实际读入上下文
 *
 * 与 Task 侧消费语义（问题 G 的 consumedBy）解耦：AgentMessage 记「消息链路」，
 * Task 记「结果内容」，两条账各记各的。
 */

import type { PrismaClient, Prisma } from "@prisma/client";

/** 支持在 $transaction 内复用 */
export type AgentMessageLedgerDb = PrismaClient | Prisma.TransactionClient;

/**
 * delivered：Task 管道认领成功 → taskRef 关联的 pending AgentMessage 置 delivered + deliveredAt。
 * 仅命中 status="pending"，重复调用 / 与 consumed 竞态均为幂等 no-op。
 * 返回命中条数（正常 0 或 1）。
 */
export async function markAgentMessageDeliveredByTaskRef(
  db: AgentMessageLedgerDb,
  taskRef: string,
): Promise<number> {
  const result = await db.agentMessage.updateMany({
    where: { taskRef, status: "pending" },
    data: { status: "delivered", deliveredAt: new Date() },
  });
  return result.count;
}

/**
 * consumed：气泡被读入父 Agent 上下文 → pending/delivered 一律置 consumed。
 * 转移语义（W16a-1，真账保护）：
 * - delivered → consumed：deliveredAt 是 CLAIM 落账的真账，不得覆写；
 * - pending → consumed 直跳（竞态/存量兜底）：deliveredAt 原本为空，按消费时刻补齐
 *   （消息既已被读入上下文，交付必然已发生，此刻是可得的最真实时间）。
 * 重复调用幂等 no-op。返回命中条数。
 */
export async function markAgentMessageConsumedByTaskRef(
  db: AgentMessageLedgerDb,
  taskRef: string,
): Promise<number> {
  const fromDelivered = await db.agentMessage.updateMany({
    where: { taskRef, status: "delivered" },
    data: { status: "consumed" },
  });
  const fromPending = await db.agentMessage.updateMany({
    where: { taskRef, status: "pending" },
    data: { status: "consumed", deliveredAt: new Date() },
  });
  return fromDelivered.count + fromPending.count;
}
