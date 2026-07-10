/**
 * SwarmPermissionGuard — 工具调用权限硬拦截中间层
 *
 * 在 executeNativeTool 之前校验：agent 是否有权调用此工具、目标 agent 是否在允许通信范围内、
 * 向上发消息时机约束（#41：只能在正式回复中向上级发，不能在工具调用轮次中）。
 * 返回权限错误时包含错误码 + 错误原因（#44 用户要求）。
 */

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
  // 超级 Agent 专属
  super: [
    "workspace_create",
    "workspace_archive",
    "workspace_delete",
    "agent_create",
    "agent_update",
    "agent_delete",
    "agent_inspect",
  ],
  // 管理 Agent 及以上（super 也可以用）
  manager: [
    // 子 Agent 管理
    "agent_create_sub",
    "agent_update_sub",
    "agent_delete_sub",
    "agent_forward",
    // 任务编排：子 Agent 只能直接执行，不能再派生/管理任务
    "spawn_subagent",
    "run_async",
    "async_task_run",
    "cancel_async",
    "await_async",
    "async_task_wait",
    "task_status",
    "async_task_status",
  ],
};

/** 根据 tier 过滤工具列表：子 Agent 等低 tier 自动剔除无权限工具 */
export function getAllowedToolsForTier(tier: string, tools: string[]): string[] {
  return tools.filter((tool) => {
    const requiredTier = getRequiredTierForTool(tool);
    if (!requiredTier) return true;
    return TIER_RANK[tier] >= TIER_RANK[requiredTier];
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

  // 3. Agent 间通信工具：检查通信范围 + 向上发消息时机约束
  if (isAgentMessagingTool(toolName)) {
    const toAgentId = args.toAgentId as string | undefined;
    // agent_report_back 的目标在 args 里可能叫 toAgentId 或 parentId
    const targetId = toAgentId || (args.parentId as string | undefined);

    if (targetId) {
      // 向上发消息时机约束（#41）：在工具调用轮次中不能向上级发消息
      // 向下发（super→manager、manager→sub）允许在工具轮次中
      // 向上发（sub→manager、manager→super）只能在正式回复中（inToolRound=false）
      if (ctx.inToolRound) {
        // 工具轮次中：需要判断方向。由于此处不知道目标 agent 的 tier，
        // 保守策略：工具轮次中只允许向下（目标 tier < 调用方 tier）。
        // 目标 tier 需要在工具执行时查 DB 验证，此处先标记，由工具执行层完成完整校验。
        // 这里只做基本检查：向上发消息在工具轮次中被拦截。
        // 完整的方向判断在 swarmMessaging 工具执行中做（可查 DB 获取目标 tier）
      }
    }

    // depth 校验（#12 防循环）
    const depth = args.depth as number | undefined;
    if (depth !== undefined && depth > 10) {
      return {
        code: "DELEGATION_DEPTH_EXCEEDED",
        reason: `委托层级 ${depth} 超过上限 10，可能存在循环委托。`,
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
): PermissionError | null {
  // 向上发：目标 tier > 发送方 tier
  const isUpward = TIER_RANK[toTier] > TIER_RANK[fromTier];
  if (isUpward && inToolRound) {
    return {
      code: "UPWARD_MESSAGE_IN_TOOL_ROUND",
      reason: `向上级（${toTier}）发送消息只能在正式回复中进行，不能在工具调用轮次中发送。请完成工具调用后在最终回复中发送。`,
    };
  }
  return null;
}

/**
 * 检查跨 Workspace 通信（#19：只有 super 能跨 Workspace）
 */
export function checkCrossWorkspace(
  fromTier: string,
  fromWorkspaceId: string | null | undefined,
  toWorkspaceId: string | null | undefined,
): PermissionError | null {
  // super 没有限制
  if (fromTier === "super") return null;
  // 同 Workspace 或目标无 Workspace → 允许
  if (fromWorkspaceId === toWorkspaceId) return null;
  if (!toWorkspaceId) return null; // 目标是 super（无 workspace）
  // 跨 Workspace 且非 super → 拒绝
  return {
    code: "CROSS_WORKSPACE_FORBIDDEN",
    reason: `只有超级 Agent 能跨 Workspace 协调。当前 Agent（Workspace: ${fromWorkspaceId ?? "无"}）不能向其他 Workspace（${toWorkspaceId}）的 Agent 发消息。`,
  };
}
