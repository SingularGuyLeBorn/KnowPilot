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

export async function getAnalyticsDashboard(
  prisma: PrismaClient,
  range?: { from?: string; to?: string },
): Promise<AnalyticsDashboard> {
  const since24h = range?.from ? new Date(range.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logCreatedAtLte = range?.to ? new Date(range.to) : undefined;

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
    prisma.log.count({
      where: {
        level: "error",
        createdAt: {
          gte: since24h,
          ...(logCreatedAtLte ? { lte: logCreatedAtLte } : {}),
        },
      },
    }),
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

/* ─── R8：dashboard TTL 缓存 ───
 * getAnalyticsDashboard 并行 13 个 count/findMany，dashboard 重载或多人查看时重复执行。
 * 加 30s TTL 缓存（按 range 键），dashboard 指标容忍短时 stale。
 */
let dashboardCache: { key: string; at: number; value: AnalyticsDashboard } | null = null;
const DASHBOARD_CACHE_TTL_MS = 30_000;

export async function getCachedAnalyticsDashboard(
  prisma: PrismaClient,
  range?: { from?: string; to?: string },
): Promise<AnalyticsDashboard> {
  const key = `${range?.from ?? ""}|${range?.to ?? ""}`;
  if (dashboardCache && dashboardCache.key === key && Date.now() - dashboardCache.at < DASHBOARD_CACHE_TTL_MS) {
    return dashboardCache.value;
  }
  const value = await getAnalyticsDashboard(prisma, range);
  dashboardCache = { key, at: Date.now(), value };
  return value;
}

export function invalidateAnalyticsDashboardCache(): void {
  dashboardCache = null;
}
