/**
 * HeartbeatEngine — Agent 心跳机制
 *
 * 基于 node-cron 的定时触发引擎。每个 Agent 可配置 heartbeat：
 *   { enabled: true, cron: "0 9 * * *", goal: "检查并整理..." }
 *
 * 触发时（W2：cron 只唤醒，决策层决定是否 dispatch）：
 * 1. 检查 Agent 状态（active/idle 才触发，dormant/deleted 跳过；W12/W2 suspended 跳过）
 * 2. 决策层 buildHeartbeatDecision（signals 注入）→ Log heartbeat_decision
 * 3. bounded_delivery/repair 才入池；其余 mode 跳过（含 wait_user_gate 通知冷却）
 * 4. 找到或创建心跳专用 session → 注入 system 消息 → SwarmOrchestrator 池 dispatch
 * 5. 更新 heartbeat.lastRunAt/Status/consecutiveFailures（json_set）；decision 子键独立原子写
 * 6. 连续失败达阈值 → 邮件告警 + suspended；terminal 亦复用 suspended
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
import { assertLlmBudget, getLlmBudgetStatus } from "./llmBudget.js";
import { getEventBus, type EntityEventPayload } from "./eventBus.js";
import {
  expireStaleApprovals,
  notifyPendingApprovalIfCooldownAllows,
  refreshPendingApprovalScopeCache,
} from "./approvalGate.js";
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
import {
  bucketUserMessageAt,
  buildHeartbeatDecision,
  emptyDecisionState,
  parseDecisionState,
  shouldNotifyUserGate,
  withGateNotifyStamp,
  type HeartbeatDecision,
  type HeartbeatDecisionState,
  computeLastRunProductive,
} from "./heartbeatDecision.js";
import { listAllAskUserPending } from "./askUserGate.js";
import {
  deriveDecisionScope,
  deriveRequiredScopesFromTools,
  filterReadonlyTools,
} from "./approvalScope.js";

const MAX_CONSECUTIVE_FAILURES = HEARTBEAT_MAX_CONSECUTIVE_FAILURES;

/** repair 模式追加到 system 的固定修复提示（W5 stall；不做结构化 replan 清单） */
const REPAIR_SYSTEM_HINT =
  "连续 N 轮无实质进展，请重新评估目标与下一步，只做一个能改变状态的动作";

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
  /** W2 决策运行态；parseHeartbeat 必填，测试桩可省略 */
  decision?: HeartbeatDecisionState;
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
        // W2：terminal_no_followup 复用 suspended；配置变更清零 decision.terminalAt 后才可摘除
        const isTerminal =
          !!hb?.decision?.terminalAt || hb?.decision?.lastMode === "terminal_no_followup";
        if ((hb?.consecutiveFailures ?? 0) < MAX_CONSECUTIVE_FAILURES && !isTerminal) {
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

      let repairHint = false;

      // W2 决策层：cron 只唤醒；是否 dispatch 由决策 packet 决定
      if (this.config.heartbeat.decisionEnabled) {
        const decision = await this.runHeartbeatDecision(agentId, agent.name, hb);
        if (!decision) return;

        if (decision.mode === "terminal_no_followup" && decision.shouldSuspendTerminal) {
          await this.suspendHeartbeat(agentId, agent.name);
          const stallExhausted = decision.reasons.some((r) => r.includes("stall repair exhausted"));
          if (stallExhausted) {
            const subject = `[KnowPilot] Agent「${agent.name}」心跳 stall 修复耗尽`;
            const body =
              `Agent「${agent.name}」（${agentId}）连续多轮无实质进展，stall repair exhausted，心跳已 suspended。\n` +
              `决策原因：${decision.reasons.join("；")}\n` +
              `最近状态：lastMode=${decision.nextState.lastMode}，stallUnproductiveStreak=${decision.nextState.stallUnproductiveStreak}`;
            const notify = await sendEmailNotification(this.config, this.services.log, {
              subject,
              body,
              agentId,
            });
            if ("error" in notify) {
              console.warn(`  💓 [HeartbeatEngine] stall 通知未发送：${notify.error}`);
            }
          }
          console.warn(
            `  💓 [HeartbeatEngine] Agent ${agent.name} ${stallExhausted ? "stall 耗尽" : "目标闭合"}（terminal），已 suspended`,
          );
          return;
        }

        if (decision.mode === "bounded_delivery" || decision.mode === "repair") {
          repairHint = decision.mode === "repair";
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
        } else if (decision.mode === "wait_user_gate" && decision.safeBypassAllowed) {
          // W3 safe bypass：mode 仍 wait_user_gate，但允许一次只读 turn（无只读工具则纯等待）
          const allTools = agent.tools ? agent.tools.split(",").filter(Boolean) : [];
          const readonlyTools = filterReadonlyTools(allTools);
          if (readonlyTools.length === 0) {
            return;
          }
          try {
            assertLlmBudget(this.config);
          } catch {
            console.warn(`  💓 [HeartbeatEngine] Agent ${agent.name} safe bypass 跳过（LLM 预算耗尽）`);
            return;
          }
          const stamped: HeartbeatDecisionState = {
            ...decision.nextState,
            safeBypassUsed: true,
            safeBypassGateKey: decision.nextState.safeBypassGateKey,
          };
          await this.persistDecisionState(agentId, stamped);
          await this.dispatchHeartbeatRun(agentId, agent, hb, false, { readonlyOnly: true });
          return;
        } else {
          // wait_user_gate / quiet / monitor / skipOnlyDecrement：不 dispatch
          return;
        }
      } else {
        // 旧路径：到点即跑（decisionEnabled=false 回退）
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
      }

      await this.dispatchHeartbeatRun(agentId, agent, hb, repairHint);
    } catch (err: unknown) {
      console.error(`  ❌ [HeartbeatEngine] Agent ${agentId} 心跳触发失败:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * W2：收集 signals → buildHeartbeatDecision → 持久化 decision 子键 + Log；
   * wait_user_gate 走通知冷却。返回 decision；调用方据 mode 决定是否 dispatch。
   */
  private async runHeartbeatDecision(
    agentId: string,
    agentName: string,
    hb: HeartbeatState,
  ): Promise<HeartbeatDecision | null> {
    const signals = await this.collectHeartbeatSignals(agentId, hb);
    const decision = buildHeartbeatDecision(signals);
    let nextState = decision.nextState;

    if (decision.mode === "wait_user_gate" && decision.userGate) {
      const nowMs = Date.now();
      if (decision.userGate.kind === "approval") {
        // W3：审批通知走 Approval.lastNotifiedAt 单点冷却
        const pending = await this.prisma.approval.findMany({
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            toolName: true,
            decisionScope: true,
            lastNotifiedAt: true,
          },
        });
        let anyNotified = false;
        for (const row of pending) {
          const r = await notifyPendingApprovalIfCooldownAllows(this.services, row, {
            subject: `[KnowPilot] Agent「${agentName}」心跳等待人工：approval`,
            body:
              `Agent「${agentName}」（${agentId}）心跳决策为 wait_user_gate。\n` +
              `待办：${decision.userGate.summary}\n` +
              (decision.blockedScopes?.length
                ? `被堵 scope：${decision.blockedScopes.join(", ")}\n`
                : "") +
              `原因：${decision.reasons.join("；")}`,
          });
          if (r.notified) anyNotified = true;
        }
        if (anyNotified) {
          const gateKey =
            decision.userGate.blockedScopes?.join("|") ||
            `approval:${decision.userGate.summary}`;
          nextState = withGateNotifyStamp(nextState, gateKey, new Date(nowMs).toISOString());
        }
      } else {
        const notify = shouldNotifyUserGate({
          decision,
          cooldownMs: this.config.heartbeat.gateNotifyCooldownMs,
          nowMs,
        });
        if (notify.notify && notify.gateKey) {
          const nowIso = new Date(nowMs).toISOString();
          nextState = withGateNotifyStamp(nextState, notify.gateKey, nowIso);
          const subject = `[KnowPilot] Agent「${agentName}」心跳等待人工：${decision.userGate.kind}`;
          const body =
            `Agent「${agentName}」（${agentId}）心跳决策为 wait_user_gate。\n` +
            `待办：${decision.userGate.summary}\n` +
            `原因：${decision.reasons.join("；")}`;
          const result = await sendEmailNotification(this.config, this.services.log, {
            subject,
            body,
            agentId,
          });
          if ("error" in result) {
            console.warn(`  💓 [HeartbeatEngine] gate 通知未发送：${result.error}`);
          }
        }
      }
    }

    await this.persistDecisionState(agentId, nextState);

    await this.services.log
      .create({
        level: decision.mode === "terminal_no_followup" ? "warn" : "info",
        component: "HeartbeatEngine",
        event: "heartbeat_decision",
        message: `Agent ${agentName} 心跳决策 ${decision.mode}`,
        metadata: {
          agentId,
          mode: decision.mode,
          reasons: decision.reasons,
          skipTicks: decision.skipTicks,
          userGate: decision.userGate ?? null,
          skipOnlyDecrement: decision.skipOnlyDecrement,
          shouldSuspendTerminal: decision.shouldSuspendTerminal,
        },
      })
      .catch((err: unknown) => {
        console.warn(
          `  💓 [HeartbeatEngine] 写 heartbeat_decision 日志失败:`,
          err instanceof Error ? err.message : err,
        );
      });

    if (decision.mode !== "bounded_delivery" && decision.mode !== "repair") {
      console.warn(
        `  💓 [HeartbeatEngine] Agent ${agentName} 决策=${decision.mode}，跳过 dispatch（${decision.reasons.join("；")}）`,
      );
    }
    return { ...decision, nextState };
  }

  /** 收集决策信号（IO 在此；纯函数决策模块不碰 prisma） */
  private async collectHeartbeatSignals(agentId: string, hb: HeartbeatState) {
    const sessions = await this.prisma.chatSession.findMany({
      where: { agentId, status: { not: "deleted" } },
      select: { id: true },
      take: 50,
    });
    const sessionIds = sessions.map((s) => s.id);

    const [queuedItems, lastRun, lastUserMsg, pendingApprovalRows] = await Promise.all([
      sessionIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.sessionQueueItem.count({
            where: {
              sessionId: { in: sessionIds },
              kind: { in: ["superior", "child_notify"] },
            },
          }),
      this.prisma.run.findFirst({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        select: { id: true, toolCallCount: true, createdAt: true, output: true, status: true },
      }),
      this.prisma.chatMessage.findFirst({
        where: {
          sessionId: { in: sessionIds.length ? sessionIds : ["__none__"] },
          role: "user",
          NOT: { source: "system" },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.approval.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, toolName: true, decisionScope: true, args: true },
      }),
    ]);

    // W3：刷新 pending scope 缓存（供调度面 drain 同步判定）
    void refreshPendingApprovalScopeCache(this.services).catch(() => {});

    const pendingApprovals = pendingApprovalRows.length;
    const pendingApprovalScopes = pendingApprovalRows.map((r) => {
      let scope = r.decisionScope;
      if (!scope) {
        const args =
          typeof r.args === "string"
            ? (JSON.parse(r.args) as Record<string, unknown>)
            : ((r.args as Record<string, unknown>) ?? {});
        scope = deriveDecisionScope(r.toolName, args);
      }
      return { approvalId: r.id, scope };
    });

    let openApprovalSummary: string | null = null;
    if (pendingApprovals > 0) {
      const latest = pendingApprovalRows[0];
      openApprovalSummary = latest
        ? `待批 ${latest.toolName}${latest.decisionScope ? ` [${latest.decisionScope}]` : ""}（共 ${pendingApprovals} 条）`
        : `有 ${pendingApprovals} 条审批待处理`;
    }

    const agentRow = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { tools: true },
    });
    const agentTools = agentRow?.tools ? agentRow.tools.split(",").filter(Boolean) : [];
    const agentRequiredScopes = deriveRequiredScopesFromTools(agentTools);

    const askPending = listAllAskUserPending().filter((p) => p.agentId === agentId);
    const pendingAskUserSummary =
      askPending.length > 0 ? askPending[0]!.question.slice(0, 200) : null;

    const budget = getLlmBudgetStatus(this.config);

    return {
      enabled: hb.enabled,
      goal: hb.goal,
      openApprovals: pendingApprovals,
      pendingAskUser: askPending.length,
      openApprovalSummary,
      pendingAskUserSummary,
      pendingApprovalScopes,
      agentRequiredScopes,
      queuedItems,
      lastRunId: lastRun?.id ?? hb.lastRunAt,
      lastRunAt: hb.lastRunAt,
      consecutiveFailures: hb.consecutiveFailures,
      lastRunProductive: computeLastRunProductive({
        toolCallCount: lastRun?.toolCallCount ?? 0,
        runOutput: lastRun?.output,
        openApprovals: pendingApprovals,
        pendingAskUser: askPending.length,
        queuedItems,
      }),
      budgetExceeded: budget.exceeded,
      lastUserMessageAtBucket: bucketUserMessageAt(lastUserMsg?.createdAt?.getTime() ?? null),
      decisionState: hb.decision ?? emptyDecisionState(),
      quietCap: this.config.heartbeat.quietCap,
      terminalAfterQuiet: this.config.heartbeat.terminalAfterQuiet,
    };
  }

  /** decision 子键原子更新（json_set，禁止整 heartbeat blob 覆写） */
  private async persistDecisionState(agentId: string, decision: HeartbeatDecisionState): Promise<void> {
    const decisionJson = JSON.stringify(decision);
    try {
      await this.prisma.$executeRaw`
        UPDATE "Agent"
        SET
          heartbeat = json_set(COALESCE(heartbeat, '{}'), '$.decision', json(${decisionJson})),
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${agentId}
      `;
    } catch (err) {
      console.warn(
        `  💓 [HeartbeatEngine] 持久化 decision 失败 agent=${agentId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** bounded_delivery / repair：建 session → 入池 dispatch（语义与决策层接入前一致） */
  private async dispatchHeartbeatRun(
    agentId: string,
    agent: {
      id: string;
      name: string;
      model: string;
      systemPrompt: string;
      tools: string | null;
      tier: string;
      workspaceId: string | null;
      parentId: string | null;
      heartbeatModel: string | null;
    },
    hb: HeartbeatState,
    repairHint: boolean,
    opts?: { readonlyOnly?: boolean },
  ): Promise<void> {
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

    await this.services.message.create({
      sessionId: session.id,
      role: "user",
      content: `[心跳触发] ${hb.goal}`,
      source: "system",
    });

    const heartbeatModel = agent.heartbeatModel || agent.model;
    const allTools = agent.tools ? agent.tools.split(",").filter(Boolean) : [];
    const tools = opts?.readonlyOnly ? filterReadonlyTools(allTools) : allTools;
    const agentSnapshot = {
      id: agent.id,
      model: heartbeatModel,
      systemPrompt: agent.systemPrompt,
      tools,
      tier: agent.tier,
      workspaceId: agent.workspaceId,
      parentId: agent.parentId,
    };

    const repairSuffix = repairHint ? `\n\n${REPAIR_SYSTEM_HINT}` : "";
    const bypassSuffix = opts?.readonlyOnly
      ? "\n\n[safe bypass] 当前为审批 gate 下的一次性只读分析步：仅可使用只读工具，禁止任何写入/删除/git 写操作。"
      : "";

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
          repair: repairHint,
          readonlyOnly: opts?.readonlyOnly === true,
        },
      },
    });

    const orchestrator = getSwarmOrchestrator(this.config, this.services);
    try {
      await orchestrator.dispatch({
        origin: "heartbeat",
        schedule: "pool",
        sessionId: session.id,
        workspaceId: agent.workspaceId ?? null,
        jobId: task.id,
        taskLabel: `[heartbeat] ${agent.name}`,
        // safe bypass / 心跳只读步：空 requiredScopes，不被写类 gate 堵死
        requiredScopes: opts?.readonlyOnly ? [] : deriveRequiredScopesFromTools(allTools),
        tools: allTools,
        execute: async (signal): Promise<SwarmTaskOutcome> => {
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
            const invokeTrpc = createTrpcInvoker({ services: this.services, prisma: this.prisma });

            const loop = await runAgentLoop({
              config: this.config,
              services: this.services,
              agent: {
                model: heartbeatModel,
                systemPrompt:
                  `${agent.systemPrompt}\n\n你因心跳机制被自动唤醒。任务目标：${hb.goal}\n完成后用简洁中文汇总结果。` +
                  repairSuffix +
                  bypassSuffix,
                tools: agentSnapshot.tools,
              },
              messages: [{ role: "user", content: hb.goal }],
              invokeTrpc,
              signal,
              sessionId: session.id,
              agentMeta: agentSnapshot,
              runOrigin: "heartbeat",
              runInput: {
                heartbeat: true,
                goal: hb.goal,
                taskId: task.id,
                repair: repairHint,
                readonlyOnly: opts?.readonlyOnly === true,
              },
              readonlyOnly: opts?.readonlyOnly === true,
            });

            await this.prisma.task.update({
              where: { id: task.id },
              data: {
                status: "success",
                finishedAt: new Date(),
                output: { asyncResult: loop.content, tokenUsage: loop.tokenUsage },
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
            await this.prisma.task
              .update({
                where: { id: task.id },
                data: {
                  status: "failed",
                  finishedAt: new Date(),
                  output: { error: err instanceof Error ? err.message : String(err) },
                  delivered: true,
                  deliveredAt: new Date(),
                },
              })
              .catch((markErr) => {
                console.warn(
                  `  💓 [HeartbeatEngine] 标记心跳任务 failed 失败 task=${task.id}:`,
                  markErr instanceof Error ? markErr.message : markErr,
                );
              });
            await this.updateHeartbeatStatus(agentId, reason, hb, {
              evidenceSummary: err instanceof Error ? err.message : String(err),
              taskId: task.id,
              applyLoopContract: agent.tier === "super",
            });

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
      decision: parseDecisionState(hb.decision),
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
    // C4/W2：清零 consecutiveFailures + 清空 terminal 决策态，不整 blob 覆写
    const clearedDecision = JSON.stringify(emptyDecisionState());
    await this.prisma.$executeRaw`
      UPDATE "Agent"
      SET
        "heartbeatSuspendedAt" = NULL,
        heartbeat = json_set(
          COALESCE(heartbeat, '{}'),
          '$.consecutiveFailures', 0,
          '$.decision', json(${clearedDecision})
        ),
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
