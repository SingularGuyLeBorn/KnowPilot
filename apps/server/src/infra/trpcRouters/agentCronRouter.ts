/**
 * agentCron tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import {
  listAgentCronSchema, upsertAgentCronSchema, clearAgentCronSchema,
  setAgentCronEnabledSchema, fireAgentCronSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";

export const agentCronRouter = router({
  list: publicProcedure
    .meta({ description: "列出 Agent Cron 任务（可按 agentId / enabled 过滤）。", aiReadable: true })
    .input(listAgentCronSchema)
    .query(async ({ ctx, input }) => {
      const { ensureAgentCronJobTable, listCronJobs } = await import("../agentCronStore.js");
      await ensureAgentCronJobTable(ctx.prisma);
      const rows = await listCronJobs(ctx.prisma, {
        agentId: input.agentId,
        enabledOnly: input.enabledOnly,
      });
      const agentIds = [...new Set(rows.map((r) => r.agentId))];
      const agents =
        agentIds.length === 0
          ? []
          : await ctx.prisma.agent.findMany({
              where: { id: { in: agentIds } },
              select: { id: true, name: true, tier: true, autoName: true, model: true },
            });
      const byId = new Map(agents.map((a) => [a.id, a]));
      return {
        total: rows.length,
        enabledCount: rows.filter((r) => r.enabled).length,
        items: rows.map((r) => {
          const a = byId.get(r.agentId);
          return {
            ...r,
            agentName: a?.autoName?.trim() || a?.name || r.agentId.slice(0, 8),
            agentTier: a?.tier ?? null,
            agentModel: a?.model ?? null,
          };
        }),
      };
    }),
  upsert: publicProcedure
    .meta({ description: "创建或更新 Agent Cron（同 agentId+name upsert）。", aiReadable: true })
    .input(upsertAgentCronSchema)
    .mutation(async ({ ctx, input }) => {
      const cronMod = await import("node-cron");
      const cronValidate = cronMod.default?.validate ?? cronMod.validate;
      if (!cronValidate(input.cron)) {
        throw new Error(`非法 cron 表达式：${input.cron}`);
      }
      const agent = await ctx.prisma.agent.findUnique({
        where: { id: input.agentId },
        select: { id: true, tier: true, status: true },
      });
      if (!agent || agent.status === "deleted") throw new Error("目标 Agent 不存在");
      if (agent.tier === "sub") throw new Error("不能给子 Agent 设置 cron");

      const { ensureAgentCronJobTable, upsertCronJob } = await import("../agentCronStore.js");
      await ensureAgentCronJobTable(ctx.prisma);
      const row = await upsertCronJob(ctx.prisma, {
        agentId: input.agentId,
        name: input.name,
        cron: input.cron,
        prompt: input.prompt,
        busPath: input.busPath === undefined ? null : input.busPath,
        enabled: input.enabled,
      });
      const { getAgentCronEngine } = await import("../agentCronEngine.js");
      await getAgentCronEngine(ctx.prisma, ctx.services, ctx.config).refreshAgent(input.agentId);
      const { notifyCronJobUpdated } = await import("../uiStateNotify.js");
      await notifyCronJobUpdated(ctx.prisma, row);
      return { success: true as const, job: row };
    }),
  setEnabled: publicProcedure
    .meta({ description: "启用/暂停一条 Agent Cron。", aiReadable: true })
    .input(setAgentCronEnabledSchema)
    .mutation(async ({ ctx, input }) => {
      const { ensureAgentCronJobTable, setCronJobEnabled } = await import("../agentCronStore.js");
      await ensureAgentCronJobTable(ctx.prisma);
      const row = await setCronJobEnabled(ctx.prisma, input.id, input.enabled);
      if (!row) throw new Error("cron 任务不存在");
      const { getAgentCronEngine } = await import("../agentCronEngine.js");
      await getAgentCronEngine(ctx.prisma, ctx.services, ctx.config).refreshAgent(row.agentId);
      const { notifyCronJobUpdated } = await import("../uiStateNotify.js");
      await notifyCronJobUpdated(ctx.prisma, row);
      return { success: true as const, job: row };
    }),
  clear: publicProcedure
    .meta({ description: "删除 Agent Cron（id 或 agentId+name）。", aiReadable: true })
    .input(clearAgentCronSchema)
    .mutation(async ({ ctx, input }) => {
      const { ensureAgentCronJobTable, deleteCronJob, getCronJobById, getCronJobByName } =
        await import("../agentCronStore.js");
      await ensureAgentCronJobTable(ctx.prisma);
      let agentId = input.agentId;
      let deletedJobId = input.id;
      let deletedName = input.name;
      if (input.id) {
        const existing = await getCronJobById(ctx.prisma, input.id);
        agentId = existing?.agentId ?? agentId;
        deletedName = existing?.name ?? deletedName;
      } else if (input.agentId && input.name) {
        const byName = await getCronJobByName(ctx.prisma, input.agentId, input.name);
        deletedJobId = byName?.id;
        agentId = byName?.agentId ?? agentId;
      }
      const { deleted } = await deleteCronJob(ctx.prisma, {
        id: input.id,
        agentId: input.id ? undefined : input.agentId,
        name: input.id ? undefined : input.name,
      });
      if (agentId) {
        const { getAgentCronEngine } = await import("../agentCronEngine.js");
        await getAgentCronEngine(ctx.prisma, ctx.services, ctx.config).refreshAgent(agentId);
        const { notifyCronJobUpdated } = await import("../uiStateNotify.js");
        await notifyCronJobUpdated(ctx.prisma, {
          id: deletedJobId ?? "deleted",
          agentId,
          name: deletedName,
          lastRunStatus: "cancelled",
        });
      }
      return { success: true as const, deleted };
    }),
  fire: publicProcedure
    .meta({ description: "立即手动触发一条 Agent Cron（测试用）。", aiReadable: false })
    .input(fireAgentCronSchema)
    .mutation(async ({ ctx, input }) => {
      const { ensureAgentCronJobTable, getCronJobById } = await import("../agentCronStore.js");
      await ensureAgentCronJobTable(ctx.prisma);
      const row = await getCronJobById(ctx.prisma, input.id);
      if (!row) throw new Error("cron 任务不存在");
      if (!row.enabled) throw new Error("任务已暂停，请先启用再触发");
      const { getAgentCronEngine } = await import("../agentCronEngine.js");
      const result = await getAgentCronEngine(ctx.prisma, ctx.services, ctx.config).fire(row.id);
      if (result.error) throw new Error(result.error);
      return { success: true as const, sessionId: result.sessionId };
    }),
});

