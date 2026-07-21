/**
 * ApprovalGate — 危险操作审批拦截
 *
 * 对 delete / git.push 等操作创建 pending Approval，或在携带已批准 approvalId 时放行。
 * Agent native 工具路径与 tRPC 共用本闸门（见 executeAgentTool）。
 */

import { TRPCError } from "@trpc/server";
import type { ServiceContainer } from "./serviceContainer.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { success, failureFromError } from "../trpc/result.js";
import type { OperationResult } from "@knowpilot/shared";
import { APPROVAL_DEFAULT_TTL_MS } from "@knowpilot/shared";
import { makeAbortError } from "./abortReason.js";
import { listDestructiveNativeOpsForApproval } from "./tools/registry.js";
import {
  deriveDecisionScope,
  removeCachedPendingScope,
  setCachedPendingApprovalScopes,
  shouldNotifyApprovalByCooldown,
  upsertCachedPendingScope,
} from "./approvalScope.js";
import { getAppConfig } from "./config.js";
import { sendEmailNotification } from "./emailNotifier.js";
import { getAsyncJobOrchestrator } from "./asyncJobOrchestrator.js";

/** 默认需要人工审批的操作（tRPC 点号名 + Agent native 下划线名） */
const APPROVAL_REQUIRED_OPS = new Set([
  "agent.delete",
  "skill.delete",
  "mcp.delete",
  "task.delete",
  "file.delete",
  "git.push",
  "git.commit",
  "git.pull",
  // Agent native 路径：与 tRPC 同档，禁止绕过审批直接写仓库
  "git_push",
  "git_commit",
  "git_pull",
  // Hermes：draft 启用 / 跨 Agent 推广默认需人工审批（与 git 同档，不依赖 AGENT_DESTRUCTIVE_APPROVAL）
  "skill_enable",
  "skill_promote",
]);

/** 经 native 执行层落库、批准后走 executeNativeTool 的工具（git 写 + Hermes Skill 上线/推广） */
const NATIVE_APPROVAL_EXECUTE_OPS = new Set([
  "git_commit",
  "git_pull",
  "git_push",
  "skill_enable",
  "skill_promote",
]);

/**
 * AGENT_DESTRUCTIVE_APPROVAL=true 时需审批的 native 工具清单。
 * 唯一事实源 = registry：destructive && !approvalExempt（禁止再造硬编码 Set）。
 */
export function getDestructiveNativeOps(): Set<string> {
  return listDestructiveNativeOpsForApproval();
}

export function isDestructiveApprovalEnabled(): boolean {
  return process.env.AGENT_DESTRUCTIVE_APPROVAL === "true";
}

/** pending 审批过期毫秒；0 或未解析出有效值时关闭 TTL（默认 24h，见 shared APPROVAL_DEFAULT_TTL_MS） */
export function getApprovalPendingTtlMs(): number {
  const raw = process.env.APPROVAL_PENDING_TTL_MS;
  if (raw === undefined || raw === "") return APPROVAL_DEFAULT_TTL_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return APPROVAL_DEFAULT_TTL_MS;
  return n;
}

/* ─── W11：approval_resolved 显式事件 + 等待注册表（awaiting_human 唤醒机制） ───
 *
 * 不变量：
 * 1. 审批决策只有一个事实源（Approval 行状态）；本注册表只是「决策已发生」的进程内显式事件通道。
 * 2. 唤醒靠事件，不靠轮询：waitApprovalResolution 注册后挂起，由以下来源 resolve：
 *    - executeApprovedOperation 执行后（approved，携带执行结果）
 *    - ApprovalService.afterUpdate 决策为 rejected（人工拒绝）
 *    - expireStaleApprovals / waiter TTL 条件写成功（expired）
 * 3. 「决策事件必达」= 注册先行、对账在后：先同步注册 waiter，再 await 复读状态；
 *    已决 → 立即 resolve 真实结果并摘 waiter；pending → 正常等待。读与收事件之间无 await 交错丢事件。
 *
 * A6 与 askUserGate 语义对照（保留各自语义，不对齐实现）：
 * - approval abort（signal）：reject AbortError → run 走 failed 收尾（危险操作中止不假装完成）
 * - ask_user abort：resolve outcome=aborted → 注入「被中止」续轮让 LLM 收尾
 * - 两者共同点：挂起靠进程内 waiter、唤醒靠显式事件/TTL，禁止轮询赌时序
 */

export type ApprovalResolution = {
  outcome: "approved" | "rejected" | "expired";
  approvalId: string;
  toolName: string;
  /** outcome=approved 时由 executeApprovedOperation 透传的执行结果（可能为失败结果） */
  execResult?: unknown;
};

interface ApprovalWaiter {
  resolve: (r: ApprovalResolution) => void;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const approvalWaiters = new Map<string, Set<ApprovalWaiter>>();

/** 测试隔离：清空等待注册表并取消 TTL / abort 监听 */
export function __resetApprovalWaitersForTests(): void {
  for (const [approvalId, set] of approvalWaiters) {
    for (const waiter of [...set]) {
      removeApprovalWaiter(approvalId, waiter);
    }
  }
  approvalWaiters.clear();
}

function removeApprovalWaiter(approvalId: string, waiter: ApprovalWaiter): void {
  if (waiter.timer) clearTimeout(waiter.timer);
  if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
  const set = approvalWaiters.get(approvalId);
  if (set) {
    set.delete(waiter);
    if (set.size === 0) approvalWaiters.delete(approvalId);
  }
}

/** 审批决策发生后调用：唤醒所有挂在该审批上的 run（无 waiter 时静默 no-op） */
export function notifyApprovalResolved(approvalId: string, resolution: ApprovalResolution): void {
  // W3：从 pending scope 缓存摘除 → 池 drain 可放行被堵 lane
  removeCachedPendingScope(approvalId);
  try {
    getAsyncJobOrchestrator(getAppConfig()).reevaluateQueue();
  } catch {
    /* 池未初始化时忽略 */
  }
  const set = approvalWaiters.get(approvalId);
  if (!set) return;
  for (const waiter of [...set]) {
    removeApprovalWaiter(approvalId, waiter);
    waiter.resolve(resolution);
  }
}

/** 从 DB 刷新 pending scope 缓存（启动 / 测试 / 对账） */
export async function refreshPendingApprovalScopeCache(
  services: ServiceContainer,
): Promise<void> {
  const rows = await services.prisma.approval.findMany({
    where: { status: "pending" },
    select: { id: true, decisionScope: true, toolName: true, args: true },
  });
  setCachedPendingApprovalScopes(
    rows.map((r) => {
      let scope = r.decisionScope;
      if (!scope) {
        const args =
          typeof r.args === "string"
            ? (JSON.parse(r.args) as Record<string, unknown>)
            : ((r.args as Record<string, unknown>) ?? {});
        scope = deriveDecisionScope(r.toolName, args);
      }
      return { approvalId: r.id, scope };
    }),
  );
}

/**
 * 审批 gate 通知单点：按 Approval.lastNotifiedAt + approvalGate.notifyCooldownMs 冷却。
 * 返回本次是否实际发出通知。
 */
export async function notifyPendingApprovalIfCooldownAllows(
  services: ServiceContainer,
  approval: {
    id: string;
    toolName: string;
    decisionScope?: string | null;
    lastNotifiedAt?: Date | string | null;
  },
  opts?: { subject?: string; body?: string },
): Promise<{ notified: boolean }> {
  const config = getAppConfig();
  const cooldownMs = config.approvalGate?.notifyCooldownMs ?? 30 * 60_000;
  const nowMs = Date.now();
  if (
    !shouldNotifyApprovalByCooldown({
      lastNotifiedAt: approval.lastNotifiedAt,
      cooldownMs,
      nowMs,
    })
  ) {
    return { notified: false };
  }

  const scopeHint = approval.decisionScope ? ` scope=${approval.decisionScope}` : "";
  const subject =
    opts?.subject ?? `[KnowPilot] 待审批：${approval.toolName}${scopeHint}`;
  const body =
    opts?.body ??
    `操作「${approval.toolName}」需要人工审批（approvalId=${approval.id}${scopeHint}）。\n请在 /approvals 处理。`;

  const result = await sendEmailNotification(config, services.log, {
    subject,
    body,
  });
  if ("error" in result) {
    console.warn(`[ApprovalGate] gate 通知未发送：${result.error}`);
    // 发送失败不盖 lastNotifiedAt，允许下次重试
    return { notified: false };
  }

  await services.prisma.approval.updateMany({
    where: { id: approval.id, status: "pending" },
    data: { lastNotifiedAt: new Date(nowMs) },
  });
  return { notified: true };
}

/** 从工具执行错误中提取 PENDING_APPROVAL 标记（assertApprovalOrProceed 抛出的 TRPCError cause） */
export function getPendingApprovalCause(
  err: unknown,
): { approvalId: string; decisionScope?: string } | null {
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (
    cause &&
    typeof cause === "object" &&
    (cause as { reason?: unknown }).reason === "PENDING_APPROVAL" &&
    typeof (cause as { approvalId?: unknown }).approvalId === "string"
  ) {
    const decisionScope = (cause as { decisionScope?: unknown }).decisionScope;
    return {
      approvalId: (cause as { approvalId: string }).approvalId,
      decisionScope: typeof decisionScope === "string" ? decisionScope : undefined,
    };
  }
  return null;
}

/** 将超时仍 pending 的单条审批翻转为 rejected（守卫式：仅当仍 pending，与人工决策/批量清扫竞态安全） */
async function expireApprovalIfPending(services: ServiceContainer, approvalId: string): Promise<boolean> {
  const result = await services.prisma.approval.updateMany({
    where: { id: approvalId, status: "pending" },
    data: {
      status: "rejected",
      decidedBy: "system-ttl",
      decidedAt: new Date(),
      decisionNote: "审批超时，自动拒绝。",
    },
  });
  return result.count > 0;
}

type ApprovalRow = {
  toolName: string;
  status: string;
  createdAt?: Date | string;
  decidedBy?: string | null;
};

/** 已决状态 → Resolution；仍需等待（pending / approved 未 execute）→ null */
function resolutionFromApprovalRow(approval: ApprovalRow, approvalId: string): ApprovalResolution | null {
  if (approval.status === "executed") {
    return { outcome: "approved", approvalId, toolName: approval.toolName };
  }
  if (approval.status === "rejected") {
    return {
      outcome: approval.decidedBy === "system-ttl" ? "expired" : "rejected",
      approvalId,
      toolName: approval.toolName,
    };
  }
  // pending 或 approved（尚未 execute）：继续等显式事件
  return null;
}

/**
 * 挂起等待审批决策（awaiting_human 的唯一唤醒通道）。
 * 返回决策结果；signal 中断时以 AbortError 拒绝（run 走 failed 收尾；与 ask_user 注入续轮不同，见文件头 A6）。
 */
export async function waitApprovalResolution(
  services: ServiceContainer,
  approvalId: string,
  opts?: { signal?: AbortSignal },
): Promise<ApprovalResolution> {
  return new Promise<ApprovalResolution>((resolvePromise, rejectPromise) => {
    let settled = false;
    let toolName = "unknown";

    const settle = (r: ApprovalResolution) => {
      if (settled) return;
      settled = true;
      resolvePromise(r);
    };
    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      rejectPromise(err);
    };

    const waiter: ApprovalWaiter = {
      resolve: (r) => {
        removeApprovalWaiter(approvalId, waiter);
        settle(r);
      },
      signal: opts?.signal,
    };
    waiter.onAbort = () => {
      removeApprovalWaiter(approvalId, waiter);
      settleReject(makeAbortError(opts?.signal));
    };

    // ① 同步注册先行——此后任何 notify 必达（消除读↔注册窗口丢事件）
    const set = approvalWaiters.get(approvalId) ?? new Set<ApprovalWaiter>();
    set.add(waiter);
    approvalWaiters.set(approvalId, set);

    if (opts?.signal) {
      if (opts.signal.aborted) {
        waiter.onAbort();
        return;
      }
      opts.signal.addEventListener("abort", waiter.onAbort, { once: true });
    }

    const armTtl = (createdAtMs: number) => {
      const ttl = getApprovalPendingTtlMs();
      if (ttl <= 0) return;
      const remaining = createdAtMs + ttl - Date.now();
      waiter.timer = setTimeout(() => {
        void (async () => {
          if (settled) return;
          let flipped = false;
          try {
            flipped = await expireApprovalIfPending(services, approvalId);
          } catch (err) {
            console.warn("[ApprovalGate] waiter TTL 过期落库失败:", err instanceof Error ? err.message : err);
          }
          if (settled) return;

          // expired 解析必须以条件写 count=1 为前提；count=0 = 并发已决 → 复读如实 resolve
          if (flipped) {
            removeApprovalWaiter(approvalId, waiter);
            settle({ outcome: "expired", approvalId, toolName });
            return;
          }
          try {
            const row = (await services.approval.getById(approvalId)) as ApprovalRow;
            toolName = row.toolName || toolName;
            const resolved = resolutionFromApprovalRow(row, approvalId);
            removeApprovalWaiter(approvalId, waiter);
            settle(resolved ?? { outcome: "rejected", approvalId, toolName });
          } catch {
            removeApprovalWaiter(approvalId, waiter);
            settle({ outcome: "rejected", approvalId, toolName });
          }
        })();
      }, Math.max(remaining, 0));
      if (typeof waiter.timer === "object" && "unref" in waiter.timer) waiter.timer.unref();
    };

    // ② 注册后再复读：已决立即收尾；pending 则挂 TTL 等待事件
    void (async () => {
      try {
        const approval = (await services.approval.getById(approvalId)) as ApprovalRow;
        if (settled) return; // 复读期间已被 notify 唤醒
        toolName = approval.toolName || toolName;
        const resolved = resolutionFromApprovalRow(approval, approvalId);
        if (resolved) {
          removeApprovalWaiter(approvalId, waiter);
          settle(resolved);
          return;
        }
        const createdAtMs = approval.createdAt ? new Date(approval.createdAt).getTime() : null;
        if (createdAtMs !== null) armTtl(createdAtMs);
      } catch {
        if (settled) return;
        removeApprovalWaiter(approvalId, waiter);
        settle({ outcome: "rejected", approvalId, toolName });
      }
    })();
  });
}

export function toolRequiresApproval(toolName: string): boolean {
  if (process.env.REQUIRE_APPROVAL === "false") return false;
  if (APPROVAL_REQUIRED_OPS.has(toolName)) return true;
  if (isDestructiveApprovalEnabled()) {
    if (getDestructiveNativeOps().has(toolName)) return true;
    // tRPC 侧与 native 对齐的删除（不在 native registry，与派生清单同开关）
    if (toolName === "memory.delete" || toolName === "post.delete") return true;
  }
  return false;
}

export function isNativeApprovalTool(toolName: string): boolean {
  return getDestructiveNativeOps().has(toolName);
}

function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  delete copy.approvalId;
  return copy;
}

/** 稳定序列化：按 key 排序，避免字段顺序导致误拒 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function argsMatch(stored: unknown, requested: Record<string, unknown>): boolean {
  let parsed: Record<string, unknown>;
  if (typeof stored === "string") {
    try {
      parsed = JSON.parse(stored) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else {
    parsed = (stored as Record<string, unknown>) ?? {};
  }
  return canonicalJson(normalizeArgs(parsed)) === canonicalJson(normalizeArgs(requested));
}

/** 将超时仍 pending 的审批标为 rejected；只对实际翻转成功的行发 notify；返回翻转条数 */
export async function expireStaleApprovals(services: ServiceContainer): Promise<number> {
  const ttl = getApprovalPendingTtlMs();
  if (ttl <= 0) return 0;
  const cutoff = new Date(Date.now() - ttl);
  const stale = await services.prisma.approval.findMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    select: { id: true, toolName: true },
  });
  if (stale.length === 0) return 0;

  // 逐条条件写：与人工批准/waiter TTL 竞态安全；仅 count=1 的行才 notify（避免误报 expired）
  let flipped = 0;
  for (const row of stale) {
    let ok = false;
    try {
      ok = await expireApprovalIfPending(services, row.id);
    } catch (err) {
      console.warn(
        `[ApprovalGate] expireStaleApprovals 翻转失败 id=${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (!ok) continue;
    flipped += 1;
    notifyApprovalResolved(row.id, { outcome: "expired", approvalId: row.id, toolName: row.toolName });
  }
  return flipped;
}

/**
 * 校验审批状态；未携带 approvalId 时自动创建 pending 记录并抛出 FORBIDDEN。
 */
export async function assertApprovalOrProceed(
  services: ServiceContainer,
  toolName: string,
  args: Record<string, unknown>,
  approvalId?: string,
): Promise<void> {
  if (!toolRequiresApproval(toolName)) return;

  // 惰性清理过期 pending，避免堆积
  try {
    await expireStaleApprovals(services);
  } catch (err) {
    console.warn("[ApprovalGate] 过期审批清理失败:", err instanceof Error ? err.message : err);
  }

  if (approvalId) {
    let approval: { toolName: string; args: unknown; status: string; createdAt?: Date | string };
    try {
      approval = (await services.approval.getById(approvalId)) as {
        toolName: string;
        args: unknown;
        status: string;
        createdAt?: Date | string;
      };
    } catch {
      throw new TRPCError({ code: "NOT_FOUND", message: `审批记录不存在：${approvalId}` });
    }
    if (approval.status === "rejected") {
      throw new TRPCError({ code: "FORBIDDEN", message: "该审批已拒绝或已超时失效，请重新发起。" });
    }
    if (approval.status !== "approved") {
      throw new TRPCError({ code: "FORBIDDEN", message: "该操作尚未通过审批，无法执行。" });
    }
    if (approval.toolName !== toolName) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "审批记录与当前操作类型不匹配。" });
    }
    if (!argsMatch(approval.args, args)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "审批参数与当前请求不一致，请重新发起审批。" });
    }
    return;
  }

  const normalizedArgs = normalizeArgs(args);
  const decisionScope = deriveDecisionScope(toolName, normalizedArgs);
  const created = await services.approval.create({
    toolName,
    args: normalizedArgs,
    status: "pending",
    decisionScope,
  } as Parameters<typeof services.approval.create>[0]);

  if (!created.success || !created.data) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建审批请求失败，请稍后重试。" });
  }

  const id = (created.data as { id: string }).id;
  upsertCachedPendingScope({ approvalId: id, scope: decisionScope });
  try {
    getAsyncJobOrchestrator(getAppConfig()).reevaluateQueue();
  } catch {
    /* 池未初始化时忽略 */
  }

  // 通知单点（冷却内抑制）；失败不阻断审批创建
  void notifyPendingApprovalIfCooldownAllows(services, {
    id,
    toolName,
    decisionScope,
    lastNotifiedAt: null,
  }).catch((err) => {
    console.warn(
      "[ApprovalGate] 创建后通知失败:",
      err instanceof Error ? err.message : err,
    );
  });

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `操作「${toolName}」需要人工审批，已加入审批队列（approvalId=${id}，scope=${decisionScope}）。请在 /approvals 批准后，携带同一参数与 approvalId 重试。`,
    cause: { reason: "PENDING_APPROVAL", approvalId: id, decisionScope },
  });
}

/** 执行已批准的审批请求，成功后软删除审批记录（status=executed，保留审计痕迹） */
export async function executeApprovedOperation(
  ctx: { services: ServiceContainer },
  approvalId: string,
): Promise<OperationResult<unknown>> {
  // 提升作用域：catch 里唤醒等待方时需要 toolName
  let resolvedToolName = "unknown";
  try {
    let approval: { id: string; toolName: string; args: unknown; status: string };
    try {
      approval = (await ctx.services.approval.getById(approvalId)) as {
        id: string;
        toolName: string;
        args: unknown;
        status: string;
      };
      resolvedToolName = approval.toolName;
    } catch {
      return failureFromError(
        new TRPCError({ code: "NOT_FOUND", message: "审批记录不存在。" }),
        "execute",
        "approval",
        "NOT_FOUND",
      );
    }

    if (approval.status !== "approved") {
      return failureFromError(
        new TRPCError({ code: "FORBIDDEN", message: "仅可执行已通过审批的操作。" }),
        "execute",
        "approval",
        "FORBIDDEN",
      );
    }

    const storedArgs =
      typeof approval.args === "string"
        ? (JSON.parse(approval.args) as Record<string, unknown>)
        : ((approval.args as Record<string, unknown>) ?? {});

    let execResult: unknown;

    if (isNativeApprovalTool(approval.toolName) || NATIVE_APPROVAL_EXECUTE_OPS.has(approval.toolName)) {
      const { executeNativeTool } = await import("./nativeTools.js");
      const { getAppConfig } = await import("./config.js");
      const config = getAppConfig();
      const invoke = createTrpcInvoker(ctx);
      execResult = await executeNativeTool(approval.toolName, storedArgs, {
        config,
        services: ctx.services,
        invokeTrpc: invoke,
      });
    } else {
      const invoke = createTrpcInvoker(ctx);
      execResult = await invoke(approval.toolName, {
        ...storedArgs,
        approvalId: approval.id,
      });
    }

    // 软删除：永不物理删除审批记录，标记 executed + 执行时间以保留审计痕迹
    await ctx.services.prisma.approval.update({
      where: { id: approval.id },
      data: { status: "executed", executedAt: new Date() },
    });
    // W11：approval_resolved 显式事件——唤醒挂在该审批上的 run（awaiting_human → llm）
    notifyApprovalResolved(approval.id, {
      outcome: "approved",
      approvalId: approval.id,
      toolName: approval.toolName,
      execResult,
    });
    return success({
      data: execResult,
      operation: "execute",
      entity: "approval",
    });
  } catch (err) {
    // W11：审批通过但执行失败也唤醒等待方（携带失败结果让 LLM 收尾，避免挂起到 TTL）
    try {
      notifyApprovalResolved(approvalId, {
        outcome: "approved",
        approvalId,
        toolName: resolvedToolName,
        execResult: { error: err instanceof Error ? err.message : String(err) },
      });
    } catch {
      /* 唤醒失败不阻塞原错误返回 */
    }
    return failureFromError(err, "execute", "approval");
  }
}
