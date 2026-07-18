/**
 * Assistant Home：系统 Workspace 初始化 / 禁删 / 重置（不动记忆）
 */
import { describe, it, expect } from "vitest";
import { prisma } from "../db.js";
import { ASSISTANT_DEFAULT_TOOLS } from "@knowpilot/shared";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";
import {
  ASSISTANT_HOME_NAME,
  SYSTEM_WORKSPACE_TYPE_ASSISTANT,
  bindAssistantToHome,
  ensureAssistantWorkspace,
  resetAssistantHome,
} from "../infra/swarmInitializer.js";

const config = getAppConfig();
const services = getServiceContainer(prisma, getEventBus(), config);

describe("Assistant Home Workspace", () => {
  it("ensureAssistantWorkspace 幂等且 isSystem", async () => {
    const id1 = await ensureAssistantWorkspace(prisma, config);
    const id2 = await ensureAssistantWorkspace(prisma, config);
    expect(id1).toBe(id2);
    const row = await prisma.workspace.findUnique({ where: { id: id1 } });
    expect(row?.isSystem).toBe(true);
    expect(row?.systemType).toBe(SYSTEM_WORKSPACE_TYPE_ASSISTANT);
    expect(row?.name).toBe(ASSISTANT_HOME_NAME);
  });

  it("系统 Workspace 不可删除", async () => {
    const homeId = await ensureAssistantWorkspace(prisma, config);
    const del = await services.workspace.delete(homeId);
    expect(del.success).toBe(false);
    expect(del.error?.code).toBe("SYSTEM_WORKSPACE_NOT_DELETABLE");
  });

  it("resetAssistantHome 归档会话、恢复工具清单、不动记忆", async () => {
    const homeId = await ensureAssistantWorkspace(prisma, config);

    // 清理同名测试残留
    const old = await prisma.agent.findMany({
      where: { name: "assistant", status: { not: "deleted" } },
    });
    for (const a of old) {
      await prisma.sessionQueueItem.deleteMany({
        where: { session: { agentId: a.id } },
      });
      await prisma.chatSession.deleteMany({ where: { agentId: a.id } });
    }

    const agent = await prisma.agent.create({
      data: {
        name: "assistant",
        description: "tmp",
        model: "deepseek-v4-flash",
        systemPrompt: "custom prompt should be wiped",
        tools: "native:web_search",
        tier: "manager",
        workspaceId: homeId,
      },
    });
    await bindAssistantToHome(prisma, homeId);

    const session = await prisma.chatSession.create({
      data: {
        title: `asst-home-reset-${Date.now()}`,
        agentId: agent.id,
        model: "deepseek-v4-flash",
        status: "active",
        isMainSession: true,
      },
    });
    await prisma.sessionQueueItem.create({
      data: {
        sessionId: session.id,
        kind: "user",
        content: "hello",
        source: "user",
        order: 0,
      },
    });

    const mem = await prisma.memory.create({
      data: {
        content: `用户喜欢中文-${Date.now()}`,
        type: "preference",
        scope: "global",
        attribution: "user",
        status: "active",
        keywords: "lang",
      },
    });

    try {
      const result = await resetAssistantHome(prisma, config, services);
      expect(result.agentId).toBe(agent.id);
      expect(result.sessionsArchived).toBeGreaterThanOrEqual(1);
      expect(result.queueItemsDeleted).toBeGreaterThanOrEqual(1);

      const refreshed = await prisma.agent.findUnique({ where: { id: agent.id } });
      expect(refreshed?.systemPrompt).not.toContain("custom prompt should be wiped");
      const tools = (refreshed?.tools ?? "").split(",").filter(Boolean);
      for (const t of ASSISTANT_DEFAULT_TOOLS) {
        expect(tools).toContain(t);
      }

      const memStill = await prisma.memory.findUnique({ where: { id: mem.id } });
      expect(memStill?.content).toBe(mem.content);

      const queueLeft = await prisma.sessionQueueItem.count({
        where: { sessionId: session.id },
      });
      expect(queueLeft).toBe(0);

      const main = await prisma.chatSession.findFirst({
        where: { agentId: agent.id, isMainSession: true, status: { not: "archived" } },
      });
      expect(main).toBeTruthy();
    } finally {
      await prisma.memory.delete({ where: { id: mem.id } }).catch(() => undefined);
    }
  });
});
