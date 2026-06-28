/**
 * Analytics — 系统看板指标（L5-M02）
 */

import type { PrismaClient } from "@prisma/client";

export interface AnalyticsDashboard {
  posts: { total: number; published: number };
  agents: { total: number };
  skills: { total: number; enabled: number };
  sessions: { total: number };
  runs: { total: number; success: number; failed: number };
  tasks: { total: number; cron: number };
  logs: { errors24h: number };
  tokens: { estimatedTotal: number };
}

export async function getAnalyticsDashboard(prisma: PrismaClient): Promise<AnalyticsDashboard> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    postTotal,
    postPublished,
    agentTotal,
    skillTotal,
    skillEnabled,
    sessionTotal,
    runTotal,
    runSuccess,
    runFailed,
    taskTotal,
    taskCron,
    logErrors24h,
    runsWithTokens,
  ] = await Promise.all([
    prisma.post.count(),
    prisma.post.count({ where: { published: true } }),
    prisma.agent.count(),
    prisma.skill.count(),
    prisma.skill.count({ where: { enabled: true } }),
    prisma.chatSession.count(),
    prisma.run.count(),
    prisma.run.count({ where: { status: "success" } }),
    prisma.run.count({ where: { status: "failed" } }),
    prisma.task.count(),
    prisma.task.count({ where: { type: "cron" } }),
    prisma.log.count({ where: { level: "error", createdAt: { gte: since24h } } }),
    prisma.run.findMany({
      select: { tokenUsage: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  let estimatedTotal = 0;
  for (const run of runsWithTokens) {
    const usage = run.tokenUsage as { total?: number } | null;
    if (usage && typeof usage.total === "number") estimatedTotal += usage.total;
  }

  return {
    posts: { total: postTotal, published: postPublished },
    agents: { total: agentTotal },
    skills: { total: skillTotal, enabled: skillEnabled },
    sessions: { total: sessionTotal },
    runs: { total: runTotal, success: runSuccess, failed: runFailed },
    tasks: { total: taskTotal, cron: taskCron },
    logs: { errors24h: logErrors24h },
    tokens: { estimatedTotal },
  };
}
