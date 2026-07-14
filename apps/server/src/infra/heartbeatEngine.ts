/**
 * HeartbeatEngine — Agent 心跳机制
 *
 * 基于 node-cron 的定时触发引擎。每个 Agent 可配置 heartbeat：
 *   { enabled: true, cron: "0 9 * * *", goal: "检查并整理..." }
 *
 * 触发时：
 * 1. 检查 Agent 状态（active/idle 才触发，dormant/deleted 跳过）
 * 2. 检查 LLM 预算（耗尽则跳过 + 记录 budget_exceeded）
 * 3. 找到或创建该 Agent 的心跳专用 session（kind="heartbeat"，与主会话/用户对话隔离）
 * 4. 向心跳 session 注入一条 source="system" 的心跳消息
 * 5. 自动触发 agentStream（无需用户发起）
 * 6. 更新 heartbeat.lastRunAt + lastRunStatus + consecutiveFailures
 * 7. 连续失败达 HEARTBEAT_MAX_CONSECUTIVE_FAILURES → 邮件告警用户一次（#4，复用 send_email 通道）
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
import { createMemoryRepository, decayMemories } from "./memoryRepository.js";
import { sendEmailNotification } from "./emailNotifier.js";
import { HEARTBEAT_MAX_CONSECUTIVE_FAILURES } from "@knowpilot/shared";
import {
  closeLoopGate,
  ensureLoopContract,
  recordEvidence,
  resumeLoopContract,
  shouldSkipHeartbeat,
  type LoopContract,
} from "./loopContract.js";

const MAX_CONSECUTIVE_FAILURES = HEARTBEAT_MAX_CONSECUTIVE_FAILURES;

/** W5：记忆衰减维护任务 cron（每日 03:17，避开心跳高峰） */
const MEMORY_DECAY_CRON = "17 3 * * *";

type HeartbeatState = {
  enabled: boolean;
  cron: string;
  goal: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  consecutiveFailures: number;
  loopContract?: LoopContract;
};

export class HeartbeatEngine {
  private jobs = new Map<string, ScheduledTask>();
  private started = false;
  // W5：记忆衰减等维护任务独立于 Agent 心跳 jobs（refresh 全量重建时不被动）
  private maintenanceJob: ScheduledTask | null = null;
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

    // 修复：清理历史未投递的心跳 Task（修复前的残留，避免 pullAsyncDeliveries 误触发）
    try {
      const cleaned = await this.prisma.task.updateMany({
        where: { name: { startsWith: "[heartbeat]" }, delivered: false },
        data: { delivered: true, deliveredAt: new Date() },
      });
      if (cleaned.count > 0) {
        console.log(`  🧹 [HeartbeatEngine] 已清理 ${cleaned.count} 条历史未投递心跳 Task`);
      }
    } catch {
      // 清理失败不阻塞启动
    }

    await this.refresh();

    // W5：记忆衰减维护任务（strength 按日复利衰减 + 低分归档）
    if (!this.maintenanceJob) {
      this.maintenanceJob = cron.schedule(MEMORY_DECAY_CRON, () => {
        void this.runMemoryDecay();
      });
    }

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
    if (this.maintenanceJob) {
      this.maintenanceJob.stop();
      this.maintenanceJob = null;
    }
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
    if (!this.started) return;
    try {
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

      // stop() 可能在 await 期间被调用，此时不应再注册新 cron job
      if (!this.started) return;

      for (const agent of agents) {
        const hb = this.parseHeartbeat(agent.heartbeat);
        if (!hb?.enabled || !hb.cron || !cron.validate(hb.cron)) continue;

        const job = cron.schedule(hb.cron, () => {
          void this.triggerHeartbeat(agent.id);
        });
        this.jobs.set(agent.id, job);
      }
    } catch (err) {
      console.warn(`  💓 [HeartbeatEngine] refresh 失败:`, err instanceof Error ? err.message : err);
    }
  }

  /** W5：每日记忆衰减（失败不阻塞心跳主流程） */
  async runMemoryDecay(): Promise<{ decayed: number; archived: number }> {
    try {
      const repo = createMemoryRepository(this.services);
      const result = await decayMemories(repo, this.prisma);
      if (result.decayed > 0 || result.archived > 0) {
        console.log(`  🧠 [MemoryDecay] 衰减 ${result.decayed} 条，归档删除 ${result.archived} 条`);
      }
      return result;
    } catch (err) {
      console.warn(`  🧠 [MemoryDecay] 执行失败:`, err instanceof Error ? err.message : err);
      return { decayed: 0, archived: 0 };
    }
  }

  /** 手动触发某个 Agent 的心跳（测试/手动用） */
  async triggerHeartbeat(agentId: string): Promise<void> {
    try {
      const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent || agent.status === "deleted" || agent.status === "dormant") return;

      const hb = this.parseHeartbeat(agent.heartbeat);
      if (!hb?.enabled || !hb.goal) return;

      // Phase 1：仅超级 Agent 走 Loop Contract 门禁
      if (agent.tier === "super") {
        const defaults = this.config.heartbeat.loopContract;
        const contract = ensureLoopContract(hb.goal, hb.loopContract, defaults);
        const gate = shouldSkipHeartbeat(contract);
        if (gate.skip) {
          console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 心跳跳过（${gate.reason}）`);
          return;
        }
        // 首次确保 contract 落库（goal 对齐）
        if (!hb.loopContract) {
          await this.persistHeartbeat(agentId, { ...hb, loopContract: contract });
        }
      }

      // 预算检查（#14）
      try {
        assertLlmBudget(this.config);
      } catch {
        await this.updateHeartbeatStatus(agentId, "budget_exceeded", hb, {
          evidenceSummary: "LLM 预算耗尽，跳过本轮",
          applyLoopContract: agent.tier === "super",
        });
        console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 心跳跳过（LLM 预算耗尽）`);
        return;
      }

      // 找到或创建心跳专用 session（与 isMainSession 主会话隔离，避免污染用户对话）
      let session = await this.prisma.chatSession.findFirst({
        where: { agentId: agent.id, kind: "heartbeat" },
        orderBy: { updatedAt: "desc" },
      });
      if (!session) {
        session = await this.prisma.chatSession.create({
          data: {
            title: `${agent.name} 心跳`,
            model: agent.heartbeatModel || agent.model,
            agentId: agent.id,
            kind: "heartbeat",
            isMainSession: false,
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
      // 走 MessageService.create 以广播 message_upserted（INV-6：消息持久化广播一致性），
      // 否则心跳消息只在 DB、前端 MessageStore 收不到 → 心跳触发的会话前端看不到触发消息直到刷新。
      await this.services.message.create({
        sessionId: session.id,
        role: "user",
        content: `[心跳触发] ${hb.goal}`,
        source: "system",
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
                // 修复：心跳 Task 标记已投递，避免 pullAsyncDeliveries 误判为待投递异步结果
                delivered: true,
                deliveredAt: new Date(),
              },
            });
            await this.updateHeartbeatStatus(agentId, "success", hb, {
              evidenceSummary: typeof loop.content === "string" ? loop.content.slice(0, 500) : "心跳完成",
              taskId: task.id,
              applyLoopContract: agent.tier === "super",
            });
            console.log(`  💓 [HeartbeatEngine] Agent ${agent.name} 心跳完成`);
          } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === "AbortError";
            const reason = isAbort ? "cancelled" : "failed";
            await this.prisma.task.update({
              where: { id: task.id },
              data: {
                status: "failed",
                output: { error: err instanceof Error ? err.message : String(err) },
                // 修复：心跳 Task 失败也标记已投递，避免 pullAsyncDeliveries 误判
                delivered: true,
                deliveredAt: new Date(),
              },
            }).catch((err) => {
              console.warn(`  💓 [HeartbeatEngine] 标记心跳任务 failed 失败 task=${task.id}:`, err instanceof Error ? err.message : err);
            });
            await this.updateHeartbeatStatus(agentId, reason, hb, {
              evidenceSummary: err instanceof Error ? err.message : String(err),
              taskId: task.id,
              applyLoopContract: agent.tier === "super",
            });

            // 连续失败达阈值 → 邮件告警（#4）。=== 判定：每个失败 streak 只告警一次，
            // 避免第 4、5… 次失败重复轰炸收件箱；streak 清零（success）后再次达阈值会重新告警
            if (reason === "failed") {
              const updatedHb = this.parseHeartbeat(
                (await this.prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } }))?.heartbeat,
              );
              if (updatedHb && updatedHb.consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
                const lastError = err instanceof Error ? err.message : String(err);
                const notify = await sendEmailNotification(this.config, this.services.log, {
                  subject: `[KnowPilot] Agent「${agent.name}」心跳连续失败 ${updatedHb.consecutiveFailures} 次`,
                  body: `Agent「${agent.name}」（${agentId}）心跳已连续失败 ${updatedHb.consecutiveFailures} 次。\n最近一次错误：${lastError}\n请检查 LLM 配置与该 Agent 状态，必要时在 /agents 页调整或停用心跳。`,
                  agentId,
                });
                if ("error" in notify) {
                  console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 连续失败 ${updatedHb.consecutiveFailures} 次，邮件告警未发送：${notify.error}`);
                } else {
                  console.log(`  💓 [HeartbeatEngine] Agent ${agent.name} 连续失败 ${updatedHb.consecutiveFailures} 次，已邮件告警用户`);
                }
              }
            }
          }
        },
      });
    } catch (err: unknown) {
      console.error(`  ❌ [HeartbeatEngine] Agent ${agentId} 心跳触发失败:`, err instanceof Error ? err.message : err);
    }
  }

  private parseHeartbeat(raw: unknown): HeartbeatState | null {
    if (!raw || typeof raw !== "object") return null;
    const hb = raw as Record<string, unknown>;
    return {
      enabled: hb.enabled === true,
      cron: String(hb.cron ?? "0 9 * * *"),
      goal: String(hb.goal ?? ""),
      lastRunAt: (hb.lastRunAt as string | null) ?? null,
      lastRunStatus: (hb.lastRunStatus as string | null) ?? null,
      consecutiveFailures: Number(hb.consecutiveFailures ?? 0),
      loopContract: hb.loopContract as LoopContract | undefined,
    };
  }

  private async persistHeartbeat(agentId: string, hb: HeartbeatState): Promise<void> {
    await this.prisma.agent.update({
      where: { id: agentId },
      data: { heartbeat: hb as object },
    });
  }

  /**
   * 读取超级 Agent 的 Loop Contract（无则按 goal 生成默认，不落库）
   */
  async getLoopContract(agentId: string): Promise<LoopContract | null> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.tier !== "super") return null;
    const hb = this.parseHeartbeat(agent.heartbeat);
    if (!hb?.goal) return null;
    return ensureLoopContract(hb.goal, hb.loopContract, this.config.heartbeat.loopContract);
  }

  /** 人工恢复：开 gate + handoff，清 stop 原因 */
  async resumeLoopContract(agentId: string): Promise<LoopContract> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error(`Agent 不存在: ${agentId}`);
    if (agent.tier !== "super") throw new Error("Loop Contract Phase 1 仅支持超级 Agent");
    const hb = this.parseHeartbeat(agent.heartbeat);
    if (!hb?.goal) throw new Error("Agent 未配置心跳 goal");
    const next = resumeLoopContract(
      ensureLoopContract(hb.goal, hb.loopContract, this.config.heartbeat.loopContract),
    );
    await this.persistHeartbeat(agentId, { ...hb, loopContract: next });
    return next;
  }

  /** 人工关 gate（停心跳触发，直至 resume） */
  async closeLoopGate(agentId: string, reason?: string): Promise<LoopContract> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error(`Agent 不存在: ${agentId}`);
    if (agent.tier !== "super") throw new Error("Loop Contract Phase 1 仅支持超级 Agent");
    const hb = this.parseHeartbeat(agent.heartbeat);
    if (!hb?.goal) throw new Error("Agent 未配置心跳 goal");
    const next = closeLoopGate(
      ensureLoopContract(hb.goal, hb.loopContract, this.config.heartbeat.loopContract),
      reason,
    );
    await this.persistHeartbeat(agentId, { ...hb, loopContract: next });
    return next;
  }

  private async updateHeartbeatStatus(
    agentId: string,
    status: "success" | "failed" | "cancelled" | "budget_exceeded",
    prevHb: HeartbeatState,
    opts?: {
      evidenceSummary?: string;
      taskId?: string;
      applyLoopContract?: boolean;
    },
  ): Promise<void> {
    const consecutiveFailures =
      status === "success" ? 0 : status === "failed" ? prevHb.consecutiveFailures + 1 : prevHb.consecutiveFailures;

    const current = this.parseHeartbeat(
      (await this.prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } }))?.heartbeat,
    );

    let loopContract = current?.loopContract ?? prevHb.loopContract;
    if (opts?.applyLoopContract) {
      const defaults = this.config.heartbeat.loopContract;
      const base = ensureLoopContract(prevHb.goal, loopContract, defaults);
      loopContract = recordEvidence(
        base,
        {
          at: new Date().toISOString(),
          summary: opts.evidenceSummary ?? status,
          taskId: opts.taskId,
          status,
        },
        defaults,
      );
      if (!loopContract.handoff) {
        console.warn(`  💓 [HeartbeatEngine] Loop Contract 停止交回: ${loopContract.stoppedReason}`);
      }
    }

    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        heartbeat: {
          ...(current ?? prevHb),
          lastRunAt: new Date().toISOString(),
          lastRunStatus: status,
          consecutiveFailures,
          ...(loopContract ? { loopContract } : {}),
        } as object,
        status: status === "success" ? "active" : "idle",
      },
    }).catch((err) => {
      console.warn(`  💓 [HeartbeatEngine] 更新心跳状态失败 agent=${agentId}:`, err instanceof Error ? err.message : err);
    });
  }
}

let _engine: HeartbeatEngine | null = null;
let _enginePrisma: PrismaClient | null = null;

export function getHeartbeatEngine(prisma: PrismaClient, services: ServiceContainer, config: AppConfig): HeartbeatEngine {
  // 测试隔离：prisma 不匹配时重建
  if (_engine && _enginePrisma !== prisma) {
    _engine.stop();
    _engine = null;
    _enginePrisma = null;
  }
  if (!_engine) {
    _engine = new HeartbeatEngine(prisma, services, config);
    _enginePrisma = prisma;
  }
  return _engine;
}

export function resetHeartbeatEngineForTests(): void {
  if (_engine) _engine.stop();
  _engine = null;
  _enginePrisma = null;
}
