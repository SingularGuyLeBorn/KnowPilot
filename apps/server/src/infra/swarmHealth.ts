/**
 * Swarm 健康快照 — 供 agent_inspect(includeSwarm) 与只读 API 同源消费。
 * 只聚合查询，不改状态。
 */

import type { PrismaClient } from "@prisma/client";
import { listAllAskUserPending, listAskUserPendingForSession } from "./askUserGate.js";

export type SwarmHealthSnapshot = {
  agentId: string;
  inbox: {
    pending: number;
    delivered: number;
    consumedRecent: number;
  };
  sessions: {
    running: number;
    paused: number;
    active: number;
  };
  askUserPending: Array<{
    askId: string;
    sessionId: string;
    question: string;
    channel: string;
    createdAt: number;
  }>;
  heartbeat: {
    suspendedAt: string | null;
    enabled: boolean | null;
  };
  superiorQueue: {
    pendingItems: number;
  };
  /** 是否值得在 UI 上高亮（有积压 / 熔断 / 等人） */
  needsAttention: boolean;
  hint: string;
};

/** /agents 列表顶栏用的轻量告警聚合 */
export type SwarmAlertsOverview = {
  askUserPendingCount: number;
  askUserSamples: Array<{ askId: string; sessionId: string; question: string; agentId?: string }>;
  suspendedAgents: Array<{ id: string; name: string; suspendedAt: string }>;
  highInboxAgents: Array<{ id: string; name: string; pending: number }>;
  needsAttention: boolean;
};

export async function getSwarmHealthSnapshot(
  prisma: PrismaClient,
  agentId: string,
): Promise<SwarmHealthSnapshot> {
  const [pendingMsg, deliveredMsg, consumedMsg, sessions, agent, queueItems] = await Promise.all([
    prisma.agentMessage.count({ where: { toAgentId: agentId, status: "pending" } }),
    prisma.agentMessage.count({ where: { toAgentId: agentId, status: "delivered" } }),
    prisma.agentMessage.count({
      where: {
        toAgentId: agentId,
        status: "consumed",
        deliveredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.chatSession.findMany({
      where: { agentId, status: { not: "deleted" } },
      select: { id: true, status: true },
      take: 50,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.agent.findUnique({
      where: { id: agentId },
      select: { heartbeatSuspendedAt: true, heartbeat: true },
    }),
    prisma.sessionQueueItem.count({
      where: {
        session: { agentId },
        kind: { in: ["superior", "child_notify"] },
      },
    }),
  ]);

  const running = sessions.filter((s) => s.status === "running").length;
  const paused = sessions.filter((s) => s.status === "paused").length;
  const active = sessions.filter((s) => s.status === "active" || s.status === "completed").length;

  const askUserPending = sessions.flatMap((s) =>
    listAskUserPendingForSession(s.id).map((p) => ({
      askId: p.askId,
      sessionId: p.sessionId,
      question: p.question.slice(0, 200),
      channel: p.channel,
      createdAt: p.createdAt,
    })),
  );

  let heartbeatEnabled: boolean | null = null;
  const hb = agent?.heartbeat;
  if (hb && typeof hb === "object" && !Array.isArray(hb)) {
    heartbeatEnabled = (hb as { enabled?: unknown }).enabled === true;
  }

  const suspendedAt = agent?.heartbeatSuspendedAt?.toISOString() ?? null;
  const needsAttention =
    askUserPending.length > 0 ||
    pendingMsg > 0 ||
    queueItems > 0 ||
    paused > 0 ||
    suspendedAt != null;

  return {
    agentId,
    inbox: {
      pending: pendingMsg,
      delivered: deliveredMsg,
      consumedRecent: consumedMsg,
    },
    sessions: { running, paused, active },
    askUserPending,
    heartbeat: {
      suspendedAt,
      enabled: heartbeatEnabled,
    },
    superiorQueue: { pendingItems: queueItems },
    needsAttention,
    hint:
      "swarm 快照：inbox=AgentMessage；askUserPending=等人答复；superiorQueue=待 drain 的上级/子通知。" +
      "积压高时先消费再派新任务；suspendedAt 非空表示心跳熔断。",
  };
}

const HIGH_INBOX_THRESHOLD = 3;

/** 全仓轻量告警：ask_user 积压 + 心跳熔断 + inbox pending 偏高 */
export async function getSwarmAlertsOverview(prisma: PrismaClient): Promise<SwarmAlertsOverview> {
  const asks = listAllAskUserPending();
  const askUserSamples = asks.slice(0, 5).map((p) => ({
    askId: p.askId,
    sessionId: p.sessionId,
    question: p.question.slice(0, 120),
    agentId: p.agentId,
  }));

  const suspendedAgents = (
    await prisma.agent.findMany({
      where: { heartbeatSuspendedAt: { not: null } },
      select: { id: true, name: true, heartbeatSuspendedAt: true },
      take: 20,
    })
  ).map((a) => ({
    id: a.id,
    name: a.name,
    suspendedAt: a.heartbeatSuspendedAt!.toISOString(),
  }));

  const pendingGroups = await prisma.agentMessage.groupBy({
    by: ["toAgentId"],
    where: { status: "pending" },
    _count: { _all: true },
  });
  const heavy = pendingGroups
    .filter((g) => g._count._all >= HIGH_INBOX_THRESHOLD)
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 10);
  const heavyIds = heavy.map((g) => g.toAgentId);
  const heavyAgents =
    heavyIds.length === 0
      ? []
      : await prisma.agent.findMany({
          where: { id: { in: heavyIds } },
          select: { id: true, name: true },
        });
  const nameById = new Map(heavyAgents.map((a) => [a.id, a.name]));
  const highInboxAgents = heavy.map((g) => ({
    id: g.toAgentId,
    name: nameById.get(g.toAgentId) ?? g.toAgentId.slice(0, 8),
    pending: g._count._all,
  }));

  const needsAttention =
    asks.length > 0 || suspendedAgents.length > 0 || highInboxAgents.length > 0;

  return {
    askUserPendingCount: asks.length,
    askUserSamples,
    suspendedAgents,
    highInboxAgents,
    needsAttention,
  };
}
