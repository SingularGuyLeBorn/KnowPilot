/**
 * HeartbeatEngine — Agent 心跳机制
 *
 * 基于 node-cron 的定时触发引擎。每个 Agent 可配置 heartbeat：
 *   { enabled: true, cron: "0 9 * * *", goal: "检查并整理..." }
 *
 * 触发时：
 * 1. 检查 Agent 状态（active/idle 才触发，dormant/deleted 跳过；W12 suspended 暂停态跳过）
 * 2. 检查 LLM 预算（耗尽则跳过 + 记录 budget_exceeded）
 * 3. 找到或创建该 Agent 的心跳专用 session（kind="heartbeat"，与主会话/用户对话隔离）
 * 4. 向心跳 session 注入一条 source="system" 的心跳消息
 * 5. 自动触发 agentStream（无需用户发起）
 * 6. 更新 heartbeat.lastRunAt + lastRunStatus + consecutiveFailures
 * 7. 连续失败达 HEARTBEAT_MAX_CONSECUTIVE_FAILURES → 邮件告警用户一次（#4，复用 send_email 通道）
 *    + W12：暂停该 Agent 心跳（suspended 熔断，见 suspendHeartbeat 注释的恢复语义）
 *
 * 并发控制：心跳任务走 asyncJobOrchestrator，与手动启动的任务共享并发池（#13）
 *
 * 维护任务（独立于 Agent 心跳 jobs，refresh() 重建不触碰）：
 * - W5 记忆衰减（每日 03:17）
 * - W12 审批过期清理（每日 04:03，复用 W1 expireStaleApprovals 的 updateMany 实现）
 */

import cron, { type ScheduledTask } from "node-cron";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { getSwarmOrchestrator, type SwarmTaskOutcome } from "./swarmOrchestrator.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { assertLlmBudget } from "./llmBudget.js";
import { getEventBus, type EntityEventPayload } from "./eventBus.js";
import { expireStaleApprovals } from "./approvalGate.js";
import { createMemoryRepository, decayMemories, consolidateMemories } from "./memoryRepository.js";
import { sendEmailNotification } from "./emailNotifier.js";
import { claimExclusiveSessionTaskRun } from "./taskClaim.js";
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

/** W12：审批过期清理维护任务 cron（每日 04:03，与记忆衰减错开） */
const APPROVAL_CLEANUP_CRON = "3 4 * * *";

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
  // W12：审批过期清理维护任务（同 maintenanceJob 通道，不随 refresh 重建）
  private approvalCleanupJob: ScheduledTask | null = null;
  // A14：事件驱动 refresh 的防抖句柄与监听器引用（stop 时清理）
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private eventHandler: ((payload: EntityEventPayload<unknown>) => void) | null = null;
  /** C2：refresh 串行链——新调用挂到上一条之后，禁止交叠 clear/schedule */
  private refreshChain: Promise<void> = Promise.resolve();
  /** C2：代际令牌——每次 refresh 递增；过期代际放弃注册并 stop 已建 job */
  private refreshGeneration = 0;
  /** @internal 测试注入：在 refresh 的 await 间隙挂起，制造交叠窗口 */
  private refreshYieldHook: (() => Promise<void>) | null = null;

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
    // Hermes：同通道挂 skill curator（stale/archive，非硬删）
    if (!this.maintenanceJob) {
      this.maintenanceJob = cron.schedule(MEMORY_DECAY_CRON, () => {
        void this.runMemoryDecay();
        void this.runSkillCurator();
      });
    }

    // W12：审批过期清理维护任务（启动时的一次性清理在 index.ts，这里负责每日定时清扫）
    if (!this.approvalCleanupJob) {
      this.approvalCleanupJob = cron.schedule(APPROVAL_CLEANUP_CRON, () => {
        void this.runApprovalCleanup();
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
    if (this.approvalCleanupJob) {
      this.approvalCleanupJob.stop();
      this.approvalCleanupJob = null;
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
    // 作废在途 refresh：代际递增后旧 refreshInternal 见 mismatch 即放弃注册
    this.refreshGeneration++;
    console.log("  💓 [HeartbeatEngine] 已停止");
  }

  /** @internal 测试用：注入 refresh await 间隙挂起钩子 */
  __setRefreshYieldForTests(hook: (() => Promise<void>) | null): void {
    this.refreshYieldHook = hook;
  }

  /** @internal 测试用：当前已注册的 Agent 心跳 cron 数 */
  __getJobCountForTests(): number {
    return this.jobs.size;
  }

  /**
   * 全量刷新心跳注册（Agent 配置变更后生效）。
   * C2：单条 promise 链串行化 + generation 令牌（链防交错，令牌防 stop/start 泄漏）。
   * 连续多次 refresh coalesce 为「只落地最新一代」。
   */
  async refresh(): Promise<void> {
    if (!this.started) return;
    const gen = ++this.refreshGeneration;
    const run = () => this.refreshInternal(gen);
    const next = this.refreshChain.then(run, run);
    this.refreshChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async refreshAborted(gen: number): Promise<boolean> {
    if (!this.started || gen !== this.refreshGeneration) {
      for (const job of this.jobs.values()) job.stop();
      this.jobs.clear();
      return true;
    }
    return false;
  }

  private async refreshInternal(gen: number): Promise<void> {
    // 已被更新一代取代：直接跳过（coalesce）
    if (!this.started || gen !== this.refreshGeneration) return;

    try {
      // 停止所有现有任务
      for (const job of this.jobs.values()) job.stop();
      this.jobs.clear();

      // W12/W16d-2：suspended 持久化在 Agent 行（heartbeatSuspendedAt），refresh 不再连坐恢复。
      // 个体化恢复：仅摘除「连续失败计数已清零」的个体——计数清零只可能来自
      // ① AgentService.update 检测到心跳配置变更（人工修复信号）；② 上次成功运行。
      // 依旧达阈值的个体保持 suspended（重启/无关 Agent 变更不再误恢复）。
      const suspendedRows = await this.prisma.agent.findMany({
        where: { heartbeatSuspendedAt: { not: null } },
        select: { id: true, heartbeat: true },
      });
      if (await this.refreshAborted(gen)) return;
      if (this.refreshYieldHook) await this.refreshYieldHook();
      if (await this.refreshAborted(gen)) return;

      for (const row of suspendedRows) {
        if (await this.refreshAborted(gen)) return;
        const hb = this.parseHeartbeat(row.heartbeat);
        if ((hb?.consecutiveFailures ?? 0) < MAX_CONSECUTIVE_FAILURES) {
          await this.prisma.agent.update({
            where: { id: row.id },
            data: { heartbeatSuspendedAt: null },
          });
          console.log(`  💓 [HeartbeatEngine] Agent ${row.id} 连续失败计数已清零，心跳 suspended 已摘除`);
        }
      }

      if (await this.refreshAborted(gen)) return;

      // 重新加载
      const agents = await this.prisma.agent.findMany({
        where: {
          status: { in: ["active", "idle"] },
          tier: { in: ["super", "manager", "sub"] },
        },
      });
      if (await this.refreshAborted(gen)) return;
      if (this.refreshYieldHook) await this.refreshYieldHook();
      if (await this.refreshAborted(gen)) return;

      for (const agent of agents) {
        if (await this.refreshAborted(gen)) return;
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

  /** W5：每日记忆衰减 + 整合（过期退役 / 重复去重；失败不阻塞心跳主流程） */
  async runMemoryDecay(): Promise<{
    decayed: number;
    archived: number;
    expired: number;
    duplicatesRemoved: number;
  }> {
    try {
      const repo = createMemoryRepository(this.services);
      const result = await decayMemories(repo, this.prisma);
      const consolidated = await consolidateMemories(this.prisma, async (id) => {
        const r = await this.services.memory.delete(id);
        return r.success;
      });
      if (
        result.decayed > 0 ||
        result.archived > 0 ||
        consolidated.expired > 0 ||
        consolidated.duplicatesRemoved > 0
      ) {
        console.log(
          `  🧠 [MemoryDecay] 衰减 ${result.decayed} 条，归档 ${result.archived} 条，过期退役 ${consolidated.expired} 条，重复清理 ${consolidated.duplicatesRemoved} 条`,
        );
      }
      return { ...result, ...consolidated };
    } catch (err) {
      console.warn(`  🧠 [MemoryDecay] 执行失败:`, err instanceof Error ? err.message : err);
      return { decayed: 0, archived: 0, expired: 0, duplicatesRemoved: 0 };
    }
  }

  /** Hermes：Skill curator（agent-created 闲置 → stale/archive） */
  async runSkillCurator(): Promise<void> {
    try {
      const { maybeRunSkillCurator } = await import("./skillCurator.js");
      const r = await maybeRunSkillCurator(this.services, this.config);
      if (r.ran && (r.archived.length > 0 || r.staleMarked.length > 0)) {
        console.log(
          `  📚 [SkillCurator] stale=${r.staleMarked.length} archived=${r.archived.length}`,
        );
      }
    } catch (err) {
      console.warn(`  📚 [SkillCurator] 执行失败:`, err instanceof Error ? err.message : err);
    }
  }

  /** W12：每日审批过期清理（复用 W1 expireStaleApprovals；失败不阻塞心跳主流程） */
  async runApprovalCleanup(): Promise<number> {
    try {
      const n = await expireStaleApprovals(this.services);
      if (n > 0) {
        console.log(`  ⚠️ [ApprovalCleanup] 已将 ${n} 条过期 pending 审批标为 rejected`);
      }
      return n;
    } catch (err) {
      console.warn(`  ⚠️ [ApprovalCleanup] 执行失败:`, err instanceof Error ? err.message : err);
      return 0;
    }
  }

  /** 手动触发某个 Agent 的心跳（测试/手动用） */
  async triggerHeartbeat(agentId: string): Promise<void> {
    try {
      const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent || agent.status === "deleted" || agent.status === "dormant") return;

      // W12/W16d-2：suspended 熔断暂停态跳过（持久化在 Agent 行；恢复：resumeHeartbeat() 或
      // 心跳配置变更清零计数后由 refresh() 个体化摘除）
      if (agent.heartbeatSuspendedAt) {
        console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 心跳已 suspended（连续失败达阈值），跳过`);
        return;
      }

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

      // 注入心跳消息（source="system"）
      // 走 MessageService.create 以广播 message_upserted（INV-6：消息持久化广播一致性），
      // 否则心跳消息只在 DB、前端 MessageStore 收不到 → 心跳触发的会话前端看不到触发消息直到刷新。
      await this.services.message.create({
        sessionId: session.id,
        role: "user",
        content: `[心跳触发] ${hb.goal}`,
        source: "system",
      });

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

      // C1：入队先落 queued；获槽/真正起跑时再原子认领 running（与池口径合一）
      const task = await this.prisma.task.create({
        data: {
          name: `[heartbeat] ${agent.name}`,
          type: "oneshot",
          status: "queued",
          queuedAt: new Date(),
          reentrant: false,
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

      // W10：心跳执行统一走 SwarmOrchestrator 中介者（并发池/结果聚合/Log 审计公共骨架，#13 并发控制不变）；
      // LoopContract、预算检查、心跳状态回写等入口语义保留在本闭包内，不搬进中介者。
      const orchestrator = getSwarmOrchestrator(this.config, this.services);
      try {
        await orchestrator.dispatch({
          origin: "heartbeat",
          schedule: "pool",
          sessionId: session.id,
          workspaceId: agent.workspaceId ?? null,
          jobId: task.id,
          taskLabel: `[heartbeat] ${agent.name}`,
          execute: async (signal): Promise<SwarmTaskOutcome> => {
            // 重叠闸 = 会话级原子认领：同 session 已有 running 或本行已被抢 → 落选收尾，不计失败 streak
            const claimed = await claimExclusiveSessionTaskRun(this.prisma, task.id, session.id);
            if (!claimed) {
              await this.prisma.task.updateMany({
                where: { id: task.id, status: { in: ["queued", "running"] } },
                data: {
                  status: "cancelled",
                  finishedAt: new Date(),
                  output: { error: "重叠跳过：同会话已有执行中任务" },
                  delivered: true,
                  deliveredAt: new Date(),
                },
              });
              console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} 正在执行任务，跳过本次心跳`);
              return { status: "failed", error: "重叠跳过" };
            }

            try {
              const { runAgentLoop } = await import("./agentRuntime.js");
              // W10：删除返回 undefined 的 invokeTrpc 桩——心跳 Agent 与 trigger/async 入口
              // 共用同一 invokeTrpc 通道，invoke_api 等工具调用拿到真实 tRPC 结果回传 ReAct 循环。
              const invokeTrpc = createTrpcInvoker({ services: this.services, prisma: this.prisma });

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
                // W11：补全 run 上下文，心跳 Run 行可溯源（agent/session/runOrigin）
                sessionId: session.id,
                agentMeta: agentSnapshot,
                runOrigin: "heartbeat",
                runInput: { heartbeat: true, goal: hb.goal, taskId: task.id },
              });

              await this.prisma.task.update({
                where: { id: task.id },
                data: {
                  status: "success",
                  finishedAt: new Date(),
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
              return {
                status: "success",
                content: typeof loop.content === "string" ? loop.content.slice(0, 500) : "心跳完成",
              };
            } catch (err: unknown) {
              const isAbort = err instanceof Error && err.name === "AbortError";
              const reason = isAbort ? "cancelled" : "failed";
              await this.prisma.task.update({
                where: { id: task.id },
                data: {
                  status: "failed",
                  finishedAt: new Date(),
                  output: { error: err instanceof Error ? err.message : String(err) },
                  // 修复：心跳 Task 失败也标记已投递，避免 pullAsyncDeliveries 误判
                  delivered: true,
                  deliveredAt: new Date(),
                },
              }).catch((markErr) => {
                console.warn(`  💓 [HeartbeatEngine] 标记心跳任务 failed 失败 task=${task.id}:`, markErr instanceof Error ? markErr.message : markErr);
              });
              await this.updateHeartbeatStatus(agentId, reason, hb, {
                evidenceSummary: err instanceof Error ? err.message : String(err),
                taskId: task.id,
                applyLoopContract: agent.tier === "super",
              });

              // 连续失败达阈值 → 邮件告警（#4）。=== 判定：每个失败 streak 只告警一次，
              // 避免第 4、5… 次失败重复轰炸收件箱；streak 清零（success）后再次达阈值会重新告警
              if (reason === "failed") {
                await this.maybeSuspendAfterFailure(
                  agentId,
                  agent.name,
                  err instanceof Error ? err.message : String(err),
                );
              }
              return { status: "failed", error: err instanceof Error ? err.message : String(err) };
            }
          },
        });
      } catch (dispatchErr: unknown) {
        // C1：池准入拒绝（maxQueued）→ 已建 Task 行必须收尾 failed「队列满」，并计入失败 streak（熔断可见）
        const msg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
        const queueFull = /队列已满|maxQueued/i.test(msg);
        const errorText = queueFull ? "队列满" : msg;
        await this.prisma.task.updateMany({
          where: { id: task.id, status: { in: ["queued", "running"] } },
          data: {
            status: "failed",
            finishedAt: new Date(),
            output: { error: errorText },
            delivered: true,
            deliveredAt: new Date(),
          },
        });
        await this.updateHeartbeatStatus(agentId, "failed", hb, {
          evidenceSummary: errorText,
          taskId: task.id,
          applyLoopContract: agent.tier === "super",
        });
        await this.maybeSuspendAfterFailure(agentId, agent.name, errorText);
        console.error(`  ❌ [HeartbeatEngine] Agent ${agentId} 心跳入池失败:`, msg);
      }
    } catch (err: unknown) {
      console.error(`  ❌ [HeartbeatEngine] Agent ${agentId} 心跳触发失败:`, err instanceof Error ? err.message : err);
    }
  }

  /** 失败 streak 达阈值 → 邮件告警一次 + suspend（幂等） */
  private async maybeSuspendAfterFailure(agentId: string, agentName: string, lastError: string): Promise<void> {
    const updatedHb = this.parseHeartbeat(
      (await this.prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } }))?.heartbeat,
    );
    if (!updatedHb) return;
    if (updatedHb.consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
      const notify = await sendEmailNotification(this.config, this.services.log, {
        subject: `[KnowPilot] Agent「${agentName}」心跳连续失败 ${updatedHb.consecutiveFailures} 次`,
        body: `Agent「${agentName}」（${agentId}）心跳已连续失败 ${updatedHb.consecutiveFailures} 次，心跳已自动暂停（suspended，已持久化）。\n最近一次错误：${lastError}\n请检查 LLM 配置与该 Agent 状态；修复后保存该 Agent 的心跳配置（cron/goal/心跳模型变更会清零失败计数并自动恢复），重启服务不再自动恢复。`,
        agentId,
      });
      if ("error" in notify) {
        console.warn(`  💓 [HeartbeatEngine] Agent ${agentName} 连续失败 ${updatedHb.consecutiveFailures} 次，邮件告警未发送：${notify.error}`);
      } else {
        console.log(`  💓 [HeartbeatEngine] Agent ${agentName} 连续失败 ${updatedHb.consecutiveFailures} 次，已邮件告警用户`);
      }
    }
    if (updatedHb.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await this.suspendHeartbeat(agentId, agentName);
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

  /**
   * W12/W16d-2：连续失败达阈值 → 暂停该 Agent 心跳（熔断置 suspended，持久化到 Agent 行）。
   *
   * 语义：heartbeatSuspendedAt 是唯一事实源（重启不失）——
   * - 立即摘除 cron job；triggerHeartbeat 对 suspended Agent 直接跳过；
   * - 恢复机制（两条显式路径，不再连坐）：
   *   ① 心跳配置变更：AgentService.update 检测到 enabled/cron/goal/heartbeatModel 变更时清零
   *      consecutiveFailures（人工修复信号），随后 refresh() 个体化摘除 suspended；
   *   ② 手动 resumeHeartbeat(agentId)（cron 注册随下次 refresh() 重建）。
   * - 恢复后若再失败，streak ≥ 阈值会立即重新暂停（邮件仍只在 === 阈值时发一次）。
   */
  private async suspendHeartbeat(agentId: string, agentName: string): Promise<void> {
    const job = this.jobs.get(agentId);
    if (job) {
      job.stop();
      this.jobs.delete(agentId);
    }
    // 幂等：只在未 suspended 时写入（保留首次熔断时刻）
    const res = await this.prisma.agent.updateMany({
      where: { id: agentId, heartbeatSuspendedAt: null },
      data: { heartbeatSuspendedAt: new Date() },
    });
    if (res.count > 0) {
      console.error(
        `  💓 [HeartbeatEngine] Agent ${agentName} 心跳连续失败达阈值，已暂停（suspended，已持久化）。` +
          `恢复：保存该 Agent 心跳配置（计数清零）或 resumeHeartbeat()。`,
      );
    }
  }

  /** W12：手动恢复被暂停的心跳（清零失败计数 + 摘除 suspended；refresh 重挂 cron） */
  async resumeHeartbeat(agentId: string): Promise<{ resumed: boolean }> {
    const row = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { heartbeatSuspendedAt: true },
    });
    if (!row) return { resumed: false };
    // C4：清零只 touch consecutiveFailures，不整 blob 覆写（避免冲掉并发运行态字段）
    await this.prisma.$executeRaw`
      UPDATE "Agent"
      SET
        "heartbeatSuspendedAt" = NULL,
        heartbeat = json_set(COALESCE(heartbeat, '{}'), '$.consecutiveFailures', 0),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${agentId}
    `;
    await this.refresh();
    return { resumed: true };
  }

  /** W12：观测/测试用——该 Agent 心跳是否处于 suspended 暂停态 */
  async isHeartbeatSuspended(agentId: string): Promise<boolean> {
    const row = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { heartbeatSuspendedAt: true },
    });
    return row?.heartbeatSuspendedAt != null;
  }

  /** @internal 测试用：直接触达运行态写回（验证原子计数） */
  async __updateHeartbeatStatusForTests(
    agentId: string,
    status: "success" | "failed" | "cancelled" | "budget_exceeded",
    prevHb: HeartbeatState,
    opts?: {
      evidenceSummary?: string;
      taskId?: string;
      applyLoopContract?: boolean;
    },
  ): Promise<void> {
    return this.updateHeartbeatStatus(agentId, status, prevHb, opts);
  }

  /**
   * C4：运行态字段（lastRunAt/Status、consecutiveFailures、可选 loopContract）用 json_set 原子更新，
   * 禁止整 blob 覆写——配置态（enabled/cron/goal）不被并发写回冲掉；
   * consecutiveFailures 在 SQL 层自增/清零，杜绝 read-modify-write 丢计数。
   */
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
    const nowIso = new Date().toISOString();
    const agentStatus = status === "success" ? "active" : "idle";

    try {
      // 失败 → SQL 自增；成功 → 置 0；其余保持现值（不读改写）
      await this.prisma.$executeRaw`
        UPDATE "Agent"
        SET
          heartbeat = json_set(
            COALESCE(heartbeat, '{}'),
            '$.lastRunAt', ${nowIso},
            '$.lastRunStatus', ${status},
            '$.consecutiveFailures',
              CASE
                WHEN ${status} = 'success' THEN 0
                WHEN ${status} = 'failed' THEN COALESCE(json_extract(heartbeat, '$.consecutiveFailures'), 0) + 1
                ELSE COALESCE(json_extract(heartbeat, '$.consecutiveFailures'), 0)
              END
          ),
          status = ${agentStatus},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${agentId}
      `;

      if (opts?.applyLoopContract) {
        const current = this.parseHeartbeat(
          (await this.prisma.agent.findUnique({ where: { id: agentId }, select: { heartbeat: true } }))?.heartbeat,
        );
        const defaults = this.config.heartbeat.loopContract;
        const goal = current?.goal || prevHb.goal;
        const base = ensureLoopContract(goal, current?.loopContract ?? prevHb.loopContract, defaults);
        const loopContract = recordEvidence(
          base,
          {
            at: nowIso,
            summary: opts.evidenceSummary ?? status,
            taskId: opts.taskId,
            status,
          },
          defaults,
        );
        if (!loopContract.handoff) {
          console.warn(`  💓 [HeartbeatEngine] Loop Contract 停止交回: ${loopContract.stoppedReason}`);
        }
        const loopJson = JSON.stringify(loopContract);
        await this.prisma.$executeRaw`
          UPDATE "Agent"
          SET
            heartbeat = json_set(COALESCE(heartbeat, '{}'), '$.loopContract', json(${loopJson})),
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${agentId}
        `;
      }
    } catch (err) {
      console.warn(`  💓 [HeartbeatEngine] 更新心跳状态失败 agent=${agentId}:`, err instanceof Error ? err.message : err);
    }
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
