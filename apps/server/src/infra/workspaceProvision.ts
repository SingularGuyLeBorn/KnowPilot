/**
 * workspaceProvision — Workspace 创建的共享编排逻辑
 *
 * 被两处复用：
 * 1. workspace_create native tool（超级 Agent 调用）
 * 2. workspace.create tRPC 路由（用户在 /workspaces 页 UI 创建）
 *
 * 职责：创建 Workspace →（可选）管理 Agent + 主 session →（可选）初始任务起流 →
 *       .knowpilot/ 目录结构 → 审计日志
 *
 * 不变量（design-decisions Workspace Q5）：初始任务失败不回滚已创建的 Workspace。
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
  managerName?: string;
  /** 操作者（超级 Agent id 或 "user"） */
  operatorAgentId?: string;
  /** 管理 Agent 的上级（超级 Agent id；用户创建时可为空） */
  managerParentId?: string;
  /** 是否自动创建管理 Agent（默认 true）；与 withManager 同义 */
  autoCreateManager?: boolean;
  withManager?: boolean;
  /** 发给管理员主会话的初始任务 */
  initialTask?: string;
  /** 本空间后台 LLM 槽上限；0=不限；默认 2。Root 系统空间建议 0 */
  asyncSlotQuota?: number;
}

export interface ProvisionWorkspaceResult {
  success: boolean;
  workspaceId?: string;
  managerAgentId?: string;
  managerSessionId?: string;
  initialTaskStatus?: "started" | "skipped" | "failed";
  error?: string;
}

function shouldCreateManager(input: ProvisionWorkspaceInput): boolean {
  if (input.withManager === false || input.autoCreateManager === false) return false;
  return true;
}

async function startInitialTask(options: {
  services: ServiceContainer;
  config: AppConfig;
  sessionId: string;
  agentId: string;
  task: string;
}): Promise<"started" | "failed"> {
  const { getStreamHub } = await import("./sessionStreamHub.js");
  const hub = getStreamHub();
  if (!hub) return "failed";

  const { createTrpcInvoker } = await import("./trpcInvoker.js");
  const { chatAgentStream } = await import("./agentStream.js");
  const invokeTrpc = createTrpcInvoker({ services: options.services });
  const body = {
    sessionId: options.sessionId,
    agentId: options.agentId,
    message: options.task,
    source: "super" as const,
    runOrigin: "parent" as const,
  };

  try {
    const started = await hub.startIfNotRunning(options.sessionId, body, async (emit, signal) => {
      await chatAgentStream(options.services, options.config, body, invokeTrpc, emit, signal);
    });
    return started ? "started" : "started";
  } catch (err) {
    console.warn(`[workspaceProvision] 初始任务起流失败:`, err);
    return "failed";
  }
}

export async function provisionWorkspace(
  config: AppConfig,
  services: ServiceContainer,
  input: ProvisionWorkspaceInput,
): Promise<ProvisionWorkspaceResult> {
  const { name, path } = input;
  if (!name || !path) return { success: false, error: "需要 name 和 path" };

  const asyncSlotQuota =
    typeof input.asyncSlotQuota === "number" && Number.isFinite(input.asyncSlotQuota)
      ? Math.max(0, Math.min(100, Math.floor(input.asyncSlotQuota)))
      : 2;

  // 1. 创建 Workspace 记录
  const wsResult = await services.workspace.create({
    name,
    description: input.description,
    path,
    asyncSlotQuota,
  } as any);
  if (!wsResult.success || !wsResult.data) {
    return { success: false, error: wsResult.error?.message ?? "创建 Workspace 失败" };
  }
  const wsId = (wsResult.data as { id: string }).id;

  // 2. 自动创建管理 Agent（可关）
  let managerAgentId: string | undefined;
  let managerSessionId: string | undefined;
  let initialTaskStatus: ProvisionWorkspaceResult["initialTaskStatus"] = "skipped";

  if (shouldCreateManager(input)) {
    const managerTemplate = getTierTemplate("manager", { vars: { name } });
    const managerPrompt = input.managerSystemPrompt ?? managerTemplate.systemPrompt;
    const managerName = input.managerName?.trim() || `${name} 管理 Agent`;

    const mgrResult = await services.agent.create({
      name: managerName,
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
      await services.prisma.workspace
        .update({ where: { id: wsId }, data: { managerAgentId } })
        .catch(() => {});

      // agent.create → afterCreate 已 ensureMainSession；此处取回 id（幂等再 ensure 一次）
      const { ensureMainSession } = await import("./ensureMainSession.js");
      const main = await ensureMainSession(services.prisma, {
        agentId: managerAgentId,
        title: `${name} 管理主会话`,
        model: input.managerModel ?? config.llm.defaultModel,
      }).catch(() => null);
      if (main?.session.id) {
        managerSessionId = main.session.id;
        if (main.session.title !== `${name} 管理主会话`) {
          await services.prisma.chatSession
            .update({
              where: { id: main.session.id },
              data: { title: `${name} 管理主会话` },
            })
            .catch(() => {});
        }
      }

      // 3. 初始任务：事务外起流；失败不回滚 Workspace（Q5）
      const task = input.initialTask?.trim();
      if (task && managerAgentId && managerSessionId) {
        initialTaskStatus = await startInitialTask({
          services,
          config,
          sessionId: managerSessionId,
          agentId: managerAgentId,
          task,
        });
      }
    }
  }

  // 4. .knowpilot/ 目录结构
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

  // 5. 审计
  await services.log
    ?.create?.({
      level: "info",
      component: "swarm",
      event: "workspace_created",
      message: `Workspace ${name} 被创建（管理 Agent: ${managerAgentId ?? "未创建"}，槽位配额: ${asyncSlotQuota}）`,
      metadata: {
        workspaceId: wsId,
        managerAgentId,
        managerSessionId,
        asyncSlotQuota,
        initialTaskStatus,
        operatorAgentId: input.operatorAgentId ?? "user",
      },
    })
    .catch(() => {});

  return {
    success: true,
    workspaceId: wsId,
    managerAgentId,
    managerSessionId,
    initialTaskStatus,
  };
}
