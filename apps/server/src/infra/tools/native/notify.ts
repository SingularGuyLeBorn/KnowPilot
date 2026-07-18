/**
 * Native 通知域 —— agent_notify_parent：子 Agent 主动向父会话发送通知。
 *
 * 与 agent_report_back 的区别：
 * - report_back 通过 SwarmBus 向上级 Agent 投递结果，触发父会话的异步任务消费；
 * - notify_parent 直接向父会话的 SessionQueueItem 写入 kind=child_notify 队列项，
 *   由父会话前端 drain 作为用户消息消费并触发父 Agent 回复。
 *
 * 纪律：
 * - 只能 notify 自己的 parentSessionId（从当前子会话 parentSessionId 或跟踪 Task 反查）；
 * - 禁止跨 Workspace；
 * - 父会话已归档/删除返回错误；
 * - 不新造消费管线：队列项经 SessionQueueItemService.create 落库并广播 session_queue_update，
 *   前端现有 drain 负责消费 child_notify。
 */

import { z } from "zod";
import { zodParams } from "./zodParams.js";
import {
  type NativeToolContext,
  type NativeToolDefinition,
  type NativeToolHandler,
} from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

const notifyParentParameters = zodParams(
  z.object({
    content: z.string().min(1, "通知内容不能为空"),
  }),
);

/**
 * 按跟踪 Task 反查父会话：spawn 时会在父会话创建 type=async_agent 的 Task，
 * 其 input.subagentSessionId 指向子会话主 session。用于子会话未显式绑定 parentSessionId 的场景。
 */
async function resolveParentSessionIdByTrackingTask(
  prisma: NonNullable<NativeToolContext["prisma"]>,
  sessionId: string,
): Promise<string | undefined> {
  const trackers = await prisma.task.findMany({
    where: {
      OR: [{ name: { startsWith: "[async]" } }, { type: "async_agent" }],
      status: { in: ["running", "queued", "success"] },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const bySubSession = trackers.find((row) => {
    const input = row.input as { subagentSessionId?: string } | null;
    return input?.subagentSessionId === sessionId;
  });
  if (bySubSession?.sessionId) return bySubSession.sessionId;

  return undefined;
}

async function agentNotifyParentTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  if (!ctx.prisma) {
    return { success: false, error: "agent_notify_parent 需要 prisma 上下文" };
  }
  if (!ctx.sessionId) {
    return { success: false, error: "agent_notify_parent 需要在 Chat 会话中调用（缺少 sessionId）" };
  }
  if (!ctx.agentSnapshot) {
    return { success: false, error: "agent_notify_parent 缺少当前 Agent 上下文" };
  }
  if (ctx.agentSnapshot.tier !== "sub") {
    return {
      success: false,
      error: `[TIER_INSUFFICIENT] agent_notify_parent 只能由子 Agent 调用，当前层级为 ${ctx.agentSnapshot.tier ?? "未知"}。`,
      permissionDenied: true,
    };
  }
  if (!ctx.agentSnapshot.parentId) {
    return {
      success: false,
      error: "当前 Agent 无上级（parentId 为空），无法 notify_parent。",
    };
  }

  const content = String(args.content || "").trim();
  if (!content) {
    return { success: false, error: "通知内容不能为空" };
  }

  // 1. 解析父会话：优先当前子会话 parentSessionId；否则尝试 tracking Task 反查
  let parentSessionId: string | undefined;
  const currentSession = await ctx.prisma.chatSession.findUnique({
    where: { id: ctx.sessionId },
    select: { parentSessionId: true },
  });
  parentSessionId = currentSession?.parentSessionId ?? undefined;

  if (!parentSessionId) {
    parentSessionId = await resolveParentSessionIdByTrackingTask(ctx.prisma, ctx.sessionId);
  }

  if (!parentSessionId) {
    return { success: false, error: "当前子会话未绑定父会话（parentSessionId 为空），无法 notify_parent。" };
  }

  // 2. 加载父会话并校验状态、Agent 绑定、Workspace 边界
  const parentSession = await ctx.prisma.chatSession.findUnique({
    where: { id: parentSessionId },
    include: { agent: { select: { id: true, workspaceId: true } } },
  });
  if (!parentSession) {
    return { success: false, error: `目标父会话 ${parentSessionId} 不存在。` };
  }
  if (parentSession.status === "deleted") {
    return { success: false, error: `目标父会话 ${parentSessionId} 已删除。` };
  }
  if (parentSession.status === "archived") {
    return { success: false, error: `目标父会话 ${parentSessionId} 已归档。` };
  }
  if (!parentSession.agentId || !parentSession.agent) {
    return { success: false, error: `目标父会话 ${parentSessionId} 未绑定 Agent，无法触发回复。` };
  }

  // 只能 notify 自己的 parent：父会话 Agent 必须与当前 Agent 的 parentId 一致
  if (ctx.agentSnapshot.parentId !== parentSession.agent.id) {
    return {
      success: false,
      error: `目标父会话 ${parentSessionId} 不是当前 Agent 的上级，禁止 notify。`,
      permissionDenied: true,
    };
  }

  // 禁止跨 Workspace（双方 workspaceId 均非空时才强校验；任一方为空则无法判定，放行）
  const subWorkspaceId = ctx.agentSnapshot.workspaceId ?? null;
  const parentWorkspaceId = parentSession.agent.workspaceId ?? null;
  if (subWorkspaceId && parentWorkspaceId && subWorkspaceId !== parentWorkspaceId) {
    return {
      success: false,
      error: `禁止跨 Workspace notify_parent（当前 Agent Workspace ${subWorkspaceId}，父会话 Workspace ${parentWorkspaceId}）。`,
      permissionDenied: true,
    };
  }

  // 3. 获取子 Agent 名称作为来源显示名，失败则回退“子 Agent”
  let sourceName = "子 Agent";
  try {
    const me = await ctx.services.agent.getById(ctx.agentSnapshot.id);
    const name = (me as { name?: string } | null)?.name;
    if (name) sourceName = name;
  } catch {
    /* ignore */
  }

  const item = await ctx.services.sessionQueueItem.create({
    sessionId: parentSessionId,
    kind: "child_notify",
    content,
    source: ctx.agentSnapshot.id,
    sourceName,
  });

  if (!item.success) {
    return { success: false, error: item.error?.message ?? "通知入队失败" };
  }

  // SSE：SessionQueueItemService.create 已统一推 session_queue_update，此处不再重复广播

  return {
    success: true,
    queued: true,
    parentSessionId,
    message: `已向父会话发送通知（来源：${sourceName}），父 Agent 空闲时会自动回复。`,
  };
}

const defs: NativeToolDefinition[] = [
  {
    name: "agent_notify_parent",
    description:
      "【进度/催问通知】向父会话发送一条过程通知（进度、卡点、需要上级决策等）。进入父会话「待发消息」发送队列，父空闲时当一条输入触发父 Agent 回复。" +
      "与 agent_report_back 的区别：notify_parent≠任务结果交付，不会进右栏异步结果队列；正式完成任务请用 agent_report_back。" +
      "只能 notify 自己的父会话；不要用本工具代替 report_back 交最终结果。",
    parameters: notifyParentParameters,
    concurrencyClass: "B",
    reentrant: true,
  },
];

const handlers: Record<string, NativeToolHandler> = {
  agent_notify_parent: agentNotifyParentTool,
};

export function registerNotifyTools(): void {
  registerNativeDomain(defs, handlers);
}
