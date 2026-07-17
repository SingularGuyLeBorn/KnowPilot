/**
 * SwarmOrchestrator — Swarm 任务调度中介者（W10）
 *
 * 统一四个 Agent 任务入口的公共调度骨架，生命周期：
 *   dispatch(taskSpec) → swarmPermissionGuard 权限校验 → 60s 短窗口去重
 *   → 并发池（AsyncJobOrchestrator）/ inline 执行 → 结果聚合 → Log 审计
 *
 * 四个调用方：
 *   - spawn_subagent（tools/native/session.ts，inline：编排段去重，真执行仍在 SessionStreamHub）
 *   - async_task_run（asyncJobManager.startAsyncAgentTask，pool）
 *   - heartbeatEngine（心跳自动唤醒，pool；invokeTrpc 与其他入口同一通道）
 *   - TriggerEngine（事件触发 run_agent，pool + completion 保住 per-trigger 互斥）
 *
 * 纪律：
 * - 中介者只抽公共骨架。各入口的既有语义（心跳 LoopContract、async 轮询/推送、
 *   spawn 同步等待、trigger 互斥）保留在各自 execute 闭包内，不在此重实现。
 * - 叶子模块：仅依赖 asyncJobOrchestrator / swarmPermissionGuard / config / serviceContainer。
 *   禁止 import agentRuntime / agentStream / agentTools / nativeTools（环内模块）。
 * - 状态为模块级单例 + __resetForTests（禁 globalThis）。
 */

import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { getAsyncJobOrchestrator } from "./asyncJobOrchestrator.js";
import { checkToolPermission, type PermissionCheckContext } from "./swarmPermissionGuard.js";

/** spawn 去重窗口：同 (agentId, hash(taskText)) 在窗口内重复 dispatch 直接返回已有 task */
export const SWARM_SPAWN_DEDUP_WINDOW_MS = 60_000;

export type SwarmDispatchOrigin = "spawn_subagent" | "async_task_run" | "heartbeat" | "trigger";

/** 一次任务执行的聚合结果（入口闭包自落库后回传，供审计/去重命中方消费） */
export interface SwarmTaskOutcome {
  status: "success" | "failed";
  content?: string;
  error?: string;
  /** 入口自定义回传（如 spawn 的 agentId/subagentSessionId/jobId），去重命中时原样返回 */
  attach?: Record<string, unknown>;
}

export interface SwarmTaskSpec {
  /** 调用入口标识（审计归类） */
  origin: SwarmDispatchOrigin;
  /** 审计标签（任务名/目标摘要） */
  taskLabel: string;
  /** 并发池 per-session 限流维度 / 审计归属 */
  sessionId: string;
  /** per-workspace 公平配额维度（maxPerWorkspace > 0 时生效）；缺省 = 不参与 workspace 配额 */
  workspaceId?: string | null;
  /** 已有 Task 记录 id（async/heartbeat 路径由入口自建）；缺省由中介者生成 */
  jobId?: string;
  /**
   * pool：入 AsyncJobOrchestrator 共享并发池（全局 + per-session 限流、超时、取消）；
   * inline：立即同步执行（spawn 编排段——其真执行在 SessionStreamHub，语义不动）。
   */
  schedule: "pool" | "inline";
  timeoutMs?: number;
  metadata?: { subagentSessionId?: string };
  /**
   * 权限校验（swarmPermissionGuard.checkToolPermission 单点复用）。
   * 缺省 = 系统入口（heartbeat/trigger），无调用方 Agent，免校验。
   */
  guard?: {
    toolName: string;
    args: Record<string, unknown>;
    ctx: PermissionCheckContext;
  };
  /** 60s 短窗口去重：同 (agentId, hash(taskText)) 重复 dispatch 直接返回已有 task。
   *  earlyOutcome：准备段完成后立即生成的轻量结果（ids 等）——pool 任务 fire-and-forget，
   *  dedup 命中方拿它即返回，不等执行收口（可能数分钟）。 */
  dedup?: { agentId: string; taskText: string; windowMs?: number; earlyOutcome?: () => SwarmTaskOutcome };
  /** 准备段（可选）：guard/去重之后、调度之前执行；throw = 拒绝（去重键放行，错误上抛）。
   *  用于入池前落「queued 可见」的载体（跟踪 Task / 子会话），不放进 execute（execute 获槽后才运行）。
   *  返回的 jobId/metadata 覆盖默认值——池任务 id = 跟踪 Task id（session.stop / async_task_cancel 同源可取消）。 */
  prepare?: () => Promise<{ jobId?: string; metadata?: { subagentSessionId?: string } } | void>;
  /** 真正执行体：入口既有逻辑闭包，自落库后回传聚合结果 */
  execute: (signal: AbortSignal) => Promise<SwarmTaskOutcome>;
}

export interface SwarmDispatchHandle {
  jobId: string;
  origin: SwarmDispatchOrigin;
  /** duplicate = 去重窗口内命中已有任务（未重复执行） */
  status: "queued" | "running" | "completed" | "failed" | "duplicate";
  deduped: boolean;
  /** inline：同步执行结果；pool：undefined（经 completion 异步获取） */
  outcome?: SwarmTaskOutcome;
  /** pool：执行收口的聚合结果（fire-and-forget 入口可忽略）；inline：已 resolved */
  completion?: Promise<SwarmTaskOutcome>;
}

interface DedupEntry {
  jobId: string;
  origin: SwarmDispatchOrigin;
  taskLabel: string;
  expiresAt: number;
  /** 在途任务的收口 promise：去重命中方 await 它拿到同一份结果（幂等消费，不赌时序） */
  completion?: Promise<SwarmTaskOutcome>;
  outcome?: SwarmTaskOutcome;
  /** 准备段收口：dedup 命中方 await 它拿早结 attach（pool fire-and-forget 不等执行收口） */
  prepared?: Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class SwarmOrchestrator {
  private readonly dedupEntries = new Map<string, DedupEntry>();

  constructor(private readonly deps: { config: AppConfig; services: ServiceContainer }) {}

  async dispatch(spec: SwarmTaskSpec): Promise<SwarmDispatchHandle> {
    // ── 同步段（无 await）：并发 dispatch 的权限/去重判定原子完成，不赌时序 ──

    // 1. 权限校验（swarmPermissionGuard 单点）
    if (spec.guard) {
      const denied = checkToolPermission(spec.guard.toolName, spec.guard.args, spec.guard.ctx);
      if (denied) {
        this.audit("warn", "swarm_dispatch_denied", `${spec.origin} 任务「${spec.taskLabel}」被拒绝：[${denied.code}] ${denied.reason}`, {
          origin: spec.origin,
          taskLabel: spec.taskLabel,
          code: denied.code,
        });
        throw new Error(`[${denied.code}] ${denied.reason}`);
      }
    }

    // 2. 60s 短窗口去重：(agentId, hash(taskText))
    const dedupKey = spec.dedup ? this.dedupKeyOf(spec.dedup.agentId, spec.dedup.taskText) : null;
    if (dedupKey) {
      const existing = this.lookupDedup(dedupKey);
      if (existing) {
        this.audit("info", "swarm_dispatch_deduped", `${spec.origin} 任务「${spec.taskLabel}」命中 60s 去重窗口，返回已有任务 ${existing.jobId}`, {
          origin: spec.origin,
          jobId: existing.jobId,
          taskLabel: spec.taskLabel,
        });
        // 在途任务：等同一次 dispatch 收口，返回同一份结果（幂等，不重复执行）。
        // pool 命中：先等准备段（快，仅 DB），有早结 outcome 立即返回——不等执行收口（fire-and-forget，可能数分钟）。
        if (existing.prepared) await existing.prepared.catch(() => {});
        const outcome = existing.outcome ?? (existing.completion ? await existing.completion : undefined);
        return { jobId: existing.jobId, origin: spec.origin, status: "duplicate", deduped: true, outcome };
      }
    }

    const jobId = spec.jobId ?? `swarm-${randomUUID()}`;
    let settleCompletion: (outcome: SwarmTaskOutcome) => void = () => {};
    const completion = new Promise<SwarmTaskOutcome>((resolve) => {
      settleCompletion = resolve;
    });
    if (dedupKey) {
      this.registerDedup(dedupKey, {
        jobId,
        origin: spec.origin,
        taskLabel: spec.taskLabel,
        expiresAt: Date.now() + (spec.dedup?.windowMs ?? SWARM_SPAWN_DEDUP_WINDOW_MS),
        completion,
      });
    }

    // 2.5 准备段（可选）：入池前落「queued 可见」载体；失败 = 放行去重键 + 收口失败 + 上抛
    let finalJobId = jobId;
    let resolvedMetadata = spec.metadata;
    if (spec.prepare) {
      const preparedPromise = (async () => {
        const preparedResult = await spec.prepare!();
        if (preparedResult?.jobId) {
          finalJobId = preparedResult.jobId;
          if (dedupKey) {
            const entry = this.dedupEntries.get(dedupKey);
            if (entry) entry.jobId = preparedResult.jobId;
          }
        }
        if (preparedResult?.metadata) resolvedMetadata = preparedResult.metadata;
        // 早结 attach：dedup 命中方不等执行收口即可拿到 ids（pool fire-and-forget）
        if (dedupKey && spec.dedup?.earlyOutcome) {
          this.settleDedupOutcome(dedupKey, spec.dedup.earlyOutcome());
        }
      })();
      if (dedupKey) {
        const entry = this.dedupEntries.get(dedupKey);
        if (entry) entry.prepared = preparedPromise;
      }
      try {
        await preparedPromise;
      } catch (err) {
        if (dedupKey) this.dedupEntries.delete(dedupKey);
        settleCompletion({ status: "failed", error: errorMessage(err) });
        throw err;
      }
    }

    this.audit("info", "swarm_dispatch", `已受理 ${spec.origin} 任务「${spec.taskLabel}」（${spec.schedule === "pool" ? "并发池" : "同步"}）`, {
      origin: spec.origin,
      jobId: finalJobId,
      sessionId: spec.sessionId,
      taskLabel: spec.taskLabel,
      schedule: spec.schedule,
    });

    // 3+4. 执行 + 结果聚合
    if (spec.schedule === "inline") {
      try {
        const outcome = await spec.execute(new AbortController().signal);
        this.settleDedupOutcome(dedupKey, outcome);
        settleCompletion?.(outcome);
        this.auditOutcome(spec, finalJobId, outcome);
        return {
          jobId: finalJobId,
          origin: spec.origin,
          status: outcome.status === "success" ? "completed" : "failed",
          deduped: false,
          outcome,
          completion,
        };
      } catch (err) {
        // 校验/创建类异常：立即放行去重键（允许修正后重试），并保持原抛错语义上抛
        if (dedupKey) this.dedupEntries.delete(dedupKey);
        const outcome: SwarmTaskOutcome = { status: "failed", error: errorMessage(err) };
        settleCompletion?.(outcome);
        this.auditOutcome(spec, finalJobId, outcome);
        throw err;
      }
    }

    // pool：共享 AsyncJobOrchestrator 并发池
    const pool = getAsyncJobOrchestrator(this.deps.config);
    try {
      pool.enqueue({
        jobId: finalJobId,
        sessionId: spec.sessionId,
        workspaceId: spec.workspaceId,
        timeoutMs: spec.timeoutMs,
        metadata: resolvedMetadata,
        execute: async (signal) => {
          let outcome: SwarmTaskOutcome;
          try {
            outcome = await spec.execute(signal);
          } catch (err) {
            // 入口闭包一般已自捕异常落库；此兜底保证聚合/审计/去重必然收口
            // （pool 对 execute 的 reject 只静默吞掉，不兜底就会漏审计、去重键永远停留在在途态）
            outcome = { status: "failed", error: errorMessage(err) };
          }
          this.settleDedupOutcome(dedupKey, outcome);
          settleCompletion?.(outcome);
          this.auditOutcome(spec, finalJobId, outcome);
        },
      });
    } catch (err) {
      // 入池拒绝（maxQueued 满）：去重键立即放行（允许稍后重派），completion 以失败收口，错误上抛给调用方
      if (dedupKey) this.dedupEntries.delete(dedupKey);
      const outcome: SwarmTaskOutcome = { status: "failed", error: errorMessage(err) };
      settleCompletion?.(outcome);
      this.auditOutcome(spec, finalJobId, outcome);
      throw err;
    }
    return {
      jobId: finalJobId,
      origin: spec.origin,
      status: pool.isRunning(finalJobId) ? "running" : "queued",
      deduped: false,
      completion,
    };
  }

  private dedupKeyOf(agentId: string, taskText: string): string {
    const normalized = taskText.trim().replace(/\s+/g, " ");
    const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 16);
    return `${agentId}:${hash}`;
  }

  private lookupDedup(key: string): DedupEntry | null {
    const entry = this.dedupEntries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.dedupEntries.delete(key);
      return null;
    }
    return entry;
  }

  private registerDedup(key: string, entry: DedupEntry): void {
    // 摊销清理：map 增长时顺手扫掉过期项，避免只增不减
    if (this.dedupEntries.size > 256) {
      const now = Date.now();
      for (const [k, v] of this.dedupEntries) {
        if (v.expiresAt <= now) this.dedupEntries.delete(k);
      }
    }
    this.dedupEntries.set(key, entry);
  }

  private settleDedupOutcome(key: string | null, outcome: SwarmTaskOutcome): void {
    if (!key) return;
    const entry = this.dedupEntries.get(key);
    if (entry) entry.outcome = outcome;
  }

  private auditOutcome(spec: SwarmTaskSpec, jobId: string, outcome: SwarmTaskOutcome): void {
    const ok = outcome.status === "success";
    this.audit(
      ok ? "info" : "warn",
      ok ? "swarm_task_completed" : "swarm_task_failed",
      ok
        ? `${spec.origin} 任务「${spec.taskLabel}」完成`
        : `${spec.origin} 任务「${spec.taskLabel}」失败：${outcome.error ?? "未知错误"}`,
      {
        origin: spec.origin,
        jobId,
        sessionId: spec.sessionId,
        taskLabel: spec.taskLabel,
        content: outcome.content?.slice(0, 500),
        error: outcome.error,
      },
    );
  }

  private audit(level: "info" | "warn", event: string, message: string, metadata: Record<string, unknown>): void {
    // 为什么尽力而为：审计失败若阻塞调度，日志服务抖动会拖垮所有任务入口；与 swarmBus 同策略
    void this.deps.services.log
      ?.create?.({ level, component: "swarm.orchestrator", event, message, metadata })
      .catch(() => {});
  }
}

let _orchestrator: SwarmOrchestrator | null = null;
let _orchestratorConfig: AppConfig | null = null;
let _orchestratorServices: ServiceContainer | null = null;

export function getSwarmOrchestrator(config: AppConfig, services: ServiceContainer): SwarmOrchestrator {
  // config/services 身份不匹配时重建（测试场景：不同 config 并发池限制、mock services 不复用旧实例）
  if (_orchestrator && (_orchestratorConfig !== config || _orchestratorServices !== services)) {
    _orchestrator = null;
    _orchestratorConfig = null;
    _orchestratorServices = null;
  }
  if (!_orchestrator) {
    _orchestrator = new SwarmOrchestrator({ config, services });
    _orchestratorConfig = config;
    _orchestratorServices = services;
  }
  return _orchestrator;
}

/** 单测重置（禁 globalThis：状态为模块级，测试经此函数隔离） */
export function resetSwarmOrchestratorForTests(): void {
  _orchestrator = null;
  _orchestratorConfig = null;
  _orchestratorServices = null;
}
