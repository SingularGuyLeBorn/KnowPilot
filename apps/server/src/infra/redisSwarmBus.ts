/**
 * RedisSwarmBus — SQLite AgentMessage 邮箱 + BullMQ 持久化旁路（SWARM_MODE=redis）
 *
 * 与 LocalSwarmBus 语义对齐：
 * - 权限 / depth / 向上时机（含 allowReportTool）/ 跨 Workspace
 * - 队列容量按 **目标 Agent** pending 计数（非全局 BullMQ waiting）
 * - 写入后 notifyAgentMessage → SessionStreamHub
 *
 * BullMQ 用于跨进程可观测与未来 Worker；当前消费仍走 DB + superior drain（与 local 同路径）。
 * startWorker 暂不挂载到启动序列（共享队列 + 按 toAgentId 过滤会吞消息）。
 */

import { Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import type { AppConfig } from "./config.js";
import type { AgentMessageInput, AgentMessageRecord, SwarmBus } from "./swarmBus.js";
import { resolveServerDelegationDepth } from "./delegationDepth.js";
import { SWARM_MAX_DEPTH, SWARM_MAX_QUEUE_SIZE } from "@knowpilot/shared";
import {
  checkUpwardMessageTiming,
  checkCrossWorkspace,
  type PermissionError,
} from "./swarmPermissionGuard.js";
import { getRedisUrl } from "./redisClient.js";

const MAX_DEPTH = SWARM_MAX_DEPTH;
const MAX_QUEUE_SIZE = SWARM_MAX_QUEUE_SIZE;
const QUEUE_NAME = "swarm-agent-messages";

export class RedisSwarmBus implements SwarmBus {
  private queue: Queue;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly services: ServiceContainer,
    private readonly _config: AppConfig | undefined,
  ) {
    void this.services;
    void this._config;
    const redisUrl = getRedisUrl();
    this.queue = new Queue(QUEUE_NAME, {
      connection: { url: redisUrl } as any,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  async send(
    msg: AgentMessageInput,
    fromTier: string,
    fromWorkspaceId: string | null,
    inToolRound: boolean,
  ): Promise<{ success: boolean; error?: PermissionError; message?: string; messageId?: string }> {
    const toAgent = await this.prisma.agent.findUnique({ where: { id: msg.toAgentId } });
    if (!toAgent || toAgent.status === "deleted") {
      return {
        success: false,
        error: { code: "TARGET_NOT_FOUND", reason: `目标 Agent ${msg.toAgentId} 不存在或已删除。` },
      };
    }

    const timingError = checkUpwardMessageTiming(fromTier, toAgent.tier, inToolRound, {
      allowReportTool: msg.messageType === "report",
    });
    if (timingError) return { success: false, error: timingError };

    const crossError = checkCrossWorkspace(fromTier, fromWorkspaceId, toAgent.workspaceId, {
      toTier: toAgent.tier,
    });
    if (crossError) return { success: false, error: crossError };

    // B5：depth 服务端物化——不读调用方入参
    const depth = await resolveServerDelegationDepth(this.prisma, msg.fromAgentId);
    if (depth > MAX_DEPTH) {
      return {
        success: false,
        error: {
          code: "DELEGATION_DEPTH_EXCEEDED",
          reason: `委托层级 ${depth} 超过上限 ${MAX_DEPTH}，可能存在循环委托。`,
        },
      };
    }

    const pendingCount = await this.prisma.agentMessage.count({
      where: { toAgentId: msg.toAgentId, status: "pending" },
    });
    if (pendingCount >= MAX_QUEUE_SIZE) {
      return {
        success: false,
        error: {
          code: "QUEUE_FULL",
          reason: `目标 Agent 队列已满（${MAX_QUEUE_SIZE} 条），请先处理已有消息。`,
        },
      };
    }

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

    const priority = msg.messageType === "command" ? 1 : msg.messageType === "query" ? 5 : 10;
    try {
      await this.queue.add(
        "agent-message",
        {
          messageId: created.id,
          fromAgentId: msg.fromAgentId,
          toAgentId: msg.toAgentId,
          content: msg.content,
          messageType: msg.messageType ?? "command",
          source: msg.source ?? fromTier,
          depth,
        },
        { priority },
      );
    } catch (err) {
      console.warn("[RedisSwarmBus] BullMQ enqueue 失败（DB 消息已落库，继续 Local 等价路径）:", err);
    }

    await this.prisma.log
      .create({
        data: {
          level: "info",
          component: "swarm",
          event: "agent_message_sent_redis",
          message: `${msg.fromAgentId} → ${msg.toAgentId}: ${msg.content.slice(0, 80)}`,
          metadata: {
            messageId: created.id,
            fromTier,
            toTier: toAgent.tier,
            depth,
            priority,
            messageType: msg.messageType ?? "command",
          },
        },
      })
      .catch(() => {});

    void this.notifyAgentMessage({
      toAgentId: msg.toAgentId,
      messageId: created.id,
      content: msg.content,
      fromAgentId: msg.fromAgentId,
      source: msg.source ?? fromTier,
    });

    return { success: true, message: "消息已发送（Redis 旁路）。", messageId: created.id };
  }

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
      console.warn(`[RedisSwarmBus] agent_message 推送失败:`, err);
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

  async close(): Promise<void> {
    await this.queue.close();
  }
}
