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
import { ensureMainSession } from "./ensureMainSession.js";

const SUPER_AGENT_NAME = "KnowPilot 超级 Agent";
/** Root Workspace：超级 Agent 归属；UI/文档亦称「KnowPilot Root」 */
const SYSTEM_WORKSPACE_NAME = "KnowPilot Root";
const SYSTEM_WORKSPACE_PATH = "workspaces/__system__";
const SYSTEM_WORKSPACE_TYPE = "super";
/** Root 不限本空间槽（仍受全局 maxConcurrent）；业务空间默认 2 */
const ROOT_ASYNC_SLOT_QUOTA = 0;

/**
 * 确保系统 Workspace 存在。
 * 幂等：已存在则直接返回。
 */
async function ensureSystemWorkspace(prisma: PrismaClient, config: AppConfig): Promise<string> {
  const existing = await prisma.workspace.findFirst({
    where: { isSystem: true, systemType: SYSTEM_WORKSPACE_TYPE, status: { not: "deleted" } },
  });
  if (existing) {
    // 幂等修复：旧库名「KnowPilot 系统」→ Root；配额对齐
    const row = existing as { id: string; name: string; asyncSlotQuota?: number };
    const patch: { name?: string; asyncSlotQuota?: number } = {};
    if (row.name !== SYSTEM_WORKSPACE_NAME) patch.name = SYSTEM_WORKSPACE_NAME;
    if (row.asyncSlotQuota !== ROOT_ASYNC_SLOT_QUOTA) patch.asyncSlotQuota = ROOT_ASYNC_SLOT_QUOTA;
    if (Object.keys(patch).length > 0) {
      await prisma.workspace.update({ where: { id: existing.id }, data: patch as any });
    }
    return existing.id;
  }

  // 创建 Root Workspace 的磁盘目录
  try {
    const fs = await import("node:fs/promises");
    const systemPath = resolveSafePath(config, SYSTEM_WORKSPACE_PATH);
    await fs.mkdir(`${systemPath}/.knowpilot/shared/data`, { recursive: true });
    await fs.mkdir(`${systemPath}/.knowpilot/shared/scratch`, { recursive: true });
    await fs.writeFile(`${systemPath}/.knowpilot/state.json`, "{}");
  } catch (err) {
    console.warn(`[swarmInitializer] Root Workspace 目录创建失败:`, err);
  }

  const created = await prisma.workspace.create({
    data: {
      name: SYSTEM_WORKSPACE_NAME,
      description: "KnowPilot Root Workspace：超级 Agent 归属；全局编排与跨空间协调从这里发生。",
      path: SYSTEM_WORKSPACE_PATH,
      isSystem: true,
      systemType: SYSTEM_WORKSPACE_TYPE,
      asyncSlotQuota: ROOT_ASYNC_SLOT_QUOTA,
      status: "active",
    } as any,
  });

  console.log(`  📁 [Swarm] 已自动创建 Root Workspace：${created.name} (${created.id})`);
  return created.id;
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
    await ensureMainSession(prisma, {
      agentId: existing.id,
      title: `${SUPER_AGENT_NAME} 主会话`,
      model: existing.model ?? config?.llm.defaultModel ?? DEFAULT_LLM_MODEL,
    });
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

  // createAgentForTier 已 ensure；此处再调一次幂等兜底（标题用固定超级 Agent 文案）
  await ensureMainSession(prisma, {
    agentId: superAgent.id,
    title: `${SUPER_AGENT_NAME} 主会话`,
    model: superAgent.model,
  });

  console.log("  👑 [Swarm] 已自动创建超级 Agent（首次启动）并关联系统 Workspace");
}
