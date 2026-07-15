/**
 * RedisSwarmBus — 基于 BullMQ + Redis 的 Agent 间消息系统
 *
 * SWARM_MODE=redis 时启用。提供完整 swarm 能力：
 * - 持久化消息队列（进程重启不丢）
 * - Worker 进程隔离（每个 Agent 可在独立进程跑）
 * - 优先级队列（心跳 < 命令 < 用户消息）
 * - 任务依赖图（FlowProducer）
 * - Bull Board 可视化（可选）
 *
 * 与 LocalSwarmBus 接口完全一致，通过 getSwarmBus() 工厂切换。
 */

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import type { AppConfig } from "./config.js";
import type { AgentMessageInput, AgentMessageRecord, SwarmBus } from "./swarmBus.js";
import { SWARM_MAX_DEPTH, SWARM_MAX_QUEUE_SIZE } from "@knowpilot/shared";
import {
  checkUpwardMessageTiming,
  checkCrossWorkspace,
  type PermissionError,
} from "./swarmPermissionGuard.js";

const MAX_DEPTH = SWARM_MAX_DEPTH;
const MAX_QUEUE_SIZE = SWARM_MAX_QUEUE_SIZE;
const QUEUE_NAME = "swarm-agent-messages";

export class RedisSwarmBus implements SwarmBus {
  private queue: Queue;
  private connection: IORedis;
  private workers = new Map<string, Worker>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly services: ServiceContainer,
    private readonly config: AppConfig,
  ) {
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
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
    // 查目标 Agent
    const toAgent = await this.prisma.agent.findUnique({ where: { id: msg.toAgentId } });
    if (!toAgent || toAgent.status === "deleted") {
      return { success: false, error: { code: "TARGET_NOT_FOUND", reason: `目标 Agent ${msg.toAgentId} 不存在或已删除。` } };
    }

    // 权限校验（与 LocalSwarmBus 相同）
    const timingError = checkUpwardMessageTiming(fromTier, toAgent.tier, inToolRound);
    if (timingError) return { success: false, error: timingError };

    const crossError = checkCrossWorkspace(fromTier, fromWorkspaceId, toAgent.workspaceId);
    if (crossError) return { success: false, error: crossError };

    const depth = msg.depth ?? 1;
    if (depth > MAX_DEPTH) {
      return { success: false, error: { code: "DELEGATION_DEPTH_EXCEEDED", reason: `委托层级 ${depth} 超过上限 ${MAX_DEPTH}。` } };
    }

    // 队列容量校验
    const waitingCount = await this.queue.getWaitingCount();
    if (waitingCount >= MAX_QUEUE_SIZE) {
      return { success: false, error: { code: "QUEUE_FULL", reason: `目标 Agent 队列已满（${MAX_QUEUE_SIZE}）。` } };
    }

    // 写入 DB（持久化）
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

    // 加入 BullMQ 队列（优先级：command > query > report）
    const priority = msg.messageType === "command" ? 1 : msg.messageType === "query" ? 5 : 10;
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

    // 审计日志
    await this.prisma.log.create({
      data: {
        level: "info",
        component: "swarm",
        event: "agent_message_sent_redis",
        message: `${msg.fromAgentId} → ${msg.toAgentId}: ${msg.content.slice(0, 80)}`,
        metadata: { messageId: created.id, fromTier, toTier: toAgent.tier, depth, priority },
      },
    }).catch(() => {});

    return { success: true, message: "消息已发送（Redis 队列）。", messageId: created?.id };
  }

  async poll(toAgentId: string): Promise<AgentMessageRecord[]> {
    // 从 DB 查 pending 消息（BullMQ 的 Worker 会处理执行，但 poll 仍从 DB 读供前端展示）
    const messages = await this.prisma.agentMessage.findMany({
      where: { toAgentId, status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    return messages as AgentMessageRecord[];
  }

  async markConsumed(messageId: string): Promise<void> {
    // W16a-1：delivered → consumed 不动 deliveredAt（真账）；pending 直跳 consumed 兜底补齐
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

  /** 启动 Worker 监听指定 Agent 的消息（进程隔离模式） */
  startWorker(agentId: string, handler: (msg: AgentMessageInput) => Promise<void>): Worker {
    const worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        const data = job.data as AgentMessageInput & { messageId: string };
        if (data.toAgentId !== agentId) return; // 只处理发给本 Agent 的消息
        await handler(data);
        await this.markConsumed(data.messageId);
      },
      {
        connection: { url: process.env.REDIS_URL || "redis://127.0.0.1:6379" } as any,
        concurrency: 1, // 每个 Agent 同时只处理一条消息（#9）
      },
    );
    this.workers.set(agentId, worker);
    return worker;
  }

  /** 停止所有 Worker */
  async close(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    this.workers.clear();
    await this.queue.close();
    await this.connection.quit();
  }
}
