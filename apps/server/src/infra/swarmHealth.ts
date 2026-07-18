/**
 * Swarm 健康快照 — 供 agent_inspect(includeSwarm) 与只读 API 同源消费。
 * 只聚合查询，不改状态。
 */

import type { PrismaClient } from "@prisma/client";
import { listAskUserPendingForSession } from "./askUserGate.js";

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
  hint: string;
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
      suspendedAt: agent?.heartbeatSuspendedAt?.toISOString() ?? null,
      enabled: heartbeatEnabled,
    },
    superiorQueue: { pendingItems: queueItems },
    hint:
      "swarm 快照：inbox=AgentMessage；askUserPending=等人答复；superiorQueue=待 drain 的上级/子通知。" +
      "积压高时先消费再派新任务；suspendedAt 非空表示心跳熔断。",
  };
}
