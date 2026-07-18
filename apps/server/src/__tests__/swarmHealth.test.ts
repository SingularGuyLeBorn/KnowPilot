/**
 * Swarm 健康快照 / 告警聚合 — 只读通道防线
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../db.js";
import {
  __resetAskUserGateForTests,
  createAskUserPending,
} from "../infra/askUserGate.js";
import {
  __resetNotifyBreakersForTests,
  sendEmailNotification,
} from "../infra/emailNotifier.js";
import {
  buildSwarmBrief,
  getSwarmAlertsOverview,
  getSwarmHealthSnapshot,
} from "../infra/swarmHealth.js";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import type { AppConfig } from "../infra/config.js";

const RUN = `sw${Date.now().toString(36)}`;

describe("swarmHealth 快照与告警", () => {
  afterEach(() => {
    __resetAskUserGateForTests();
    __resetNotifyBreakersForTests();
  });

  it("getSwarmHealthSnapshot：inbox / ask_user / needsAttention", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `SwarmH-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "manager",
    } as any);
    const agentId = (agent.data as { id: string }).id;
    const session = await ctx.services.session.create({
      title: "swarm-h",
      model: "deepseek-chat",
      agentId,
    } as any);
    const sessionId = (session.data as { id: string }).id;

    try {
      await prisma.agentMessage.create({
        data: {
          fromAgentId: agentId,
          toAgentId: agentId,
          content: "ping",
          status: "pending",
        },
      });
      await createAskUserPending({
        sessionId,
        question: "健康快照可见吗？",
        channel: "ui",
        agentId,
        config: ctx.config as AppConfig,
      });

      const snap = await getSwarmHealthSnapshot(prisma, agentId);
      expect(snap.inbox.pending).toBeGreaterThanOrEqual(1);
      expect(snap.inbox.preview.some((p) => p.content.includes("ping"))).toBe(true);
      expect(snap.askUserPending.some((a) => a.question.includes("健康快照"))).toBe(true);
      expect(snap.needsAttention).toBe(true);

      const viaTrpc = await appRouter.createCaller(ctx).agent.swarmHealth({ agentId });
      expect(viaTrpc.agentId).toBe(agentId);
      expect(viaTrpc.needsAttention).toBe(true);
    } finally {
      await prisma.askUserRequest.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.agentMessage.deleteMany({ where: { toAgentId: agentId } }).catch(() => {});
      await prisma.chatMessage.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => {});
    }
  });

  it("getSwarmAlertsOverview / agent.swarmAlerts：聚合 ask_user", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `SwarmA-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "manager",
    } as any);
    const agentId = (agent.data as { id: string }).id;
    const session = await ctx.services.session.create({
      title: "swarm-a",
      model: "deepseek-chat",
      agentId,
    } as any);
    const sessionId = (session.data as { id: string }).id;

    try {
      await createAskUserPending({
        sessionId,
        question: "告警横幅要显示吗？",
        channel: "email",
        agentId,
        config: ctx.config as AppConfig,
      });

      const overview = await getSwarmAlertsOverview(prisma);
      expect(overview.askUserPendingCount).toBeGreaterThanOrEqual(1);
      expect(overview.needsAttention).toBe(true);
      expect(overview.askUserSamples.some((s) => s.question.includes("告警横幅"))).toBe(true);

      const viaTrpc = await appRouter.createCaller(ctx).agent.swarmAlerts();
      expect(viaTrpc.askUserPendingCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(viaTrpc.notifyChannels)).toBe(true);
    } finally {
      await prisma.askUserRequest.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.chatMessage.deleteMany({ where: { sessionId } }).catch(() => {});
      await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => {});
    }
  });

  it("通知通道熔断会进入 swarmAlerts", async () => {
    process.env.NTFY_TOPIC = "kp-alert-breaker";
    process.env.EMAIL_PROVIDER = "none";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("fail", { status: 503 })),
    );
    try {
      for (let i = 0; i < 3; i++) {
        await sendEmailNotification({ emailProvider: "none" } as AppConfig, undefined, {
          subject: `b-${i}`,
          body: "x",
        });
      }
      const overview = await getSwarmAlertsOverview(prisma);
      expect(overview.notifyChannels.some((c) => c.channel === "ntfy" && c.state === "open")).toBe(
        true,
      );
      expect(overview.needsAttention).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.NTFY_TOPIC;
      delete process.env.EMAIL_PROVIDER;
    }
  });

  it("buildSwarmBrief 产出 markdown 与需关注段落", async () => {
    const ctx = await createContextInner();
    const agent = await ctx.services.agent.create({
      name: `SwarmB-${RUN}`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "manager",
    } as any);
    const agentId = (agent.data as { id: string }).id;
    try {
      await prisma.agentMessage.create({
        data: {
          fromAgentId: agentId,
          toAgentId: agentId,
          content: "请优先处理积压",
          status: "pending",
        },
      });
      const brief = await buildSwarmBrief(prisma, { limit: 20 });
      expect(brief.markdown).toContain("Swarm 简报");
      expect(brief.markdown).toContain("需关注");
      expect(brief.agents.some((a) => a.agentId === agentId && a.needsAttention)).toBe(true);
    } finally {
      await prisma.agentMessage.deleteMany({ where: { toAgentId: agentId } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { id: agentId } }).catch(() => {});
    }
  });
});
