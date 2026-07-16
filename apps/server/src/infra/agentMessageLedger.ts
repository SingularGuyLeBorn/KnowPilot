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
 *
 * 另含存量对账 reconcileAgentMessageLedger：原一次性脚本 scripts/fix-agent-message-ledger.ts
 * 的核心逻辑（W16c 随脚本退役迁入，脚本执行 0 命中后已删除）。
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

/**
 * delivered 回滚（R-1 S3）：注入确定未发生 / 对账判定孤儿 → delivered 退回 pending。
 * 仅命中 status="delivered"：
 * - 已 consumed 的消息 = 气泡已被读入上下文，绝不可回滚（回滚会导致重复投喂）；
 * - 仍 pending 的消息无需回滚。
 * 条件写幂等：与 markDelivered / markConsumed 并发竞态安全，落选 no-op。
 * deliveredAt 清空：交付事实上未完成，真账不保留伪时间；下次成功 CLAIM 重新落账。
 */
export async function rollbackAgentMessageDeliveredByTaskRef(
  db: AgentMessageLedgerDb,
  taskRef: string,
): Promise<number> {
  const result = await db.agentMessage.updateMany({
    where: { taskRef, status: "delivered" },
    data: { status: "pending", deliveredAt: null },
  });
  return result.count;
}


/* -------------------------------------------------------------------------- */
/* 存量对账（W14 一次性脚本退役后保留的对账核心） */

/** 存量判定阈值：创建超 1 小时仍 pending 才纳入对账（避免误伤飞行中的正常投递） */
const STALE_PENDING_MS = 60 * 60 * 1000;

export interface ReconcileWarning {
  messageId: string;
  reason: string;
  contentPreview: string;
}

export interface ReconcileResult {
  scanned: number;
  markedConsumed: number;
  keptPending: number;
  warnings: ReconcileWarning[];
  dryRun: boolean;
}

type ReconcileDb = Pick<PrismaClient, "agentMessage" | "task" | "chatMessage" | "chatSession">;

function parseTaskSessionId(rawInput: unknown): string | null {
  let value = rawInput;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const sessionId = (value as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId ? sessionId : null;
}

/** 解析 AgentMessage 的目标会话：taskRef → Task.input.sessionId → 自身 sessionId → toAgent 最近活跃会话 */
async function resolveTargetSessionId(
  db: ReconcileDb,
  msg: { sessionId: string | null; taskRef: string | null; toAgentId: string },
): Promise<string | null> {
  if (msg.taskRef) {
    const task = await db.task.findUnique({
      where: { id: msg.taskRef },
      select: { input: true },
    });
    const fromTask = task ? parseTaskSessionId(task.input) : null;
    if (fromTask) return fromTask;
  }
  if (msg.sessionId) return msg.sessionId;
  const latest = await db.chatSession.findFirst({
    where: { agentId: msg.toAgentId, status: { notIn: ["deleted", "archived"] } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

/**
 * 存量对账核心（可测试）：扫滞留 pending → 已注入置 consumed，未注入保持 pending 并告警。
 * dryRun=true 时只扫描与判定，不写库。
 */
export async function reconcileAgentMessageLedger(
  db: ReconcileDb,
  opts: { olderThanMs?: number; dryRun?: boolean } = {},
): Promise<ReconcileResult> {
  const olderThanMs = opts.olderThanMs ?? STALE_PENDING_MS;
  const dryRun = opts.dryRun === true;
  const before = new Date(Date.now() - olderThanMs);

  const stale = await db.agentMessage.findMany({
    where: { status: "pending", createdAt: { lt: before } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      content: true,
      sessionId: true,
      taskRef: true,
      toAgentId: true,
      fromAgentId: true,
      createdAt: true,
    },
  });

  const result: ReconcileResult = {
    scanned: stale.length,
    markedConsumed: 0,
    keptPending: 0,
    warnings: [],
    dryRun,
  };

  for (const msg of stale) {
    const preview = msg.content.replace(/\s+/g, " ").slice(0, 60);
    const sessionId = await resolveTargetSessionId(db, msg);
    if (!sessionId) {
      result.keptPending++;
      result.warnings.push({
        messageId: msg.id,
        reason: "无法定位目标会话（无 taskRef / sessionId / toAgent 活跃会话），保持 pending",
        contentPreview: preview,
      });
      continue;
    }

    const injected = await db.chatMessage.findFirst({
      where: { sessionId, content: msg.content },
      select: { id: true },
    });
    if (!injected) {
      result.keptPending++;
      result.warnings.push({
        messageId: msg.id,
        reason: `目标会话 ${sessionId} 无同内容消息（疑似未注入），保持 pending`,
        contentPreview: preview,
      });
      continue;
    }

    if (!dryRun) {
      await db.agentMessage.update({
        where: { id: msg.id },
        data: { status: "consumed", deliveredAt: new Date() },
      });
    }
    result.markedConsumed++;
  }

  return result;
}
