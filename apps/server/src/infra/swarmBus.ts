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
import {
  checkUpwardMessageTiming,
  checkCrossWorkspace,
  type PermissionError,
} from "./swarmPermissionGuard.js";

const MAX_DEPTH = 10;
const MAX_QUEUE_SIZE = 100;

export interface AgentMessageInput {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  messageType?: "command" | "query" | "report" | "forward";
  source?: "super" | "manager" | "sub" | "user" | "system";
  depth?: number;
  taskRef?: string;
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
  send(msg: AgentMessageInput, fromTier: string, fromWorkspaceId: string | null, inToolRound: boolean): Promise<{ success: boolean; error?: PermissionError; message?: string }>;
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
  ): Promise<{ success: boolean; error?: PermissionError; message?: string }> {
    // 查目标 Agent
    const toAgent = await this.prisma.agent.findUnique({ where: { id: msg.toAgentId } });
    if (!toAgent || toAgent.status === "deleted") {
      return { success: false, error: { code: "TARGET_NOT_FOUND", reason: `目标 Agent ${msg.toAgentId} 不存在或已删除。` } };
    }

    // 向上发消息时机约束（#41）
    const timingError = checkUpwardMessageTiming(fromTier, toAgent.tier, inToolRound);
    if (timingError) return { success: false, error: timingError };

    // 跨 Workspace 校验（#19）
    const crossError = checkCrossWorkspace(fromTier, fromWorkspaceId, toAgent.workspaceId);
    if (crossError) return { success: false, error: crossError };

    // depth 校验（#12 防循环）
    const depth = msg.depth ?? 1;
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
        taskRef: msg.taskRef ?? null,
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

    return { success: true, message: "消息已发送。" };
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
    await this.prisma.agentMessage.update({
      where: { id: messageId },
      data: { status: "consumed", deliveredAt: new Date() },
    });
  }
}

let _bus: SwarmBus | null = null;

export function getSwarmBus(prisma: PrismaClient, services: ServiceContainer, config?: any): SwarmBus {
  if (!_bus) {
    const mode = process.env.SWARM_MODE || "local";
    if (mode === "redis") {
      // 动态导入避免未安装 Redis 时崩溃
      import("./redisSwarmBus.js")
        .then(({ RedisSwarmBus }) => {
          if (!_bus) {
            _bus = new RedisSwarmBus(prisma, services, config);
            console.log("  🔗 [SwarmBus] 已切换到 Redis 模式（BullMQ）");
          }
        })
        .catch((err) => {
          console.warn("  ⚠️ [SwarmBus] Redis 模式加载失败，回退到 Local:", err);
          _bus = new LocalSwarmBus(prisma, services);
        });
      // 异步初始化期间临时用 Local 兜底
      _bus = new LocalSwarmBus(prisma, services);
    } else {
      _bus = new LocalSwarmBus(prisma, services);
    }
  }
  return _bus;
}
