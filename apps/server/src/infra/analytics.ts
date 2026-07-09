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

  // R12：12 个 count 合并为单条 raw SQL（子查询），替代 13 路 Promise.all；tokenUsage 是 JSON 无法 SQL 聚合，仍 findMany。
  const logLteClause = logCreatedAtLte ? `AND "createdAt" <= ?` : "";
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM "Post") AS "postTotal",
      (SELECT COUNT(*) FROM "Post" WHERE "published" = 1) AS "postPublished",
      (SELECT COUNT(*) FROM "Agent") AS "agentTotal",
      (SELECT COUNT(*) FROM "Skill") AS "skillTotal",
      (SELECT COUNT(*) FROM "Skill" WHERE "enabled" = 1) AS "skillEnabled",
      (SELECT COUNT(*) FROM "ChatSession") AS "sessionTotal",
      (SELECT COUNT(*) FROM "Run") AS "runTotal",
      (SELECT COUNT(*) FROM "Run" WHERE "status" = 'success') AS "runSuccess",
      (SELECT COUNT(*) FROM "Run" WHERE "status" = 'failed') AS "runFailed",
      (SELECT COUNT(*) FROM "Task") AS "taskTotal",
      (SELECT COUNT(*) FROM "Task" WHERE "type" = 'cron') AS "taskCron",
      (SELECT COUNT(*) FROM "Log" WHERE "level" = 'error' AND "createdAt" >= ? ${logLteClause}) AS "logErrors24h"
  `;
  const params: Date[] = [since24h];
  if (logCreatedAtLte) params.push(logCreatedAtLte);

  const [rows, runsWithTokens] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(sql, ...params),
    prisma.run.findMany({
      select: { tokenUsage: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const r = rows[0] ?? {};

  let estimatedTotal = 0;
  for (const run of runsWithTokens) {
    const usage = run.tokenUsage as { total?: number } | null;
    if (usage && typeof usage.total === "number") estimatedTotal += usage.total;
  }

  return {
    posts: { total: Number(r.postTotal ?? 0), published: Number(r.postPublished ?? 0) },
    agents: { total: Number(r.agentTotal ?? 0) },
    skills: { total: Number(r.skillTotal ?? 0), enabled: Number(r.skillEnabled ?? 0) },
    sessions: { total: Number(r.sessionTotal ?? 0) },
    runs: { total: Number(r.runTotal ?? 0), success: Number(r.runSuccess ?? 0), failed: Number(r.runFailed ?? 0) },
    tasks: { total: Number(r.taskTotal ?? 0), cron: Number(r.taskCron ?? 0) },
    logs: { errors24h: Number(r.logErrors24h ?? 0) },
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
