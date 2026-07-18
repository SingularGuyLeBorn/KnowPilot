/**
 * ensureMainSession：每 Agent 一条主会话；AgentService.create 后必有主会话。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { ensureMainSession } from "../infra/ensureMainSession.js";
import { createAgentForTier } from "../infra/agentFactory.js";

const services = getServiceContainer(prisma, getEventBus(), getAppConfig());

describe("ensureMainSession", () => {
  beforeEach(async () => {
    await prisma.chatMessage.deleteMany();
    await prisma.chatSession.deleteMany();
    await prisma.agent.deleteMany({ where: { name: { startsWith: "E2E-MainSess-" } } });
  });

  it("幂等：同一 Agent 只创建一条 isMainSession", async () => {
    const agent = await prisma.agent.create({
      data: {
        name: `E2E-MainSess-${Date.now()}`,
        model: "deepseek-v4-flash",
        systemPrompt: "t",
        tools: "",
        tier: "sub",
        status: "active",
      },
    });
    const a = await ensureMainSession(prisma, {
      agentId: agent.id,
      title: "主会话 A",
      model: agent.model,
    });
    expect(a.created).toBe(true);
    const b = await ensureMainSession(prisma, {
      agentId: agent.id,
      title: "主会话 B",
      model: agent.model,
    });
    expect(b.created).toBe(false);
    expect(b.session.id).toBe(a.session.id);
    const count = await prisma.chatSession.count({
      where: { agentId: agent.id, isMainSession: true, status: { not: "deleted" } },
    });
    expect(count).toBe(1);
  });

  it("AgentService.create 后自动有主会话", async () => {
    const name = `E2E-MainSess-svc-${Date.now()}`;
    const res = await services.agent.create({
      name,
      model: "deepseek-v4-flash",
      systemPrompt: "test",
      tools: [],
      tier: "sub",
    });
    expect(res.success).toBe(true);
    const agentId = res.data!.id;
    const main = await prisma.chatSession.findFirst({
      where: { agentId, isMainSession: true, status: { not: "deleted" } },
    });
    expect(main).toBeTruthy();
    expect(main!.title).toContain("主会话");
  });

  it("createAgentForTier 后自动有主会话", async () => {
    const agent = await createAgentForTier(prisma, {
      tier: "sub",
      name: `E2E-MainSess-factory-${Date.now()}`,
    });
    const main = await prisma.chatSession.findFirst({
      where: { agentId: agent.id, isMainSession: true, status: { not: "deleted" } },
    });
    expect(main).toBeTruthy();
  });
});
