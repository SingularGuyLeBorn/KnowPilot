/**
 * SwarmPermissionGuard — 工具调用权限硬拦截中间层
 *
 * 在 executeNativeTool 之前校验：agent 是否有权调用此工具、目标 agent 是否在允许通信范围内、
 * 向上发消息时机约束（#41：只能在正式回复中向上级发，不能在工具调用轮次中）。
 * 返回权限错误时包含错误码 + 错误原因（#44 用户要求）。
 */

import type { PrismaClient } from "@prisma/client";
import { SWARM_MAX_DEPTH } from "@knowpilot/shared";

/** Agent 层级排序：super > manager > sub */
const TIER_RANK: Record<string, number> = { super: 3, manager: 2, sub: 1 };

export interface PermissionError {
  code: string;
  reason: string;
}

export interface PermissionCheckContext {
  /** 调用方 Agent 信息 */
  agentTier: string;
  agentId: string;
  agentWorkspaceId?: string | null;
  /** 当前是否在工具调用轮次中（向上发消息时机约束） */
  inToolRound: boolean;
}

/**
 * 工具按 Agent tier 的最低要求映射。
 * key = tier，value = 该 tier 及以上可使用的工具。
 * 未列出的工具默认对所有 tier 开放（读写类工具仍受 allowedNative 白名单约束）。
 */
const TIER_RESTRICTED_TOOLS: Record<string, string[]> = {
  // 超级 Agent 专属：建/归档空间、创建任意 tier Agent
  super: [
    "workspace_create",
    "workspace_archive",
    "workspace_delete",
    "agent_create",
  ],
  // 管理 Agent 及以上：本 Workspace 内 CRUD / 检视 / 派生子 Agent（出域由工具内硬拦）
  manager: [
    "agent_update",
    "agent_delete",
    "agent_inspect",
    "agent_create_sub",
    "agent_update_sub",
    "agent_delete_sub",
    "agent_forward",
    "spawn_subagent",
    "memory_create",
    "memory_update",
    "memory_search",
    "memory_delete",
    "pinned_memory_read",
    "pinned_memory_write",
    "session_compact",
    "session_rotate",
  ],
  // 子 Agent 及以上（manager/super 也可以用）：可执行异步任务，但不能再派生子 Agent
  sub: [
    "async_task_run",
    "async_task_status",
    "async_task_cancel",
    "agent_notify_parent",
    "todo_write",
    "todo_read",
  ],
};

/** 根据 tier 过滤工具列表：子 Agent 等低 tier 自动剔除无权限工具。
 *  支持 `native:xxx` 与裸名两种写法。 */
export function getAllowedToolsForTier(tier: string, tools: string[]): string[] {
  return tools.filter((tool) => {
    const bare = tool.startsWith("native:") ? tool.slice("native:".length) : tool;
    const requiredTier = getRequiredTierForTool(bare);
    if (!requiredTier) return true;
    return (TIER_RANK[tier] ?? 0) >= (TIER_RANK[requiredTier] ?? 0);
  });
}

/** 工具 → 最低要求 tier */
function getRequiredTierForTool(toolName: string): string | undefined {
  for (const [tier, tools] of Object.entries(TIER_RESTRICTED_TOOLS)) {
    if (tools.includes(toolName)) return tier;
  }
  return undefined;
}

/** 判断工具是否受 tier 限制 */
function isTierRestrictedTool(toolName: string): boolean {
  return getRequiredTierForTool(toolName) !== undefined;
}

/** 判断工具是否是 agent 间通信类工具（需要通信范围校验） */
function isAgentMessagingTool(toolName: string): boolean {
  return ["agent_send_message", "agent_report_back", "agent_forward"].includes(toolName);
}

/**
 * 权限校验入口
 * @returns null=通过，PermissionError=拒绝（含错误码+原因）
 */
export function checkToolPermission(
  toolName: string,
  args: Record<string, unknown>,
  ctx: PermissionCheckContext,
): PermissionError | null {
  // 1. 按 tier 限制的工具：检查 Agent 层级是否满足最低要求
  const requiredTier = getRequiredTierForTool(toolName);
  if (requiredTier && TIER_RANK[ctx.agentTier] < TIER_RANK[requiredTier]) {
    return {
      code: "TIER_INSUFFICIENT",
      reason: `工具 ${toolName} 需要 ${requiredTier} 及以上权限，当前 Agent 层级为 ${ctx.agentTier}。`,
    };
  }

  // 2. Swarm 管理工具特有校验（workspace 范围、自我删除等）
  if (isTierRestrictedTool(toolName)) {
    // agent_create_sub / agent_update_sub / agent_delete_sub：管理 Agent 只能操作本 Workspace
    if (toolName.endsWith("_sub") && ctx.agentTier === "manager") {
      const targetWorkspaceId = args.workspaceId as string | undefined;
      if (targetWorkspaceId && ctx.agentWorkspaceId && targetWorkspaceId !== ctx.agentWorkspaceId) {
        return {
          code: "CROSS_WORKSPACE_FORBIDDEN",
          reason: `管理 Agent 只能操作本 Workspace（${ctx.agentWorkspaceId}）内的子 Agent，目标 Workspace（${targetWorkspaceId}）不在范围内。`,
        };
      }
    }

    // agent_delete / agent_delete_sub：不能删除自己（#16）
    if (toolName === "agent_delete" || toolName === "agent_delete_sub") {
      const targetId = args.id as string | undefined;
      if (targetId === ctx.agentId) {
        return {
          code: "SELF_DELETE_FORBIDDEN",
          reason: "Agent 不能删除自己。",
        };
      }
      // super 不能删其他 super（#16）
      if (ctx.agentTier === "super" && toolName === "agent_delete") {
        // 目标 tier 校验在工具执行时做（需查 DB），此处只做调用方校验
      }
    }
  }

  // 3. Agent 间通信工具：depth 防循环校验（#12）。
  // 向上发消息时机约束（#41）不在本层做——guard 拿不到目标 Agent 的 tier（需查 DB），
  // 此处预检注定是做一半的「标记了但没做」。其唯一完整实现归属 swarmBus.send →
  // checkUpwardMessageTiming（执行层可查 DB 获取目标 tier 做完整方向判断），单点收口。
  if (isAgentMessagingTool(toolName)) {
    // depth 校验（#12 防循环）
    const depth = args.depth as number | undefined;
    if (depth !== undefined && depth > SWARM_MAX_DEPTH) {
      return {
        code: "DELEGATION_DEPTH_EXCEEDED",
        reason: `委托层级 ${depth} 超过上限 ${SWARM_MAX_DEPTH}，可能存在循环委托。`,
      };
    }
  }

  return null;
}

/**
 * 检查向上发消息时机约束（需要目标 agent 的 tier 信息，在工具执行时调用）
 * @param fromTier 发送方 tier
 * @param toTier 接收方 tier
 * @param inToolRound 是否在工具调用轮次中
 * @returns null=通过，PermissionError=拒绝
 */
export function checkUpwardMessageTiming(
  fromTier: string,
  toTier: string,
  inToolRound: boolean,
  options?: { allowReportTool?: boolean },
): PermissionError | null {
  // agent_report_back 是专门的向上回报工具，必须允许在工具轮次中调用
  if (options?.allowReportTool) return null;
  // 向上发：目标 tier > 发送方 tier
  const isUpward = TIER_RANK[toTier] > TIER_RANK[fromTier];
  if (isUpward && inToolRound) {
    return {
      code: "UPWARD_MESSAGE_IN_TOOL_ROUND",
      reason: `向上级（${toTier}）发送消息只能在正式回复中进行，不能在工具调用轮次中发送。请使用 agent_report_back 工具回报，或完成工具调用后在最终回复中发送。`,
    };
  }
  return null;
}

/**
 * 检查跨 Workspace 通信（#19 + Workspace Q3）
 * - super：无限制
 * - 目标为 super：出域唯一白名单（向上报告 / 回复超级）
 * - 其余：必须同 Workspace
 */
export function checkCrossWorkspace(
  fromTier: string,
  fromWorkspaceId: string | null | undefined,
  toWorkspaceId: string | null | undefined,
  options?: { toTier?: string | null },
): PermissionError | null {
  if (fromTier === "super") return null;
  // 出域白名单：向超级 Agent 报告（超级挂在 Root Workspace，workspaceId 非空）
  if (options?.toTier === "super") return null;
  if (fromWorkspaceId === toWorkspaceId) return null;
  if (!toWorkspaceId) return null;
  return {
    code: "CROSS_WORKSPACE_FORBIDDEN",
    reason: `管理/子 Agent 除向超级 Agent 报告外，不能触碰 Workspace 外资源。当前（${fromWorkspaceId ?? "无"}）→ 目标（${toWorkspaceId}）。`,
  };
}

/**
 * 管理/子 Agent 操作目标 Agent 时的出域硬拦（Q3）。
 * super 放行；禁止触碰超级 Agent；禁止跨 Workspace。
 */
export function checkWorkspaceAgentAccess(
  caller: { tier: string; workspaceId?: string | null },
  target: { tier: string; workspaceId?: string | null; id: string },
  action: string,
): PermissionError | null {
  if (caller.tier === "super") return null;
  if (target.tier === "super") {
    return {
      code: "TIER_PROTECTED",
      reason: `${action}：不能操作超级 Agent（仅可经消息/报告通道向上沟通）。`,
    };
  }
  if (caller.workspaceId && target.workspaceId && caller.workspaceId !== target.workspaceId) {
    return {
      code: "CROSS_WORKSPACE_FORBIDDEN",
      reason: `${action}：只能操作本 Workspace（${caller.workspaceId}）内的 Agent，目标属于 ${target.workspaceId}。`,
    };
  }
  if (caller.workspaceId && !target.workspaceId) {
    return {
      code: "CROSS_WORKSPACE_FORBIDDEN",
      reason: `${action}：目标 Agent 无 Workspace 归属，管理/子 Agent 不可操作。`,
    };
  }
  return null;
}

/**
 * 检查 agent_send_message 的层级/范围权限。
 *
 * 规则：
 * 1. 同级 Agent 之间禁止直接发消息。
 * 2. 向下发：super 可发给任何下级；manager 只能发给本 Workspace 内的下级。
 * 3. 向上发：仅当上一条来自上级的消息存在且比本 Agent 最后一条发往上级的消息更新时允许（即只能回复）。
 */
export async function checkAgentSendMessagePermission(
  prisma: PrismaClient,
  ctx: {
    fromAgentId: string;
    fromTier: string;
    fromWorkspaceId: string | null | undefined;
  },
  toAgent: { id: string; tier: string; workspaceId: string | null; status: string },
): Promise<PermissionError | null> {
  const fromRank = TIER_RANK[ctx.fromTier] ?? 0;
  const toRank = TIER_RANK[toAgent.tier] ?? 0;

  // 1. 同级禁止
  if (fromRank === toRank) {
    return {
      code: "SAME_TIER_MESSAGING_FORBIDDEN",
      reason: `同级 Agent（${ctx.fromTier}）之间不能直接发送消息。`,
    };
  }

  // 2. 向下发
  if (fromRank > toRank) {
    if (ctx.fromTier === "super") return null;
    if (ctx.fromTier === "manager") {
      if (ctx.fromWorkspaceId && toAgent.workspaceId && ctx.fromWorkspaceId !== toAgent.workspaceId) {
        return {
          code: "CROSS_WORKSPACE_FORBIDDEN",
          reason: "管理 Agent 只能向本 Workspace 内的下级 Agent 发消息。",
        };
      }
      return null;
    }
    return {
      code: "TIER_INSUFFICIENT",
      reason: "子 Agent 不能向下级 Agent 发消息。",
    };
  }

  // 3. 向上发：必须是对上一条来自上级的消息的回复
  const [lastFromTarget, lastFromSender] = await Promise.all([
    prisma.agentMessage.findFirst({
      where: { fromAgentId: toAgent.id, toAgentId: ctx.fromAgentId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentMessage.findFirst({
      where: { fromAgentId: ctx.fromAgentId, toAgentId: toAgent.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!lastFromTarget) {
    return {
      code: "UPWARD_REPLY_REQUIRED",
      reason: `下级 Agent 只能在上级先发来消息并等待回复时，才能向上级（${toAgent.tier}）发送消息。当前没有来自该上级的消息记录。`,
    };
  }

  if (lastFromSender && lastFromSender.createdAt.getTime() > lastFromTarget.createdAt.getTime()) {
    return {
      code: "UPWARD_REPLY_REQUIRED",
      reason: "下级 Agent 已向上级发送过更新消息，需等待上级再次发起通信后才能回复。",
    };
  }

  return null;
}
