/**
 * Agent 自设 cron：权限 + 点火新建 kind=cron 会话
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import {
  __resetAgentCronEngineForTests,
  getAgentCronEngine,
} from "../infra/agentCronEngine.js";
import {
  deleteCronJob,
  ensureAgentCronJobTable,
  listCronJobs,
  upsertCronJob,
} from "../infra/agentCronStore.js";
import {
  SwarmOrchestrator,
  resetSwarmOrchestratorForTests,
} from "../infra/swarmOrchestrator.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { getAppConfig } from "../infra/config.js";
import { setStreamHub } from "../infra/sessionStreamHub.js";
import { readGoalStateRaw } from "../infra/goalLoop.js";
import type { NativeToolContext } from "../infra/tools/native/types.js";

const CRON_TOOLS = [
  "native:agent_cron_set",
  "native:agent_cron_list",
  "native:agent_cron_clear",
  "native:session_spawn_goal",
] as const;

async function createAgent(
  ctx: Awaited<ReturnType<typeof createContextInner>>,
  data: { name: string; tier: "manager" | "sub"; parentId?: string },
): Promise<{ id: string; tier: string }> {
  const result = await ctx.services.agent.create({
    name: data.name,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [...CRON_TOOLS],
    tier: data.tier,
    parentId: data.parentId,
  });
  if (!result.success) throw new Error(result.error?.message ?? "create agent failed");
  return { id: (result.data as { id: string }).id, tier: data.tier };
}

function toolCtx(
  ctx: Awaited<ReturnType<typeof createContextInner>>,
  agent: { id: string; tier: string },
): NativeToolContext {
  return {
    config: getAppConfig(),
    services: ctx.services,
    invokeTrpc: async () => null,
    agentSnapshot: {
      id: agent.id,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [...CRON_TOOLS],
      tier: agent.tier,
      workspaceId: null,
      parentId: null,
    },
  };
}

async function cleanup(...agentIds: string[]) {
  if (agentIds.length === 0) return;
  const placeholders = agentIds.map(() => "?").join(",");
  await prisma
    .$executeRawUnsafe(`DELETE FROM AgentCronJob WHERE agentId IN (${placeholders})`, ...agentIds)
    .catch(() => {});
  await prisma.task.deleteMany({ where: { name: { contains: "[cron]" } } });
  await prisma.chatSession.deleteMany({ where: { agentId: { in: agentIds } } });
  // 超级 Agent 不可删
  const deletable = (
    await prisma.agent.findMany({
      where: { id: { in: agentIds }, tier: { not: "super" } },
      select: { id: true },
    })
  ).map((a) => a.id);
  if (deletable.length) {
    await prisma.agent.deleteMany({ where: { id: { in: deletable } } });
  }
}

describe("agentCron", () => {
  beforeEach(async () => {
    await ensureAgentCronJobTable(prisma);
    __resetAgentCronEngineForTests();
    resetSwarmOrchestratorForTests();
    resetAsyncJobOrchestratorForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setStreamHub(null);
    __resetAgentCronEngineForTests();
    resetSwarmOrchestratorForTests();
  });

  it("sub 禁止设置 cron；manager 只能设自己；super 可设他人；禁止给 sub 设", async () => {
    const ctx = await createContextInner();
    const suffix = `${Date.now()}`;
    // 权限只看 agentSnapshot.tier，不必在库里再造第二个 super
    const superSnap = { id: `cron-super-snap-${suffix}`, tier: "super" };
    const mgr = await createAgent(ctx, { name: `cron-mgr-${suffix}`, tier: "manager" });
    const mgr2 = await createAgent(ctx, { name: `cron-mgr2-${suffix}`, tier: "manager" });
    const sub = await createAgent(ctx, {
      name: `cron-sub-${suffix}`,
      tier: "sub",
      parentId: mgr.id,
    });

    try {
      const subOut = (await executeNativeTool(
        "agent_cron_set",
        {
          name: "daily",
          cron: "0 9 * * *",
          prompt: "搜集知乎面试题并写入 llm-interview 花园",
        },
        toolCtx(ctx, sub),
      )) as { error?: string };
      expect(subOut.error).toMatch(/TIER_INSUFFICIENT|子 Agent/);

      const cross = (await executeNativeTool(
        "agent_cron_set",
        {
          name: "daily",
          cron: "0 9 * * *",
          prompt: "搜集知乎面试题并写入 llm-interview 花园",
          agentId: mgr2.id,
        },
        toolCtx(ctx, mgr),
      )) as { error?: string };
      expect(cross.error).toMatch(/SELF_ONLY/);

      const selfOk = (await executeNativeTool(
        "agent_cron_set",
        {
          name: "daily-zhihu",
          cron: "0 9 * * *",
          prompt: "按知乎面经搜集 Prompt 完整执行并入库",
          busPath: "cron-bus/state.md",
        },
        toolCtx(ctx, mgr),
      )) as { success?: boolean };
      expect(selfOk.success).toBe(true);

      const superOk = (await executeNativeTool(
        "agent_cron_set",
        {
          name: "for-mgr2",
          cron: "30 8 * * *",
          prompt: "超级 Agent 代设：每日搜集面经并入库",
          agentId: mgr2.id,
        },
        toolCtx(ctx, superSnap),
      )) as { success?: boolean };
      expect(superOk.success).toBe(true);

      const toSub = (await executeNativeTool(
        "agent_cron_set",
        {
          name: "nope",
          cron: "0 9 * * *",
          prompt: "不应成功：目标是子 Agent",
          agentId: sub.id,
        },
        toolCtx(ctx, superSnap),
      )) as { error?: string };
      expect(toSub.error).toMatch(/子 Agent/);

      const listed = await listCronJobs(prisma, { agentId: mgr.id });
      expect(listed.some((r) => r.name === "daily-zhihu")).toBe(true);
    } finally {
      await cleanup(mgr.id, mgr2.id, sub.id);
    }
  });

  it("fire 每次新建 kind=cron 会话并注入详细 prompt", async () => {
    const ctx = await createContextInner();
    const suffix = `${Date.now()}`;
    const mgr = await createAgent(ctx, { name: `cron-fire-${suffix}`, tier: "manager" });

    const dispatchSpy = vi.spyOn(SwarmOrchestrator.prototype, "dispatch").mockResolvedValue({
      jobId: "mock-job",
      origin: "cron",
      status: "queued",
      deduped: false,
    });

    try {
      const row = await upsertCronJob(prisma, {
        agentId: mgr.id,
        name: "fire-once",
        cron: "0 9 * * *",
        prompt: "这是详细初始提示词：请只回复 cron-ok",
        enabled: true,
      });

      const engine = getAgentCronEngine(prisma, ctx.services, getAppConfig());
      const r1 = await engine.fire(row.id);
      expect(r1.error).toBeUndefined();
      expect(r1.sessionId).toBeTruthy();

      const s1 = await prisma.chatSession.findUnique({ where: { id: r1.sessionId! } });
      expect(s1?.kind).toBe("cron");
      expect(s1?.agentId).toBe(mgr.id);

      const msgs = await prisma.chatMessage.findMany({
        where: { sessionId: r1.sessionId! },
        orderBy: { createdAt: "asc" },
      });
      expect(msgs[0]?.role).toBe("user");
      expect(msgs[0]?.content).toContain("详细初始提示词");
      expect(msgs[0]?.content).toContain("fire-once");
      expect(msgs[0]?.content).toContain("session_spawn_goal");
      expect(msgs[0]?.content).toContain("Briefing");
      expect(dispatchSpy).toHaveBeenCalled();

      const r2 = await engine.fire(row.id);
      expect(r2.sessionId).toBeTruthy();
      expect(r2.sessionId).not.toBe(r1.sessionId);

      await deleteCronJob(prisma, { id: row.id });
    } finally {
      await cleanup(mgr.id);
    }
  });

  it("session_spawn_goal：sub 拒绝；manager 新建 chat+goal 并起流", async () => {
    const ctx = await createContextInner();
    const suffix = `${Date.now()}`;
    const mgr = await createAgent(ctx, { name: `spawn-goal-${suffix}`, tier: "manager" });
    const sub = await createAgent(ctx, {
      name: `spawn-sub-${suffix}`,
      tier: "sub",
      parentId: mgr.id,
    });

    const startIfNotRunning = vi.fn().mockResolvedValue("started");
    setStreamHub({
      startIfNotRunning,
      pushExternalEvent: vi.fn(),
      isRunning: () => false,
      stop: vi.fn(),
    } as never);

    try {
      const denied = (await executeNativeTool(
        "session_spawn_goal",
        {
          prompt: "完成知乎面经搜集并写入 llm-interview 花园，至少入库 3 题",
          model: "deepseek-chat",
        },
        toolCtx(ctx, sub),
      )) as { error?: string };
      expect(denied.error).toMatch(/TIER_INSUFFICIENT|子 Agent/);

      const out = (await executeNativeTool(
        "session_spawn_goal",
        {
          prompt: "完成知乎面经搜集并写入 llm-interview 花园，至少入库 3 题并更新首页",
          model: "deepseek-chat",
          mode: "goal",
          title: `goal-run-${suffix}`,
        },
        toolCtx(ctx, mgr),
      )) as {
        success?: boolean;
        newSessionId?: string;
        streamStarted?: boolean;
        goal?: { ok?: boolean };
      };
      expect(out.success).toBe(true);
      expect(out.newSessionId).toBeTruthy();
      expect(out.streamStarted).toBe(true);
      expect(startIfNotRunning).toHaveBeenCalled();

      const sess = await prisma.chatSession.findUnique({ where: { id: out.newSessionId! } });
      expect(sess?.kind).toBe("chat");
      expect(sess?.agentId).toBe(mgr.id);
      expect(sess?.model).toBe("deepseek-chat");
      expect(sess?.parentSessionId).toBeNull();

      const goal = await readGoalStateRaw(out.newSessionId!);
      expect(goal?.status).toBe("active");
      expect(goal?.mode).toBe("goal");
      expect(goal?.text).toContain("llm-interview");
      expect(goal?.execModel).toBe("deepseek-chat");
    } finally {
      await cleanup(mgr.id, sub.id);
    }
  });
});
