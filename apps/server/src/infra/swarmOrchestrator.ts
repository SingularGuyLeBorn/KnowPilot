/**
 * SwarmOrchestrator ? Swarm ????????W10?
 *
 * ???? Agent ?????????????????
 *   dispatch(taskSpec) ? swarmPermissionGuard ???? ? 60s ?????
 *   ? ????AsyncJobOrchestrator?/ inline ?? ? ???? ? Log ??
 *
 * ??????
 *   - spawn_subagent?tools/native/session.ts?inline???????????? SessionStreamHub?
 *   - async_task_run?asyncJobManager.startAsyncAgentTask?pool?
 *   - heartbeatEngine????????pool?invokeTrpc ??????????
 *   - TriggerEngine????? run_agent?pool + completion ?? per-trigger ???
 *
 * ???
 * - ????????????????????? LoopContract?async ??/???
 *   spawn ?????trigger ???????? execute ???????????
 * - ???????? asyncJobOrchestrator / swarmPermissionGuard / config / serviceContainer?
 *   ?? import agentRuntime / agentStream / agentTools / nativeTools???????
 * - ???????? + __resetForTests?? globalThis??
 */

import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import { getAsyncJobOrchestrator } from "./asyncJobOrchestrator.js";
import { checkToolPermission, type PermissionCheckContext } from "./swarmPermissionGuard.js";
import { deriveRequiredScopesFromTools } from "./approvalScope.js";

/** spawn ?????? (agentId, hash(taskText)) ?????? dispatch ?????? task */
export const SWARM_SPAWN_DEDUP_WINDOW_MS = 60_000;

export type SwarmDispatchOrigin = "spawn_subagent" | "async_task_run" | "heartbeat" | "trigger";

/** ??????????????????????????/???????? */
export interface SwarmTaskOutcome {
  status: "success" | "failed";
  content?: string;
  error?: string;
  /** ????????? spawn ? agentId/subagentSessionId/jobId??????????? */
  attach?: Record<string, unknown>;
}

export interface SwarmTaskSpec {
  /** ???????????? */
  origin: SwarmDispatchOrigin;
  /** ????????/????? */
  taskLabel: string;
  /** ??? per-session ???? / ???? */
  sessionId: string;
  /** per-workspace ???????maxPerWorkspace > 0 ??????? = ??? workspace ?? */
  workspaceId?: string | null;
  /** ?? Task ?? id?async/heartbeat ????????????????? */
  jobId?: string;
  /**
   * pool?? AsyncJobOrchestrator ???????? + per-session ??????????
   * inline????????spawn ?????????? SessionStreamHub???????
   */
  schedule: "pool" | "inline";
  timeoutMs?: number;
  /** ????????lightweight = ???? LLM ??sleep/???? */
  slotClass?: "llm" | "lightweight";
  /** ?? Workspace ??????? */
  workspaceSlotQuota?: number;
  metadata?: { subagentSessionId?: string };
  /**
   * W3???? requiredScopes?????? tools ?????
   * ? pending approvals.decisionScope ?? ? ??? reason=gate?
   */
  requiredScopes?: string[];
  /** W3??????? requiredScopes ?????? */
  tools?: string[];
  /**
   * ?????swarmPermissionGuard.checkToolPermission ??????
   * ?? = ?????heartbeat/trigger?????? Agent?????
   */
  guard?: {
    toolName: string;
    args: Record<string, unknown>;
    ctx: PermissionCheckContext;
  };
  /** 60s ??????? (agentId, hash(taskText)) ?? dispatch ?????? task?
   *  earlyOutcome?????????????????ids ????pool ?? fire-and-forget?
   *  dedup ??????????????????????? */
  dedup?: { agentId: string; taskText: string; windowMs?: number; earlyOutcome?: () => SwarmTaskOutcome };
  /** ????????guard/????????????throw = ???????????????
   *  ???????queued ????????? Task / ???????? execute?execute ????????
   *  ??? jobId/metadata ?????????? id = ?? Task id?session.stop / async_task_cancel ??????? */
  prepare?: () => Promise<{ jobId?: string; metadata?: { subagentSessionId?: string } } | void>;
  /** ????????????????????????? */
  execute: (signal: AbortSignal) => Promise<SwarmTaskOutcome>;
}

export interface SwarmDispatchHandle {
  jobId: string;
  origin: SwarmDispatchOrigin;
  /** duplicate = ?????????????????? */
  status: "queued" | "running" | "completed" | "failed" | "duplicate";
  deduped: boolean;
  /** inline????????pool?undefined?? completion ????? */
  outcome?: SwarmTaskOutcome;
  /** pool???????????fire-and-forget ???????inline?? resolved */
  completion?: Promise<SwarmTaskOutcome>;
}

interface DedupEntry {
  jobId: string;
  origin: SwarmDispatchOrigin;
  taskLabel: string;
  expiresAt: number;
  /** ??????? promise?????? await ??????????????????? */
  completion?: Promise<SwarmTaskOutcome>;
  outcome?: SwarmTaskOutcome;
  /** ??????dedup ??? await ???? attach?pool fire-and-forget ??????? */
  prepared?: Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class SwarmOrchestrator {
  private readonly dedupEntries = new Map<string, DedupEntry>();

  constructor(private readonly deps: { config: AppConfig; services: ServiceContainer }) {}

  async dispatch(spec: SwarmTaskSpec): Promise<SwarmDispatchHandle> {
    // ?? ????? ??
    // ????????lookupDedup ?? null ? registerDedup???? await??? dispatch ??????
    //    ????? await?????? prepare/completion???"??? await"?????????

    // 1. ?????swarmPermissionGuard ???
    if (spec.guard) {
      const denied = checkToolPermission(spec.guard.toolName, spec.guard.args, spec.guard.ctx);
      if (denied) {
        this.audit("warn", "swarm_dispatch_denied", `${spec.origin} ???${spec.taskLabel}?????[${denied.code}] ${denied.reason}`, {
          origin: spec.origin,
          taskLabel: spec.taskLabel,
          code: denied.code,
        });
        throw new Error(`[${denied.code}] ${denied.reason}`);
      }
    }

    // 2. 60s ??????(agentId, hash(taskText))
    const dedupKey = spec.dedup ? this.dedupKeyOf(spec.dedup.agentId, spec.dedup.taskText) : null;
    if (dedupKey) {
      const existing = this.lookupDedup(dedupKey);
      if (existing) {
        // ????????? dispatch ?????????????????????
        // pool ???????????? DB????? outcome ?????????????fire-and-forget????????
        // P1-01?existing.jobId ? prepare ??????? finalJobId??? await prepared ?????
        //        ?? audit ?????? jobId ??????????? uuid???? finalJobId??
        if (existing.prepared) await existing.prepared.catch(() => {});
        const resolvedJobId = existing.jobId;
        const outcome = existing.outcome ?? (existing.completion ? await existing.completion : undefined);
        this.audit("info", "swarm_dispatch_deduped", `${spec.origin} ???${spec.taskLabel}??? 60s ??????????? ${resolvedJobId}`, {
          origin: spec.origin,
          jobId: resolvedJobId,
          taskLabel: spec.taskLabel,
        });
        this.pushParentUpdate(spec, resolvedJobId, "duplicate", outcome);
        return { jobId: resolvedJobId, origin: spec.origin, status: "duplicate", deduped: true, outcome };
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

    // 2.5 ?????????????queued ???????? = ????? + ???? + ??
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
        // ?? attach?dedup ????????????? ids?pool fire-and-forget?
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

    this.audit("info", "swarm_dispatch", `??? ${spec.origin} ???${spec.taskLabel}??${spec.schedule === "pool" ? "???" : "??"}?`, {
      origin: spec.origin,
      jobId: finalJobId,
      sessionId: spec.sessionId,
      taskLabel: spec.taskLabel,
      schedule: spec.schedule,
    });

    // 3+4. ?? + ????
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
        // ??/?????????????????????????????????
        if (dedupKey) this.dedupEntries.delete(dedupKey);
        const outcome: SwarmTaskOutcome = { status: "failed", error: errorMessage(err) };
        settleCompletion?.(outcome);
        this.auditOutcome(spec, finalJobId, outcome);
        throw err;
      }
    }

    // pool??? AsyncJobOrchestrator ???
    const pool = getAsyncJobOrchestrator(this.deps.config);
    const requiredScopes =
      spec.requiredScopes ??
      (spec.tools && spec.tools.length > 0 ? deriveRequiredScopesFromTools(spec.tools) : undefined);
    try {
      pool.enqueue({
        jobId: finalJobId,
        sessionId: spec.sessionId,
        workspaceId: spec.workspaceId,
        workspaceSlotQuota: spec.workspaceSlotQuota,
        timeoutMs: spec.timeoutMs,
        slotClass: spec.slotClass,
        metadata: resolvedMetadata,
        requiredScopes,
        execute: async (signal) => {
          let outcome: SwarmTaskOutcome;
          try {
            outcome = await spec.execute(signal);
          } catch (err) {
            // ?????????????????????/??/??????
            // ?pool ? execute ? reject ???????????????????????????
            outcome = { status: "failed", error: errorMessage(err) };
          }
          this.settleDedupOutcome(dedupKey, outcome);
          settleCompletion?.(outcome);
          this.auditOutcome(spec, finalJobId, outcome);
        },
      });
    } catch (err) {
      // ?????maxQueued ???????????????????completion ??????????????
      if (dedupKey) this.dedupEntries.delete(dedupKey);
      const outcome: SwarmTaskOutcome = { status: "failed", error: errorMessage(err) };
      settleCompletion?.(outcome);
      this.auditOutcome(spec, finalJobId, outcome);
      throw err;
    }
    const poolStatus = pool.isRunning(finalJobId) ? "running" : "queued";
    this.pushParentUpdate(spec, finalJobId, poolStatus);
    return {
      jobId: finalJobId,
      origin: spec.origin,
      status: poolStatus,
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
      // B8??????? completion ??? outcome??? 60s ????????????????
      if (entry.completion && !entry.outcome) return entry;
      this.dedupEntries.delete(key);
      return null;
    }
    return entry;
  }

  private registerDedup(key: string, entry: DedupEntry): void {
    // ?????map ?????????????????
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
        ? `${spec.origin} ???${spec.taskLabel}???`
        : `${spec.origin} ???${spec.taskLabel}????${outcome.error ?? "????"}`,
      {
        origin: spec.origin,
        jobId,
        sessionId: spec.sessionId,
        taskLabel: spec.taskLabel,
        content: outcome.content?.slice(0, 500),
        error: outcome.error,
      },
    );
    this.pushParentUpdate(spec, jobId, ok ? "completed" : "failed", outcome);
  }

  /** ????? swarm_task_update??? import???? agentStream ??? */
  private pushParentUpdate(
    spec: SwarmTaskSpec,
    jobId: string,
    status: "queued" | "running" | "duplicate" | "completed" | "failed",
    outcome?: SwarmTaskOutcome,
  ): void {
    import("./sessionStreamHub.js")
      .then(({ getStreamHub }) => {
        getStreamHub()?.pushExternalEvent(spec.sessionId, {
          type: "swarm_task_update",
          sessionId: spec.sessionId,
          jobId,
          origin: spec.origin,
          taskLabel: spec.taskLabel,
          status,
          error: outcome?.error,
          subagentSessionId:
            typeof outcome?.attach?.subagentSessionId === "string"
              ? outcome.attach.subagentSessionId
              : undefined,
        });
      })
      .catch(() => {
        /* hub ?????? */
      });
  }

  private audit(level: "info" | "warn", event: string, message: string, metadata: Record<string, unknown>): void {
    // ??????????????????????????????????? swarmBus ???
    this.deps.services.log
      ?.create?.({ level, component: "swarm.orchestrator", event, message, metadata })
      .catch(() => {});
  }
}

let _orchestrator: SwarmOrchestrator | null = null;
let _orchestratorConfig: AppConfig | null = null;
let _orchestratorServices: ServiceContainer | null = null;

export function getSwarmOrchestrator(config: AppConfig, services: ServiceContainer): SwarmOrchestrator {
  // config/services ???????????????? config ??????mock services ???????
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

/** ?????? globalThis????????????????? */
export function resetSwarmOrchestratorForTests(): void {
  _orchestrator = null;
  _orchestratorConfig = null;
  _orchestratorServices = null;
}
