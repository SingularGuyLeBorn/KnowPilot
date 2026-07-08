/**
 * SwarmInitializer — 服务器启动时自动初始化 Swarm 结构
 *
 * 首次启动：如果不存在 super tier Agent，自动创建一个默认超级 Agent。
 * 超级 Agent 配置（#29）：
 *   - tier: "super"
 *   - heartbeat: { enabled: true, cron: "0 9 * * *", goal: "检查所有 Workspace 状态..." }
 *   - systemPrompt: 默认超级 Agent 模板
 */

import type { PrismaClient } from "@prisma/client";

const SUPER_AGENT_NAME = "KnowPilot 超级 Agent";
const SUPER_AGENT_SYSTEM_PROMPT = `你是 KnowPilot 的超级 Agent，用户的全权代理。

你的能力：
- 创建 Workspace（创建后自动生成该 Workspace 的管理 Agent）
- 创建/编辑/删除任何 Agent（但不能删除自己或其他超级 Agent）
- 跨 Workspace 协调（其他 Agent 不能跨 Workspace）
- 通过心跳机制自主运行，定时检查任务并下发命令
- 查看任何 Agent 的完整上下文（agent_inspect 工具）

你的心跳任务：
- 检查所有 Workspace 的状态
- 整理待办事项
- 如有需要，给管理 Agent 下发命令
- 发现优秀 Skill 可跨 Workspace 推广

所有操作会被审计记录。你不可删除自己或其他超级 Agent。`;

const SUPER_AGENT_HEARTBEAT = {
  enabled: true,
  cron: "0 9 * * *",
  goal: "检查所有 Workspace 状态，整理待办，如有需要给管理 Agent 下发命令",
  lastRunAt: null,
  lastRunStatus: null,
  consecutiveFailures: 0,
};

const SUPER_AGENT_TOOLS = [
  "native:web_search",
  "native:read_file",
  "native:write_file",
  "native:list_directory",
  "native:invoke_api",
  "native:run_async",
  "native:spawn_subagent",
  "native:task_status",
  "native:await_async",
  "native:cancel_async",
  "native:agent_create",
  "native:agent_update",
  "native:agent_delete",
  "native:agent_inspect",
  "native:agent_send_message",
  "native:workspace_create",
  "native:workspace_archive",
];

/**
 * 启动时初始化 Swarm：如果不存在 super tier Agent，自动创建。
 * 幂等：多次调用不会创建多个超级 Agent。
 */
export async function initSwarm(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.agent.findFirst({
    where: { tier: "super", status: { not: "deleted" } },
  });

  if (existing) {
    return; // 已存在超级 Agent，跳过
  }

  await prisma.agent.create({
    data: {
      name: SUPER_AGENT_NAME,
      description: "KnowPilot 默认超级 Agent，首次启动自动创建。拥有全部 Agent CRUD 权限与心跳自主运行能力。",
      model: "deepseek-v4-flash",
      systemPrompt: SUPER_AGENT_SYSTEM_PROMPT,
      tools: SUPER_AGENT_TOOLS.join(","),
      tier: "super",
      status: "active",
      heartbeat: SUPER_AGENT_HEARTBEAT,
    },
  });

  console.log("  👑 [Swarm] 已自动创建超级 Agent（首次启动）");
}
