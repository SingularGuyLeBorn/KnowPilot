/**
 * SwarmInitializer — 服务器启动时自动初始化 Swarm 结构
 *
 * 首次启动：
 * 1. 如果不存在系统 Workspace，自动创建「KnowPilot 系统」Workspace。
 * 2. 如果不存在 super tier Agent，自动创建一个默认超级 Agent，并关联到系统 Workspace。
 * 3. 为超级 Agent 创建主 session。
 * 4. 若已有超级 Agent 但未关联系统 Workspace（旧数据迁移），自动修复关联。
 *
 * 超级 Agent 配置（#29）：
 *   - tier: "super"
 *   - workspaceId: 系统 Workspace id（UI 归属，不改变全局权限）
 *   - heartbeat: { enabled: true, cron: "0 9 * * *", goal: "检查所有 Workspace 状态..." }
 *   - systemPrompt: 默认超级 Agent 模板
 */

import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import type { AppConfig } from "./config.js";
import { resolveSafePath } from "./safePath.js";
import { DEFAULT_LLM_MODEL } from "@knowpilot/shared";
import { createAgentForTier } from "./agentFactory.js";

const SUPER_AGENT_NAME = "KnowPilot 超级 Agent";
const SYSTEM_WORKSPACE_NAME = "KnowPilot 系统";
const SYSTEM_WORKSPACE_PATH = "workspaces/__system__";
const SYSTEM_WORKSPACE_TYPE = "super";

/**
 * 确保系统 Workspace 存在。
 * 幂等：已存在则直接返回。
 */
async function ensureSystemWorkspace(prisma: PrismaClient, config: AppConfig): Promise<string> {
  const existing = await prisma.workspace.findFirst({
    where: { isSystem: true, systemType: SYSTEM_WORKSPACE_TYPE, status: { not: "deleted" } },
  });
  if (existing) return existing.id;

  // 创建系统 Workspace 的磁盘目录
  try {
    const fs = await import("node:fs/promises");
    const systemPath = resolveSafePath(config, SYSTEM_WORKSPACE_PATH);
    await fs.mkdir(`${systemPath}/.knowpilot/shared/data`, { recursive: true });
    await fs.mkdir(`${systemPath}/.knowpilot/shared/scratch`, { recursive: true });
    await fs.writeFile(`${systemPath}/.knowpilot/state.json`, "{}");
  } catch (err) {
    console.warn(`[swarmInitializer] 系统 Workspace 目录创建失败:`, err);
  }

  const created = await prisma.workspace.create({
    data: {
      name: SYSTEM_WORKSPACE_NAME,
      description: "KnowPilot 系统级 Workspace，容纳超级 Agent 及全局子 Agent。",
      path: SYSTEM_WORKSPACE_PATH,
      isSystem: true,
      systemType: SYSTEM_WORKSPACE_TYPE,
      status: "active",
    },
  });

  console.log(`  📁 [Swarm] 已自动创建系统 Workspace：${created.name} (${created.id})`);
  return created.id;
}

/**
 * 为指定 Agent 创建主 session（幂等：每个 Agent 只创建一个 isMainSession）。
 */
async function ensureMainSession(prisma: PrismaClient, agentId: string, title: string, model: string): Promise<void> {
  const existing = await prisma.chatSession.findFirst({
    where: { agentId, isMainSession: true, status: { not: "deleted" } },
  });
  if (existing) return;

  await prisma.chatSession.create({
    data: {
      title,
      model,
      agentId,
      isMainSession: true,
      status: "active",
    },
  });
}

/**
 * 启动时初始化 Swarm：
 * 1. 确保系统 Workspace 存在。
 * 2. 确保超级 Agent 存在并关联系统 Workspace。
 * 3. 确保超级 Agent 主 session 存在。
 *
 * 幂等：多次调用不会创建多个超级 Agent / 系统 Workspace。
 */
export async function initSwarm(
  prisma: PrismaClient,
  services?: ServiceContainer,
  config?: AppConfig,
): Promise<void> {
  const systemWorkspaceId =
    config && services ? await ensureSystemWorkspace(prisma, config) : undefined;

  const existing = await prisma.agent.findFirst({
    where: { tier: "super", status: { not: "deleted" } },
  });

  if (existing) {
    // 旧数据迁移：已有超级 Agent 但未关联系统 Workspace
    if (systemWorkspaceId && (!existing.workspaceId || existing.workspaceId !== systemWorkspaceId)) {
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
    await ensureMainSession(prisma, existing.id, `${SUPER_AGENT_NAME} 主会话`, existing.model ?? config?.llm.defaultModel ?? DEFAULT_LLM_MODEL);
    return;
  }

  // 创建新的超级 Agent（W9：默认值走 AgentFactory 模板 content/agents/_templates/super.md）
  const superAgent = await createAgentForTier(prisma, {
    tier: "super",
    name: SUPER_AGENT_NAME,
    overrides: {
      model: config?.llm.defaultModel ?? DEFAULT_LLM_MODEL,
      workspaceId: systemWorkspaceId ?? null,
    },
  });

  // 把超级 Agent 设为系统 Workspace 的管理 Agent
  if (systemWorkspaceId) {
    await prisma.workspace.update({
      where: { id: systemWorkspaceId },
      data: { managerAgentId: superAgent.id },
    });
  }

  await ensureMainSession(prisma, superAgent.id, `${SUPER_AGENT_NAME} 主会话`, superAgent.model);

  console.log("  👑 [Swarm] 已自动创建超级 Agent（首次启动）并关联系统 Workspace");
}
