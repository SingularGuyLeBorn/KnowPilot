/**
 * workspaceProvision — Workspace 创建的共享编排逻辑
 *
 * 被两处复用：
 * 1. workspace_create native tool（超级 Agent 调用）
 * 2. workspace.create tRPC 路由（用户在 /workspaces 页 UI 创建，autoCreateManager=true 时）
 *
 * 职责：创建 Workspace → 自动创建管理 Agent（tier=manager）→ 主 session →
 *       .knowpilot/ 目录结构（#30）→ 审计日志
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { resolveSafePath } from "./safePath.js";
import { getTierTemplate } from "./agentFactory.js";

export interface ProvisionWorkspaceInput {
  name: string;
  path: string;
  description?: string;
  managerModel?: string;
  managerSystemPrompt?: string;
  /** 操作者（超级 Agent id 或 "user"） */
  operatorAgentId?: string;
  /** 管理 Agent 的上级（超级 Agent id；用户创建时可为空） */
  managerParentId?: string;
  /** 是否自动创建管理 Agent（默认 true） */
  autoCreateManager?: boolean;
}

export interface ProvisionWorkspaceResult {
  success: boolean;
  workspaceId?: string;
  managerAgentId?: string;
  error?: string;
}

export async function provisionWorkspace(
  config: AppConfig,
  services: ServiceContainer,
  input: ProvisionWorkspaceInput,
): Promise<ProvisionWorkspaceResult> {
  const { name, path } = input;
  if (!name || !path) return { success: false, error: "需要 name 和 path" };

  // 1. 创建 Workspace 记录
  const wsResult = await services.workspace.create({
    name,
    description: input.description,
    path,
  });
  if (!wsResult.success || !wsResult.data) {
    return { success: false, error: wsResult.error?.message ?? "创建 Workspace 失败" };
  }
  const wsId = (wsResult.data as { id: string }).id;

  // 2. 自动创建管理 Agent（可关）
  let managerAgentId: string | undefined;
  if (input.autoCreateManager !== false) {
    // W9：默认值（提示词/工具清单）走 AgentFactory 模板 content/agents/_templates/manager.md
    const managerTemplate = getTierTemplate("manager", { vars: { name } });
    const managerPrompt = input.managerSystemPrompt ?? managerTemplate.systemPrompt;

    const mgrResult = await services.agent.create({
      name: `${name} 管理 Agent`,
      description: `${name} Workspace 的管理 Agent`,
      model: input.managerModel ?? config.llm.defaultModel,
      systemPrompt: managerPrompt,
      tools: managerTemplate.tools,
      tier: "manager",
      workspaceId: wsId,
      parentId: input.managerParentId,
    });

    if (mgrResult.success && mgrResult.data) {
      managerAgentId = (mgrResult.data as { id: string }).id;
      // 关联管理 Agent 到 Workspace
      await services.prisma.workspace
        .update({ where: { id: wsId }, data: { managerAgentId } })
        .catch(() => {});
      // 创建主 session（#2：管理 Agent 主 session 接收命令）
      await services.session
        .create({
          title: `${name} 管理主会话`,
          model: input.managerModel ?? config.llm.defaultModel,
          agentId: managerAgentId,
          isMainSession: true,
        })
        .catch(() => {});
    }
  }

  // 3. 自动创建 .knowpilot/ 目录结构（#30）
  try {
    const wsPath = resolveSafePath(config, path);
    const fs = await import("node:fs/promises");
    await fs.mkdir(`${wsPath}/.knowpilot/shared/data`, { recursive: true });
    await fs.mkdir(`${wsPath}/.knowpilot/shared/scratch`, { recursive: true });
    await fs.writeFile(`${wsPath}/.knowpilot/state.json`, "{}");
    await fs.appendFile(
      `${wsPath}/.knowpilot/log.jsonl`,
      JSON.stringify({ event: "workspace_created", at: new Date().toISOString(), by: input.operatorAgentId ?? "user" }) + "\n",
    );
  } catch (err) {
    console.warn(`[workspaceProvision] .knowpilot/ 目录创建失败:`, err);
  }

  // 4. 审计日志（#17）
  await services.log
    ?.create?.({
      level: "info",
      component: "swarm",
      event: "workspace_created",
      message: `Workspace ${name} 被创建（管理 Agent: ${managerAgentId ?? "未创建"}）`,
      metadata: { workspaceId: wsId, managerAgentId, operatorAgentId: input.operatorAgentId ?? "user" },
    })
    .catch(() => {});

  return { success: true, workspaceId: wsId, managerAgentId };
}
