/**
 * 【一次性脚本】W14 存量 AgentMessage 投递记账修复（幂等，可重复执行）
 *
 * 背景：W14 之前 report_back 的消费发生在 Task 管道（asyncJobManager 原子认领 →
 * 注入父会话气泡），旁路邮箱 AgentMessage 没人记账，status 永远停 pending，
 * 是重复投递定时炸弹。W14 已在运行路径补上 delivered/consumed 回写与镜像幂等防线，
 * 本脚本负责对 W14 之前积累的存量 pending 消息做一次性对账：
 *
 *   扫描 status=pending 且创建超 1 小时的 AgentMessage，对照目标会话消息记录：
 *   - 目标会话已存在同 content 消息（说明已注入过）→ 置 consumed（补 deliveredAt）
 *   - 未注入 → 保持 pending 并输出告警清单（需人工排查）
 *
 *   目标会话解析顺序：taskRef → Task.input.sessionId → AgentMessage.sessionId
 *   → toAgent 最近活跃会话；三者都拿不到则保持 pending 并告警。
 *
 * 执行方式（项目根目录或 apps/server 下均可）：
 *   pnpm --filter @knowpilot/server run fix:agent-message-ledger
 *   # 只看不动（dry-run，不写库）：
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/fix-agent-message-ledger.ts --dry-run
 */

import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

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

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const dryRun = process.argv.includes("--dry-run");
  loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
  loadEnv({ path: path.resolve(process.cwd(), ".env") });
  const prisma = new PrismaClient();

  (async () => {
    console.log(`🔍 [W14] 扫描滞留 pending AgentMessage（阈值 ${STALE_PENDING_MS / 60000} 分钟）${dryRun ? "（dry-run，不写库）" : ""}…`);
    const result = await reconcileAgentMessageLedger(prisma, { dryRun });
    console.log(`   扫描: ${result.scanned} 条`);
    console.log(`   ✅ 已注入 → 置 consumed: ${result.markedConsumed} 条`);
    console.log(`   ⚠️ 未注入 → 保持 pending: ${result.keptPending} 条`);
    for (const w of result.warnings) {
      console.warn(`   ⚠️ [${w.messageId}] ${w.reason}｜内容: ${w.contentPreview}`);
    }
    if (result.keptPending > 0) {
      console.log("   以上 pending 记录需人工排查（可能从未被投递，或目标会话已删除）。");
    }
  })()
    .catch((e) => {
      console.error("❌ 存量修复脚本执行失败:", e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
