/**
 * HeartbeatEngine — Agent 心跳机制
 *
 * 基于 node-cron 的定时触发引擎。每个 Agent 可配置 heartbeat：
 *   { enabled: true, cron: "0 9 * * *", goal: "检查并整理..." }
 *
 * 触发时：
 * 1. 检查 Agent 状态（active/idle 才触发，dormant/deleted 跳过）
 * 2. 检查 LLM 预算（耗尽则跳过 + 记录 budget_exceeded）
 * 3. 找到或创建该 Agent 的主 session
 * 4. 向主 session 注入一条 source="system" 的心跳消息
 * 5. 自动触发 agentStream（无需用户发起）
 * 6. 更新 heartbeat.lastRunAt + lastRunStatus + consecutiveFailures
 * 7. 连续失败 3 次 → 邮件通知用户（#4）
 *
 * 并发控制：心跳任务走 asyncJobOrchestrator，与手动启动的任务共享并发池（#13）
 */

import cron, { type ScheduledTask } from "node-cron";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { getAsyncJobOrchestrator } from "./asyncJobOrchestrator.js";
import { assertLlmBudget } from "./llmBudget.js";
import { getEventBus, type EntityEventPayload } from "./eventBus.js";

const MAX_CONSECUTIVE_FAILURES = 3;

export class HeartbeatEngine {
  private jobs = new Map<string, ScheduledTask>();
  private started = false;
  // A14：事件驱动 refresh 的防抖句柄与监听器引用（stop 时清理）
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private eventHandler: ((payload: EntityEventPayload<unknown>) => void) | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly services: ServiceContainer,
    private readonly config: AppConfig,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.refresh();

    console.log(`  💓 [HeartbeatEngine] 启动完成，共 ${this.jobs.size} 个心跳任务`);

    // A14：监听 agent 配置变更事件，防抖后增量刷新 cron 注册，替代此前每 60s 全量轮询重建。
    const bus = getEventBus();
    this.eventHandler = () => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        void this.refresh();
      }, 500);
    };
    for (const ev of ["agent.created", "agent.updated", "agent.deleted"]) {
      bus.on(ev as any, this.eventHandler);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.eventHandler) {
      const bus = getEventBus();
      for (const ev of ["agent.created", "agent.updated", "agent.deleted"]) {
        bus.off(ev as any, this.eventHandler);
      }
      this.eventHandler = null;
    }
    this.started = false;
    console.log("  💓 [HeartbeatEngine] 已停止");
  }

  /** 全量刷新心跳注册（Agent 配置变更后生效） */
  async refresh(): Promise<void> {
    // 停止所有现有任务
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();

    // 重新加载
    const agents = await this.prisma.agent.findMany({
      where: {
        status: { in: ["active", "idle"] },
        tier: { in: ["super", "manager", "sub"] },
      },
    });

    for (const agent of agents) {
      const hb = this.parseHeartbeat(agent.heartbeat);
      if (!hb?.enabled || !hb.cron || !cron.validate(hb.cron)) continue;

      const job = cron.schedule(hb.cron, () => {
        void this.triggerHeartbeat(agent.id);
      });
      this.jobs.set(agent.id, job);
    }
  }

  /** 手动触发某个 Agent 的心跳（测试/手动用） */
  async triggerHeartbeat(agentId: string): Promise<void> {
    try {
      const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent || agent.status === "deleted" || agent.status === "dormant") return;

      const hb = this.parseHeartbeat(agent.heartbeat);
      if (!hb?.enabled || !hb.goal) return;

      // 预算检查（#14）
      try {
        assertLlmBudget(this.config);
      } catch {
        await this.updateHeartbeatStatus(agentId, "budget_exceeded", hb);
        console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 心跳跳过（LLM 预算耗尽）`);
        return;
      }

      // 找到或创建主 session
      let session = await this.prisma.chatSession.findFirst({
        where: { agentId: agent.id, isMainSession: true },
      });
      if (!session) {
        session = await this.prisma.chatSession.create({
          data: {
            title: `${agent.name} 主会话`,
            model: agent.heartbeatModel || agent.model,
            agentId: agent.id,
            isMainSession: true,
            status: "active",
          },
        });
      }

      // 检查 session 是否正在流式（#9：每个 Agent 同时只处理一个流式任务）
      const runningTask = await this.prisma.task.findFirst({
        where: { sessionId: session.id, status: "running" },
      });
      if (runningTask) {
        console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 正在执行任务，跳过本次心跳`);
        return;
      }

      // 注入心跳消息（source="system"）
      await this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "user",
          content: `[心跳触发] ${hb.goal}`,
          source: "system",
        },
      });

      // 通过 asyncJobOrchestrator 启动 Agent 执行（并发控制 #13）
      const orchestrator = getAsyncJobOrchestrator(this.config);
      const heartbeatModel = agent.heartbeatModel || agent.model;
      const agentSnapshot = {
        id: agent.id,
        model: heartbeatModel,
        systemPrompt: agent.systemPrompt,
        tools: agent.tools ? agent.tools.split(",").filter(Boolean) : [],
        tier: agent.tier,
        workspaceId: agent.workspaceId,
        parentId: agent.parentId,
      };

      // 创建 Task 记录
      const task = await this.prisma.task.create({
        data: {
          name: `[heartbeat] ${agent.name}`,
          type: "oneshot",
          status: "running",
          sessionId: session.id,
          input: {
            kind: "heartbeat",
            agentId: agent.id,
            sessionId: session.id,
            goal: hb.goal,
            agentSnapshot,
          },
        },
      });

      // 通过 orchestrator 执行（复用 asyncJobManager 的执行逻辑）
      const { startAsyncAgentTask } = await import("./asyncJobManager.js");
      // 心跳不通过 startAsyncAgentTask（那个会创建 subagent session），
      // 而是直接通过 orchestrator 跑一个简化的 agent loop
      orchestrator.enqueue({
        jobId: task.id,
        sessionId: session.id,
        execute: async (signal) => {
          try {
            const { runAgentLoop } = await import("./agentRuntime.js");
            // 心跳执行的 tRPC 调用：直接用 service container 构造简化 caller
            const invokeTrpc = async (tool: string, args?: unknown) => {
              // 简化：心跳触发的 Agent 主要用 native 工具，不走 tRPC 路由
              // 如果需要调用 tRPC，由 agentTools 内部的 invokeTrpc 处理
              return undefined;
            };

            const loop = await runAgentLoop({
              config: this.config,
              services: this.services,
              agent: {
                model: heartbeatModel,
                systemPrompt: `${agent.systemPrompt}\n\n你因心跳机制被自动唤醒。任务目标：${hb.goal}\n完成后用简洁中文汇总结果。`,
                tools: agentSnapshot.tools,
              },
              messages: [{ role: "user", content: hb.goal }],
              invokeTrpc,
              signal,
            });

            await this.prisma.task.update({
              where: { id: task.id },
              data: {
                status: "success",
                output: { asyncResult: loop.content, tokenUsage: loop.tokenUsage },
              },
            });
            await this.updateHeartbeatStatus(agentId, "success", hb);
            console.log(`  💓 [HeartbeatEngine] Agent ${agent.name} 心跳完成`);
          } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === "AbortError";
            const reason = isAbort ? "cancelled" : "failed";
            await this.prisma.task.update({
              where: { id: task.id },
              data: {
                status: "failed",
                output: { error: err instanceof Error ? err.message : String(err) },
              },
            }).catch(() => {});
            await this.updateHeartbeatStatus(agentId, reason, hb);

            // 连续失败 3 次 → 邮件通知（#4）
            if (reason === "failed") {
              const updatedHb = this.parseHeartbeat(
                (await this.prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } }))?.heartbeat,
              );
              if (updatedHb && updatedHb.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 连续失败 ${updatedHb.consecutiveFailures} 次，应邮件通知用户`);
                // 邮件通知在 Phase 5 实现（send_email 工具），此处仅记日志
              }
            }
          }
        },
      });
    } catch (err: unknown) {
      console.error(`  ❌ [HeartbeatEngine] Agent ${agentId} 心跳触发失败:`, err instanceof Error ? err.message : err);
    }
  }

  private parseHeartbeat(raw: unknown): { enabled: boolean; cron: string; goal: string; lastRunAt: string | null; lastRunStatus: string | null; consecutiveFailures: number } | null {
    if (!raw || typeof raw !== "object") return null;
    const hb = raw as Record<string, unknown>;
    return {
      enabled: hb.enabled === true,
      cron: String(hb.cron ?? "0 9 * * *"),
      goal: String(hb.goal ?? ""),
      lastRunAt: (hb.lastRunAt as string | null) ?? null,
      lastRunStatus: (hb.lastRunStatus as string | null) ?? null,
      consecutiveFailures: Number(hb.consecutiveFailures ?? 0),
    };
  }

  private async updateHeartbeatStatus(
    agentId: string,
    status: "success" | "failed" | "cancelled" | "budget_exceeded",
    prevHb: { consecutiveFailures: number },
  ): Promise<void> {
    const consecutiveFailures =
      status === "success" ? 0 : status === "failed" ? prevHb.consecutiveFailures + 1 : prevHb.consecutiveFailures;

    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        heartbeat: {
          ...this.parseHeartbeat((await this.prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } }))?.heartbeat),
          lastRunAt: new Date().toISOString(),
          lastRunStatus: status,
          consecutiveFailures,
        },
        status: status === "success" ? "active" : "idle",
      },
    }).catch(() => {});
  }
}

let _engine: HeartbeatEngine | null = null;

export function getHeartbeatEngine(prisma: PrismaClient, services: ServiceContainer, config: AppConfig): HeartbeatEngine {
  if (!_engine) {
    _engine = new HeartbeatEngine(prisma, services, config);
  }
  return _engine;
}
