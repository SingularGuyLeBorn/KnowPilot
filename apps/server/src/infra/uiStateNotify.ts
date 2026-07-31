/**
 * UI 状态变更通知（推拉结合 · PUSH 半边）
 *
 * 铁律：权威写点之后必须推可观测事件；管理页另靠 refetchInterval 做 PULL。
 * 目标：开着的 Chat / 其它标签页秒级对齐，禁止「写了库等用户 F5」。
 */
import type { PrismaClient } from "@prisma/client";
import { getStreamHub } from "./sessionStreamHub.js";
import type { AgentStreamEvent } from "./agentStream.js";

export type UiStateNotifyKind =
  | "cron_job_updated"
  | "approval_updated"
  | "session_list_changed"
  | "agent_list_changed"
  | "post_list_changed"
  | "run_updated"
  | "task_updated"
  | "goal_updated";

/** Goal 写库后推到该会话（ChatGoalBar / 跨标签） */
export function notifyGoalUpdated(
  sessionId: string,
  status?: string | null,
): void {
  pushUiStateToSession(sessionId, {
    type: "goal_updated",
    sessionId,
    status: status ?? undefined,
  });
}

/** 推到指定会话（已连 SSE 的标签页立刻收到） */
export function pushUiStateToSession(
  sessionId: string,
  event: Extract<AgentStreamEvent, { type: UiStateNotifyKind }>,
): void {
  try {
    getStreamHub()?.pushExternalEvent(sessionId, event);
  } catch {
    /* hub 未就绪不阻断写库 */
  }
}

/**
 * 推到某 Agent 的主会话；无主会话时回退任意非归档 chat/cron 会话。
 * Cron / session 列表变更首选此路径。
 */
export async function notifyAgentUi(
  prisma: PrismaClient,
  agentId: string,
  event: Extract<AgentStreamEvent, { type: UiStateNotifyKind }>,
): Promise<void> {
  try {
    const main = await prisma.chatSession.findFirst({
      where: { agentId, isMainSession: true, status: { not: "archived" } },
      select: { id: true },
    });
    if (main) {
      pushUiStateToSession(main.id, event);
      return;
    }
    const fallback = await prisma.chatSession.findFirst({
      where: {
        agentId,
        status: { notIn: ["archived", "deleted"] },
        kind: { in: ["chat", "cron"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (fallback) pushUiStateToSession(fallback.id, event);
  } catch {
    /* 通知失败不阻断写库 */
  }
}

/**
 * 审批等无 agent 归属的全局管理态：推到所有活跃主会话。
 * 单用户本地场景主会话数少，可接受。
 */
export async function notifyAllMainSessionsUi(
  prisma: PrismaClient,
  event: Extract<AgentStreamEvent, { type: UiStateNotifyKind }>,
): Promise<void> {
  try {
    const mains = await prisma.chatSession.findMany({
      where: { isMainSession: true, status: { not: "archived" } },
      select: { id: true },
      take: 40,
    });
    for (const m of mains) {
      pushUiStateToSession(m.id, event);
    }
  } catch {
    /* ignore */
  }
}

/** Cron 行变更后通知（含 lastRunStatus） */
export async function notifyCronJobUpdated(
  prisma: PrismaClient,
  job: { id: string; agentId: string; name?: string; lastRunStatus?: string | null },
): Promise<void> {
  await notifyAgentUi(prisma, job.agentId, {
    type: "cron_job_updated",
    agentId: job.agentId,
    cronJobId: job.id,
    cronName: job.name,
    lastRunStatus: job.lastRunStatus ?? undefined,
  });
}

/** Post / Garden 等 content 列表变更：创建/更新/删除/恢复后推到所有主会话 */
export async function notifyPostListChanged(
  prisma: PrismaClient,
  reason?: string,
): Promise<void> {
  await notifyAllMainSessionsUi(prisma, {
    type: "post_list_changed",
    reason,
  });
}

/**
 * db:sync 完成后推送列表变更（推拉结合 · 收拢入口）。
 * hub 未就绪（CLI 无服务进程）时 pushUiStateToSession 内部静默 no-op，CLI 场景安全。
 * Post/Memory 等无专属事件类型的实体由管理页 refetchInterval 兜底（PULL），
 * 这里推 agent_list_changed 让侧栏与 /agents 秒级对齐（web 端同时 invalidate agent/workspace 列表）。
 */
export async function notifyContentSynced(
  prisma: PrismaClient,
  results: Array<{ entityName: string; changed: number }>,
): Promise<void> {
  if (!results.some((r) => r.changed > 0)) return;
  await notifyAllMainSessionsUi(prisma, {
    type: "agent_list_changed",
    reason: "db:sync",
  });
}
