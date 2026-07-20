/**
 * Swarm 健康快照 — 供 agent_inspect(includeSwarm) / swarm_brief / 只读 API 同源消费。
 * 只聚合查询，不改状态。
 */

import type { PrismaClient } from "@prisma/client";
import { listAllAskUserPending, listAskUserPendingForSession } from "./askUserGate.js";
import { listNotifyBreakerStatuses, type NotifyChannelStatus } from "./emailNotifier.js";

export type SwarmInboxPreviewItem = {
  id: string;
  fromAgentId: string;
  content: string;
  messageType: string;
  createdAt: string;
};

export type SwarmHealthSnapshot = {
  agentId: string;
  agentName?: string;
  tier?: string;
  inbox: {
    pending: number;
    delivered: number;
    consumedRecent: number;
    /** pending 最近几条预览（Chat / brief 用） */
    preview: SwarmInboxPreviewItem[];
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
    /** W2 决策态（只读展示） */
    lastMode: string | null;
    skipRemaining: number | null;
    quietStreak: number | null;
    terminalAt: string | null;
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
  notifyChannels: NotifyChannelStatus[];
  needsAttention: boolean;
};

export type SwarmBrief = {
  markdown: string;
  agents: SwarmHealthSnapshot[];
  notifyChannels: NotifyChannelStatus[];
  generatedAt: string;
};

export async function getSwarmHealthSnapshot(
  prisma: PrismaClient,
  agentId: string,
): Promise<SwarmHealthSnapshot> {
  const [pendingMsg, deliveredMsg, consumedMsg, sessions, agent, queueItems, inboxRows] =
    await Promise.all([
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
        select: { name: true, tier: true, heartbeatSuspendedAt: true, heartbeat: true },
      }),
      prisma.sessionQueueItem.count({
        where: {
          session: { agentId },
          kind: { in: ["superior", "child_notify"] },
        },
      }),
      prisma.agentMessage.findMany({
        where: { toAgentId: agentId, status: "pending" },
        select: {
          id: true,
          fromAgentId: true,
          content: true,
          messageType: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
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
  let lastMode: string | null = null;
  let skipRemaining: number | null = null;
  let quietStreak: number | null = null;
  let terminalAt: string | null = null;
  const hb = agent?.heartbeat;
  if (hb && typeof hb === "object" && !Array.isArray(hb)) {
    const hbo = hb as {
      enabled?: unknown;
      decision?: {
        lastMode?: unknown;
        skipRemaining?: unknown;
        quietStreak?: unknown;
        terminalAt?: unknown;
      };
    };
    heartbeatEnabled = hbo.enabled === true;
    const d = hbo.decision;
    if (d && typeof d === "object") {
      lastMode = typeof d.lastMode === "string" ? d.lastMode : null;
      skipRemaining = typeof d.skipRemaining === "number" ? d.skipRemaining : null;
      quietStreak = typeof d.quietStreak === "number" ? d.quietStreak : null;
      terminalAt = typeof d.terminalAt === "string" ? d.terminalAt : null;
    }
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
    agentName: agent?.name,
    tier: agent?.tier ?? undefined,
    inbox: {
      pending: pendingMsg,
      delivered: deliveredMsg,
      consumedRecent: consumedMsg,
      preview: inboxRows.map((r) => ({
        id: r.id,
        fromAgentId: r.fromAgentId,
        content: r.content.slice(0, 160),
        messageType: r.messageType,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    sessions: { running, paused, active },
    askUserPending,
    heartbeat: {
      suspendedAt,
      enabled: heartbeatEnabled,
      lastMode,
      skipRemaining,
      quietStreak,
      terminalAt,
    },
    superiorQueue: { pendingItems: queueItems },
    needsAttention,
    hint:
      "swarm 快照：inbox=AgentMessage；askUserPending=等人答复；superiorQueue=待 drain 的上级/子通知。" +
      "积压高时先消费再派新任务；suspendedAt 非空表示心跳熔断/目标闭合；lastMode/skipRemaining 为 W2 决策态。",
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

  const notifyChannels = listNotifyBreakerStatuses();
  const notifyOpen = notifyChannels.some((c) => c.state === "open" || c.state === "half-open");

  const needsAttention =
    asks.length > 0 ||
    suspendedAgents.length > 0 ||
    highInboxAgents.length > 0 ||
    notifyOpen;

  return {
    askUserPendingCount: asks.length,
    askUserSamples,
    suspendedAgents,
    highInboxAgents,
    notifyChannels,
    needsAttention,
  };
}

/**
 * 给 manager/super 的可读 Swarm 简报（markdown + 结构化快照）。
 * workspaceId 缺省：调用方应传入作用域；null = 全局（仅 super 语义由调用方保证）。
 */
export async function buildSwarmBrief(
  prisma: PrismaClient,
  options?: { workspaceId?: string | null; limit?: number },
): Promise<SwarmBrief> {
  const limit = Math.min(30, Math.max(1, options?.limit ?? 12));
  const where =
    options?.workspaceId != null && options.workspaceId !== ""
      ? { workspaceId: options.workspaceId, status: { not: "deleted" as const } }
      : { status: { not: "deleted" as const } };

  const agents = await prisma.agent.findMany({
    where,
    select: { id: true, name: true, tier: true },
    orderBy: [{ tier: "asc" }, { updatedAt: "desc" }],
    take: limit,
  });

  const snapshots: SwarmHealthSnapshot[] = [];
  for (const a of agents) {
    snapshots.push(await getSwarmHealthSnapshot(prisma, a.id));
  }

  const notifyChannels = listNotifyBreakerStatuses();
  const attention = snapshots.filter((s) => s.needsAttention);
  const lines: string[] = [
    `# Swarm 简报`,
    ``,
    `生成时间：${new Date().toISOString()}`,
    `扫描 Agent：${snapshots.length} · 需关注：${attention.length}`,
    ``,
  ];

  if (notifyChannels.some((c) => c.state !== "closed")) {
    lines.push(`## 通知通道`);
    for (const c of notifyChannels) {
      if (c.state === "closed" && c.failures === 0) continue;
      lines.push(`- ${c.channel}: **${c.state}**（连续失败 ${c.failures}）`);
    }
    lines.push(``);
  }

  if (attention.length === 0) {
    lines.push(`各 Agent 暂无积压 / 熔断 / 待答复。可继续派任务。`);
  } else {
    lines.push(`## 需关注`);
    for (const s of attention) {
      const name = s.agentName ?? s.agentId.slice(0, 8);
      const bits: string[] = [];
      if (s.inbox.pending > 0) bits.push(`inbox pending=${s.inbox.pending}`);
      if (s.superiorQueue.pendingItems > 0) bits.push(`superior队列=${s.superiorQueue.pendingItems}`);
      if (s.askUserPending.length > 0) bits.push(`ask_user=${s.askUserPending.length}`);
      if (s.sessions.paused > 0) bits.push(`paused会话=${s.sessions.paused}`);
      if (s.heartbeat.suspendedAt) bits.push(`心跳熔断`);
      if (s.heartbeat.lastMode) {
        bits.push(
          `决策=${s.heartbeat.lastMode}` +
            (s.heartbeat.skipRemaining != null && s.heartbeat.skipRemaining > 0
              ? `(skip=${s.heartbeat.skipRemaining})`
              : ""),
        );
      }
      lines.push(`### ${name}（${s.tier ?? "?"} · \`${s.agentId}\`)`);
      lines.push(`- ${bits.join("；") || "需关注"}`);
      if (s.inbox.preview[0]) {
        lines.push(`- 最近 inbox：${s.inbox.preview[0].content.slice(0, 100)}`);
      }
      if (s.askUserPending[0]) {
        lines.push(
          `- 等人答复：${s.askUserPending[0].question.slice(0, 80)}（session \`${s.askUserPending[0].sessionId}\`）`,
        );
      }
      lines.push(`- 建议：先消费 inbox / 等 ask_user / 恢复 paused，再派新任务。`);
      lines.push(``);
    }
  }

  return {
    markdown: lines.join("\n"),
    agents: snapshots,
    notifyChannels,
    generatedAt: new Date().toISOString(),
  };
}
