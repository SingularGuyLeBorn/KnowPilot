/**
 * native:agent_notify_parent — 子 Agent 主动向父会话发送通知。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import { resetSwarmBus } from "../infra/swarmBus.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

interface NotifyFixture {
  parentAgentId: string;
  subAgentId: string;
  parentSessionId: string;
  subSessionId: string;
}

async function createNotifyFixture(ctx: Ctx): Promise<NotifyFixture> {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const parent = await ctx.services.agent.create({
    name: `Notify父Agent-${suffix}`,
    model: "deepseek-chat",
    systemPrompt: "test parent",
    tools: [],
    tier: "manager",
  });
  const parentAgentId = (parent.data as { id: string }).id;

  const sub = await ctx.services.agent.create({
    name: `Notify子Agent-${suffix}`,
    model: "deepseek-chat",
    systemPrompt: "test sub",
    tools: [],
    tier: "sub",
    parentId: parentAgentId,
  });
  const subAgentId = (sub.data as { id: string }).id;

  const parentSession = await ctx.services.session.create({
    title: "Notify 父会话",
    model: "deepseek-chat",
    agentId: parentAgentId,
  } as any);
  const parentSessionId = (parentSession.data as { id: string }).id;

  const subSession = await ctx.services.session.create({
    title: "Notify 子主会话",
    model: "deepseek-chat",
    agentId: subAgentId,
    isMainSession: true,
    kind: "subagent",
    parentSessionId,
  } as any);
  const subSessionId = (subSession.data as { id: string }).id;

  return { parentAgentId, subAgentId, parentSessionId, subSessionId };
}

async function cleanupNotifyFixture(fx: NotifyFixture) {
  await prisma.sessionQueueItem.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.chatMessage.deleteMany({
    where: { sessionId: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.chatSession.deleteMany({
    where: { id: { in: [fx.parentSessionId, fx.subSessionId] } },
  }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: { in: [fx.subAgentId, fx.parentAgentId] } } }).catch(() => {});
}

function makeNotifyCtx(ctx: Ctx, fx: NotifyFixture, tier: "sub" | "manager" = "sub") {
  return {
    ...ctx,
    sessionId: fx.subSessionId,
    agentSnapshot: {
      id: tier === "sub" ? fx.subAgentId : fx.parentAgentId,
      model: "deepseek-chat",
      systemPrompt: "test",
      tools: [],
      tier,
      workspaceId: null,
      parentId: tier === "sub" ? fx.parentAgentId : null,
    },
    invokeTrpc: async () => ({ ok: true }),
  };
}

describe("native:agent_notify_parent", () => {
  beforeEach(() => {
    resetSwarmBus();
  });

  afterEach(() => {
    vi.restoreAllMocks?.();
  });

  it("子 Agent 向父会话发送通知，创建 child_notify 队列项", async () => {
    const ctx = await createContextInner();
    const fx = await createNotifyFixture(ctx);
    try {
      const result = (await executeNativeTool(
        "agent_notify_parent",
        { content: "进度更新：任务已完成 50%" },
        makeNotifyCtx(ctx, fx, "sub"),
      )) as { success?: boolean; queued?: boolean; parentSessionId?: string; error?: string };

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.queued).toBe(true);
      expect(result.parentSessionId).toBe(fx.parentSessionId);

      const items = await ctx.services.sessionQueueItem.listBySession(fx.parentSessionId);
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe("child_notify");
      expect(items[0].content).toBe("进度更新：任务已完成 50%");
      expect(items[0].source).toBe(fx.subAgentId);
    } finally {
      await cleanupNotifyFixture(fx);
    }
  });

  it("非 sub 层级调用被拒绝", async () => {
    const ctx = await createContextInner();
    const fx = await createNotifyFixture(ctx);
    try {
      const result = (await executeNativeTool(
        "agent_notify_parent",
        { content: "通知" },
        makeNotifyCtx(ctx, fx, "manager"),
      )) as { error?: string; permissionDenied?: boolean };

      expect(result.error).toContain("TIER_INSUFFICIENT");
      expect(result.permissionDenied).toBe(true);
    } finally {
      await cleanupNotifyFixture(fx);
    }
  });

  it("子会话未绑定父会话时拒绝", async () => {
    const ctx = await createContextInner();
    const fx = await createNotifyFixture(ctx);
    try {
      // 把 ctx.sessionId 换成一个没有 parentSessionId 的会话
      const orphanSession = await ctx.services.session.create({
        title: "Orphan 子会话",
        model: "deepseek-chat",
        agentId: fx.subAgentId,
        isMainSession: false,
        kind: "subagent",
      } as any);
      const orphanSessionId = (orphanSession.data as { id: string }).id;

      const result = (await executeNativeTool(
        "agent_notify_parent",
        { content: "通知" },
        {
          ...makeNotifyCtx(ctx, fx, "sub"),
          sessionId: orphanSessionId,
        },
      )) as { error?: string };

      expect(result.error).toContain("parentSessionId");
    } finally {
      await cleanupNotifyFixture(fx);
    }
  });

  it("目标父会话已归档时拒绝", async () => {
    const ctx = await createContextInner();
    const fx = await createNotifyFixture(ctx);
    try {
      await ctx.services.session.update({ id: fx.parentSessionId, status: "archived" } as any);

      const result = (await executeNativeTool(
        "agent_notify_parent",
        { content: "通知" },
        makeNotifyCtx(ctx, fx, "sub"),
      )) as { error?: string };

      expect(result.error).toContain("归档");
    } finally {
      await cleanupNotifyFixture(fx);
    }
  });
});
