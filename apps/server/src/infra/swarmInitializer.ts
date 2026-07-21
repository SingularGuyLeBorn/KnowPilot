/**
 * SwarmInitializer — 服务器启动时自动初始化 Swarm 结构
 *
 * 首次启动 / 幂等修复：
 * 1. Root Workspace（systemType=super）+ 超级 Agent + 主 session
 * 2. Assistant Home Workspace（systemType=assistant）+ 默认 assistant 绑定
 */

import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import type { AppConfig } from "./config.js";
import { resolveSafePath } from "./safePath.js";
import {
  ASSISTANT_DEFAULT_TOOLS,
  DEFAULT_LLM_MODEL,
  TIER_DEFAULT_TOOLS,
} from "@knowpilot/shared";
import { createAgentForTier } from "./agentFactory.js";
import { ensureMainSession } from "./ensureMainSession.js";
import { DEFAULT_ASSISTANT_SYSTEM_PROMPT } from "./agentResolver.js";

/** 存量超级 Agent 补齐缺失的默认工具（幂等；含飞书/语雀/GitHub） */
function mergeMissingSuperTools(existingTools: string): { tools: string; added: string[] } {
  const current = existingTools
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set(current);
  const added: string[] = [];
  for (const t of TIER_DEFAULT_TOOLS.super) {
    if (!seen.has(t)) {
      current.push(t);
      seen.add(t);
      added.push(t);
    }
  }
  return { tools: current.join(","), added };
}

const SUPER_AGENT_NAME = "KnowPilot 超级 Agent";
/** Root Workspace：超级 Agent 归属 */
const SYSTEM_WORKSPACE_NAME = "KnowPilot Root";
const SYSTEM_WORKSPACE_PATH = "workspaces/__system__";
export const SYSTEM_WORKSPACE_TYPE_SUPER = "super";
/** Root 不限本空间槽（仍受全局 maxConcurrent）；业务空间默认 2 */
const ROOT_ASYNC_SLOT_QUOTA = 0;

/** 默认 assistant 的家 */
export const ASSISTANT_HOME_NAME = "KnowPilot Assistant";
const ASSISTANT_HOME_PATH = "workspaces/__assistant__";
export const SYSTEM_WORKSPACE_TYPE_ASSISTANT = "assistant";
const ASSISTANT_HOME_ASYNC_SLOT_QUOTA = 2;
const ASSISTANT_AGENT_NAME = "assistant";

async function ensureWorkspaceDir(config: AppConfig, relPath: string): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    const abs = resolveSafePath(config, relPath);
    await fs.mkdir(`${abs}/.knowpilot/shared/data`, { recursive: true });
    await fs.mkdir(`${abs}/.knowpilot/shared/scratch`, { recursive: true });
    await fs.writeFile(`${abs}/.knowpilot/state.json`, "{}");
  } catch (err) {
    console.warn(`[swarmInitializer] Workspace 目录创建失败 (${relPath}):`, err);
  }
}

/**
 * 确保 Root Workspace 存在。幂等。
 */
async function ensureSystemWorkspace(prisma: PrismaClient, config: AppConfig): Promise<string> {
  const existing = await prisma.workspace.findFirst({
    where: { isSystem: true, systemType: SYSTEM_WORKSPACE_TYPE_SUPER, status: { not: "deleted" } },
  });
  if (existing) {
    const row = existing as { id: string; name: string; asyncSlotQuota?: number };
    const patch: { name?: string; asyncSlotQuota?: number } = {};
    if (row.name !== SYSTEM_WORKSPACE_NAME) patch.name = SYSTEM_WORKSPACE_NAME;
    if (row.asyncSlotQuota !== ROOT_ASYNC_SLOT_QUOTA) patch.asyncSlotQuota = ROOT_ASYNC_SLOT_QUOTA;
    if (Object.keys(patch).length > 0) {
      await prisma.workspace.update({ where: { id: existing.id }, data: patch as any });
    }
    return existing.id;
  }

  await ensureWorkspaceDir(config, SYSTEM_WORKSPACE_PATH);

  const created = await prisma.workspace.create({
    data: {
      name: SYSTEM_WORKSPACE_NAME,
      description: "KnowPilot Root Workspace：超级 Agent 归属；全局编排与跨空间协调从这里发生。",
      path: SYSTEM_WORKSPACE_PATH,
      isSystem: true,
      systemType: SYSTEM_WORKSPACE_TYPE_SUPER,
      asyncSlotQuota: ROOT_ASYNC_SLOT_QUOTA,
      status: "active",
    } as any,
  });

  console.log(`  📁 [Swarm] 已自动创建 Root Workspace：${created.name} (${created.id})`);
  return created.id;
}

/**
 * 确保 Assistant Home Workspace 存在。幂等，返回 workspaceId。
 */
export async function ensureAssistantWorkspace(
  prisma: PrismaClient,
  config: AppConfig,
): Promise<string> {
  const existing = await prisma.workspace.findFirst({
    where: {
      isSystem: true,
      systemType: SYSTEM_WORKSPACE_TYPE_ASSISTANT,
      status: { not: "deleted" },
    },
  });
  if (existing) {
    const row = existing as { id: string; name: string; asyncSlotQuota?: number };
    const patch: { name?: string; asyncSlotQuota?: number } = {};
    if (row.name !== ASSISTANT_HOME_NAME) patch.name = ASSISTANT_HOME_NAME;
    if (row.asyncSlotQuota !== ASSISTANT_HOME_ASYNC_SLOT_QUOTA) {
      patch.asyncSlotQuota = ASSISTANT_HOME_ASYNC_SLOT_QUOTA;
    }
    if (Object.keys(patch).length > 0) {
      await prisma.workspace.update({ where: { id: existing.id }, data: patch as any });
    }
    return existing.id;
  }

  await ensureWorkspaceDir(config, ASSISTANT_HOME_PATH);

  const created = await prisma.workspace.create({
    data: {
      name: ASSISTANT_HOME_NAME,
      description:
        "KnowPilot Assistant Home：默认助手归属。可重置会话与助手配置；不可删除。长期记忆与 pinned 不受重置影响。",
      path: ASSISTANT_HOME_PATH,
      isSystem: true,
      systemType: SYSTEM_WORKSPACE_TYPE_ASSISTANT,
      asyncSlotQuota: ASSISTANT_HOME_ASYNC_SLOT_QUOTA,
      status: "active",
    } as any,
  });

  console.log(`  📁 [Swarm] 已自动创建 Assistant Home：${created.name} (${created.id})`);
  return created.id;
}

async function findDefaultAssistant(prisma: PrismaClient) {
  const byName = await prisma.agent.findFirst({
    where: { name: ASSISTANT_AGENT_NAME, status: { not: "deleted" } },
  });
  if (byName) return byName;
  return prisma.agent.findFirst({
    where: {
      name: { contains: "assistant" },
      tier: "manager",
      status: { not: "deleted" },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * 把默认 assistant 绑到 Assistant Home（幂等）。
 * 若尚无 assistant，不在此创建（由 resolveAgent 首次对话时创建并绑 home）。
 */
export async function bindAssistantToHome(
  prisma: PrismaClient,
  assistantHomeId: string,
): Promise<{ agentId: string | null; bound: boolean }> {
  const assistant = await findDefaultAssistant(prisma);
  if (!assistant) return { agentId: null, bound: false };

  let bound = false;
  if (assistant.workspaceId !== assistantHomeId) {
    await prisma.agent.update({
      where: { id: assistant.id },
      data: { workspaceId: assistantHomeId },
    });
    bound = true;
  }

  const home = await prisma.workspace.findUnique({ where: { id: assistantHomeId } });
  if (home && home.managerAgentId !== assistant.id) {
    await prisma.workspace.update({
      where: { id: assistantHomeId },
      data: { managerAgentId: assistant.id },
    });
    bound = true;
  }

  if (bound) {
    console.log(`  🔗 [Swarm] 已把默认 assistant 关联到 Assistant Home`);
  }
  return { agentId: assistant.id, bound };
}

export type ResetAssistantHomeResult = {
  workspaceId: string;
  agentId: string;
  sessionsArchived: number;
  queueItemsDeleted: number;
  agentConfigReset: boolean;
};

/**
 * 重置 Assistant Home：
 * - 归档该助手下非已归档会话；删除其 SessionQueueItem
 * - 助手 tools / systemPrompt / tier 恢复内置默认
 * - 不动 Memory / pinned
 * - 保留主 session 行但归档后新建一条主 session（保证可继续聊）
 */
export async function resetAssistantHome(
  prisma: PrismaClient,
  config: AppConfig,
  services?: ServiceContainer,
): Promise<ResetAssistantHomeResult> {
  const workspaceId = await ensureAssistantWorkspace(prisma, config);
  const { agentId } = await bindAssistantToHome(prisma, workspaceId);
  if (!agentId) {
    throw new Error("未找到默认 assistant，无法重置。请先打开一次 Chat 以创建助手。");
  }

  const sessions = await prisma.chatSession.findMany({
    where: { agentId, status: { not: "archived" } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);

  let queueItemsDeleted = 0;
  if (sessionIds.length > 0) {
    const del = await prisma.sessionQueueItem.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    queueItemsDeleted = del.count;
  }

  // 归档全部活跃会话，并摘掉 isMainSession，以便 ensureMainSession 新建干净主会话
  const archived = await prisma.chatSession.updateMany({
    where: { agentId, status: { not: "archived" } },
    data: { status: "archived", isMainSession: false },
  });

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (services?.agent?.update) {
    await services.agent.update({
      id: agentId,
      tools: [...ASSISTANT_DEFAULT_TOOLS],
      systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
      tier: "manager",
      workspaceId,
      description: "KnowPilot 默认助手",
    });
  } else {
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        tools: ASSISTANT_DEFAULT_TOOLS.join(","),
        systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
        tier: "manager",
        workspaceId,
        description: "KnowPilot 默认助手",
      },
    });
  }

  await ensureMainSession(prisma, {
    agentId,
    title: `${ASSISTANT_AGENT_NAME} 主会话`,
    model: agent?.model ?? config.llm.defaultModel ?? DEFAULT_LLM_MODEL,
  });

  return {
    workspaceId,
    agentId,
    sessionsArchived: archived.count,
    queueItemsDeleted,
    agentConfigReset: true,
  };
}

/**
 * 启动时初始化 Swarm（幂等）。
 */
export async function initSwarm(
  prisma: PrismaClient,
  services?: ServiceContainer,
  config?: AppConfig,
): Promise<void> {
  if (!config) return;

  const systemWorkspaceId = await ensureSystemWorkspace(prisma, config);

  const existing = await prisma.agent.findFirst({
    where: { tier: "super", status: { not: "deleted" } },
  });

  if (existing) {
    if (!existing.workspaceId || existing.workspaceId !== systemWorkspaceId) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: { workspaceId: systemWorkspaceId },
      });
      await prisma.workspace.update({
        where: { id: systemWorkspaceId },
        data: { managerAgentId: existing.id },
      });
      console.log(`  🔗 [Swarm] 已把超级 Agent 关联到系统 Workspace`);
    }
    const { tools, added } = mergeMissingSuperTools(existing.tools ?? "");
    if (added.length > 0) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: { tools },
      });
      console.log(
        `  🔧 [Swarm] 超级 Agent 已补齐 ${added.length} 个工具（飞书/语雀/GitHub 等）`,
      );
    }
    await ensureMainSession(prisma, {
      agentId: existing.id,
      title: `${SUPER_AGENT_NAME} 主会话`,
      model: existing.model ?? config.llm.defaultModel ?? DEFAULT_LLM_MODEL,
    });
  } else {
    const superAgent = await createAgentForTier(prisma, {
      tier: "super",
      name: SUPER_AGENT_NAME,
      overrides: {
        model: config.llm.defaultModel ?? DEFAULT_LLM_MODEL,
        workspaceId: systemWorkspaceId,
      },
    });

    await prisma.workspace.update({
      where: { id: systemWorkspaceId },
      data: { managerAgentId: superAgent.id },
    });

    await ensureMainSession(prisma, {
      agentId: superAgent.id,
      title: `${SUPER_AGENT_NAME} 主会话`,
      model: superAgent.model,
    });

    console.log("  👑 [Swarm] 已自动创建超级 Agent（首次启动）并关联系统 Workspace");
  }

  // Assistant Home：与 Root 对称，每次启动保证存在并绑定默认助手
  const assistantHomeId = await ensureAssistantWorkspace(prisma, config);
  await bindAssistantToHome(prisma, assistantHomeId);
  void services;
}
