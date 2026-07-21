/**
 * SwarmBus — Agent 间消息系统抽象层
 *
 * LocalSwarmBus: 基于 SQLite AgentMessage 表 + 进程内事件（零依赖，SWARM_MODE=local 默认）
 * RedisSwarmBus: 基于 BullMQ + Redis（SWARM_MODE=redis，Phase 4 实现）
 *
 * 核心能力：
 * - send(): Agent 间发消息（权限校验 + 向上发消息时机约束 + 跨 Workspace 校验）
 * - poll(): 拉取待投递消息（前端轮询）
 * - markConsumed(): 标记消息已消费
 */

import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import { SWARM_MAX_DEPTH, SWARM_MAX_QUEUE_SIZE } from "@knowpilot/shared";
import {
  checkUpwardMessageTiming,
  checkCrossWorkspace,
  type PermissionError,
} from "./swarmPermissionGuard.js";
import { resolveServerDelegationDepth } from "./delegationDepth.js";
import { RedisSwarmBus } from "./redisSwarmBus.js";

export { resolveServerDelegationDepth } from "./delegationDepth.js";

const MAX_DEPTH = SWARM_MAX_DEPTH;
const MAX_QUEUE_SIZE = SWARM_MAX_QUEUE_SIZE;

// taskRef（对账键）只允许服务端内部赋值（W16a-3：report_back 桥接强制写 jobId），
// depth 同手法（B5）：由服务端沿派生链物化，不接收 LLM / 调用方入参。
export interface AgentMessageInput {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  messageType?: "command" | "query" | "report" | "forward";
  source?: "super" | "manager" | "sub" | "user" | "system";
}

export interface AgentMessageRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  sessionId: string | null;
  content: string;
  messageType: string;
  source: string;
  depth: number;
  taskRef: string | null;
  status: string;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface SwarmBus {
  send(msg: AgentMessageInput, fromTier: string, fromWorkspaceId: string | null, inToolRound: boolean): Promise<{ success: boolean; error?: PermissionError; message?: string; messageId?: string }>;
  poll(toAgentId: string): Promise<AgentMessageRecord[]>;
  markConsumed(messageId: string): Promise<void>;
}

export class LocalSwarmBus implements SwarmBus {
  constructor(private readonly prisma: PrismaClient, private readonly services: ServiceContainer) {}

  async send(
    msg: AgentMessageInput,
    fromTier: string,
    fromWorkspaceId: string | null,
    inToolRound: boolean,
  ): Promise<{ success: boolean; error?: PermissionError; message?: string; messageId?: string }> {
    // 查目标 Agent
    const toAgent = await this.prisma.agent.findUnique({ where: { id: msg.toAgentId } });
    if (!toAgent || toAgent.status === "deleted") {
      return { success: false, error: { code: "TARGET_NOT_FOUND", reason: `目标 Agent ${msg.toAgentId} 不存在或已删除。` } };
    }

    // 向上发消息时机约束（#41）
    // messageType=report（agent_report_back）是正式回报通道，允许在工具轮次中发送
    const timingError = checkUpwardMessageTiming(fromTier, toAgent.tier, inToolRound, {
      allowReportTool: msg.messageType === "report",
    });
    if (timingError) return { success: false, error: timingError };

    // 跨 Workspace 校验（#19）
    const crossError = checkCrossWorkspace(fromTier, fromWorkspaceId, toAgent.workspaceId, {
      toTier: toAgent.tier,
    });
    if (crossError) return { success: false, error: crossError };

    // B5：depth 服务端物化（#12 防循环）——不读调用方入参
    const depth = await resolveServerDelegationDepth(this.prisma, msg.fromAgentId);
    if (depth > MAX_DEPTH) {
      return {
        success: false,
        error: { code: "DELEGATION_DEPTH_EXCEEDED", reason: `委托层级 ${depth} 超过上限 ${MAX_DEPTH}，可能存在循环委托。` },
      };
    }

    // 队列容量校验（#32）
    const pendingCount = await this.prisma.agentMessage.count({
      where: { toAgentId: msg.toAgentId, status: "pending" },
    });
    if (pendingCount >= MAX_QUEUE_SIZE) {
      return {
        success: false,
        error: { code: "QUEUE_FULL", reason: `目标 Agent 队列已满（${MAX_QUEUE_SIZE} 条），请先处理已有消息。` },
      };
    }

    // 写入消息
    const created = await this.prisma.agentMessage.create({
      data: {
        fromAgentId: msg.fromAgentId,
        toAgentId: msg.toAgentId,
        content: msg.content,
        messageType: msg.messageType ?? "command",
        source: msg.source ?? fromTier,
        depth,
        status: "pending",
      },
    });

    // 审计日志（#17）
    await this.prisma.log.create({
      data: {
        level: "info",
        component: "swarm",
        event: "agent_message_sent",
        message: `${msg.fromAgentId} → ${msg.toAgentId}: ${msg.content.slice(0, 80)}`,
        metadata: { messageId: created.id, fromTier, toTier: toAgent.tier, depth, messageType: msg.messageType ?? "command" },
      },
    }).catch(() => { /* 审计日志失败不阻塞 */ });

    void this.notifyAgentMessage({
      toAgentId: msg.toAgentId,
      messageId: created.id,
      content: msg.content,
      fromAgentId: msg.fromAgentId,
      source: msg.source ?? fromTier,
    });

    return { success: true, message: "消息已发送。", messageId: created.id };
  }

  /** 推送 agent_message 到目标 Agent 的活跃子会话（推优先，替代前端轮询） */
  private async notifyAgentMessage(params: {
    toAgentId: string;
    messageId: string;
    content: string;
    fromAgentId: string;
    source?: string;
  }): Promise<void> {
    try {
      const { getStreamHub } = await import("./sessionStreamHub.js");
      const hub = getStreamHub();
      if (!hub) return;
      const sessions = await this.prisma.chatSession.findMany({
        where: {
          agentId: params.toAgentId,
          kind: "subagent",
          status: { in: ["active", "running", "queued", "paused"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: { id: true },
      });
      for (const s of sessions) {
        hub.pushExternalEvent(s.id, {
          type: "agent_message",
          sessionId: s.id,
          agentId: params.toAgentId,
          messageId: params.messageId,
          content: params.content,
          source: params.source,
          fromAgentId: params.fromAgentId,
        });
      }
    } catch (err) {
      console.warn(`[swarmBus] agent_message 推送失败:`, err);
    }
  }

  async poll(toAgentId: string): Promise<AgentMessageRecord[]> {
    const messages = await this.prisma.agentMessage.findMany({
      where: { toAgentId, status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    return messages as AgentMessageRecord[];
  }

  async markConsumed(messageId: string): Promise<void> {
    // W16a-1：delivered → consumed 不动 deliveredAt（真账）；pending 直跳 consumed 兜底补齐。
    // 已 consumed / 不存在均为幂等 no-op。
    const fromDelivered = await this.prisma.agentMessage.updateMany({
      where: { id: messageId, status: "delivered" },
      data: { status: "consumed" },
    });
    if (fromDelivered.count > 0) return;
    await this.prisma.agentMessage.updateMany({
      where: { id: messageId, status: "pending" },
      data: { status: "consumed", deliveredAt: new Date() },
    });
  }
}

let _bus: SwarmBus | null = null;
let _busPrisma: PrismaClient | null = null;

/** 仅用于测试：重置 SwarmBus 单例，避免跨测试复用旧的 PrismaClient */
export function resetSwarmBus(): void {
  _bus = null;
  _busPrisma = null;
}

export function getSwarmBus(prisma: PrismaClient, services: ServiceContainer, config?: any): SwarmBus {
  // prisma 不匹配时重建（测试场景：每个 test 传入不同 mock prisma，单例不能复用旧实例）
  if (_bus && _busPrisma !== prisma) {
    _bus = null;
    _busPrisma = null;
  }
  if (!_bus) {
    const mode = (process.env.SWARM_MODE || "local").trim().toLowerCase();
    if (mode === "redis") {
      // 同步构造：禁止先挂 Local 再 async 替换（启动窗口语义不一致）
      _bus = new RedisSwarmBus(prisma, services, config);
      _busPrisma = prisma;
      console.log("  🔗 [SwarmBus] Redis 模式（BullMQ 旁路 + SQLite 邮箱）");
    } else {
      _bus = new LocalSwarmBus(prisma, services);
      _busPrisma = prisma;
    }
  }
  return _bus;
}
