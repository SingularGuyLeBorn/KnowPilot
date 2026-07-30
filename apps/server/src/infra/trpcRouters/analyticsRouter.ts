/**
 * analytics tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { analyticsDashboardSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { getCachedAnalyticsDashboard } from "../analytics.js";

export const analyticsRouter = router({
  dashboard: publicProcedure
    .meta({ description: "系统看板关键指标（文章/Agent/Run/Token/日志）。", aiReadable: true })
    .input(analyticsDashboardSchema)
    .query(({ ctx, input }) => getCachedAnalyticsDashboard(ctx.prisma, input)),
  // Swarm 监控统计：按 Agent 分组展示对话轮数/工具执行数/成功率/平均耗时/token（#25/#46）
  swarmStats: publicProcedure
    .meta({ description: "Swarm Agent 运行统计（按 Agent 分组）。", aiReadable: false })
    .input(z.object({ agentId: z.string().cuid().optional(), days: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const where = { createdAt: { gte: since }, ...(input?.agentId ? { agentId: input.agentId } : {}) };

      // #9：计数/耗时/工具数用 SQL groupBy 精确聚合（走 Run(createdAt) 索引，无内存上限）；
      // tokenUsage 是 JSON，SQL 无法聚合，仍用 bounded findMany 取最近 5000 条近似求和。
      const [byAgentStatus, tokenRuns] = await Promise.all([
        ctx.prisma.run.groupBy({
          by: ["agentId", "status"],
          where,
          _count: { _all: true },
          _sum: { durationMs: true, toolCallCount: true },
        }),
        ctx.prisma.run.findMany({
          where,
          select: { agentId: true, tokenUsage: true },
          take: 5000,
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const byAgent = new Map<string, { total: number; success: number; failed: number; totalDurationMs: number; totalToolCalls: number; totalTokens: number }>();
      for (const row of byAgentStatus) {
        const key = row.agentId ?? "unknown";
        const stats = byAgent.get(key) ?? { total: 0, success: 0, failed: 0, totalDurationMs: 0, totalToolCalls: 0, totalTokens: 0 };
        stats.total += row._count._all;
        if (row.status === "success") stats.success += row._count._all;
        if (row.status === "failed") stats.failed += row._count._all;
        stats.totalDurationMs += row._sum.durationMs ?? 0;
        stats.totalToolCalls += row._sum.toolCallCount ?? 0;
        byAgent.set(key, stats);
      }
      for (const r of tokenRuns) {
        const stats = byAgent.get(r.agentId ?? "unknown");
        if (!stats) continue;
        const usage = r.tokenUsage as { total?: number } | null;
        stats.totalTokens += usage?.total ?? 0;
      }

      // 查 Agent 名称
      const agentIds = [...byAgent.keys()].filter((id) => id !== "unknown");
      const agents = await ctx.prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, tier: true } });
      const agentMap = new Map(agents.map((a) => [a.id, a]));

      return [...byAgent.entries()].map(([agentId, stats]) => ({
        agentId,
        agentName: agentMap.get(agentId)?.name ?? "unknown",
        agentTier: agentMap.get(agentId)?.tier ?? "sub",
        conversationRounds: stats.total,
        toolCallCount: stats.totalToolCalls,
        successRate: stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0,
        avgDurationMs: stats.total > 0 ? Math.round(stats.totalDurationMs / stats.total) : 0,
        totalTokens: stats.totalTokens,
      }));
    }),
});

