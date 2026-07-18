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
]);

/** 经 native 执行层落库的写 Git 工具（approve-and-execute 走 executeNativeTool） */
const NATIVE_GIT_WRITE_OPS = new Set(["git_commit", "git_pull", "git_push"]);

/**
 * AGENT_DESTRUCTIVE_APPROVAL=true 时，Agent native 删除类工具也需审批。
 * 与 tRPC 列表对齐，并覆盖仅存在于 native 路径的删除（如 memory_delete、post_delete）。
 */
export const DESTRUCTIVE_NATIVE_OPS = new Set([
  "agent_delete",
  "memory_delete",
  "post_delete",
  "file_delete",
  "directory_delete",
  "yuque_delete_doc",
  "yuque_delete_doc_v2",
  "github_delete_file",
]);

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
 *    - expireStaleApprovals 批量清扫 / waiter 自带 TTL 截止（expired）
 * 3. 幂等消除竞态：wait 入口先读当前状态，已决直接返回，消除「resolve 先于 wait 注册」的双通道竞态。
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
  const set = approvalWaiters.get(approvalId);
  if (!set) return;
  for (const waiter of [...set]) {
    removeApprovalWaiter(approvalId, waiter);
    waiter.resolve(resolution);
  }
}

/** 从工具执行错误中提取 PENDING_APPROVAL 标记（assertApprovalOrProceed 抛出的 TRPCError cause） */
export function getPendingApprovalCause(err: unknown): { approvalId: string } | null {
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (
    cause &&
    typeof cause === "object" &&
    (cause as { reason?: unknown }).reason === "PENDING_APPROVAL" &&
    typeof (cause as { approvalId?: unknown }).approvalId === "string"
  ) {
    return { approvalId: (cause as { approvalId: string }).approvalId };
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

/**
 * 挂起等待审批决策（awaiting_human 的唯一唤醒通道）。
 * 返回决策结果；signal 中断时以 AbortError 拒绝（run 走 failed 收尾）。
 */
export async function waitApprovalResolution(
  services: ServiceContainer,
  approvalId: string,
  opts?: { signal?: AbortSignal },
): Promise<ApprovalResolution> {
  // 幂等入口：已决状态直接映射返回，消除「决策先于等待注册」的竞态
  let toolName = "unknown";
  let createdAtMs: number | null = null;
  try {
    const approval = (await services.approval.getById(approvalId)) as {
      toolName: string;
      status: string;
      createdAt?: Date | string;
      decidedBy?: string | null;
    };
    toolName = approval.toolName;
    createdAtMs = approval.createdAt ? new Date(approval.createdAt).getTime() : null;
    if (approval.status === "executed") {
      return { outcome: "approved", approvalId, toolName };
    }
    if (approval.status === "rejected") {
      return {
        outcome: approval.decidedBy === "system-ttl" ? "expired" : "rejected",
        approvalId,
        toolName,
      };
    }
    // status=approved（尚未 execute）：继续等 executeApprovedOperation 的显式事件，不提前放行
  } catch {
    // 审批行不存在：当作拒绝处理，让 LLM 收尾而不是永久挂起
    return { outcome: "rejected", approvalId, toolName };
  }

  return new Promise<ApprovalResolution>((resolvePromise, rejectPromise) => {
    const waiter: ApprovalWaiter = { resolve: resolvePromise, signal: opts?.signal };
    waiter.onAbort = () => {
      removeApprovalWaiter(approvalId, waiter);
      rejectPromise(makeAbortError(opts?.signal));
    };

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

    // TTL 截止机制：与 expireStaleApprovals 同一条 TTL 规则的两个执行点——
    // 批量清扫管「无 run 挂起的堆积」，本定时器管「本条有 run 挂起的审批」。
    // 到期时间与审批自身 createdAt+TTL 对齐，是领域截止而非时序猜测。
    const ttl = getApprovalPendingTtlMs();
    if (ttl > 0 && createdAtMs !== null) {
      const remaining = createdAtMs + ttl - Date.now();
      waiter.timer = setTimeout(() => {
        void (async () => {
          try {
            await expireApprovalIfPending(services, approvalId);
          } catch (err) {
            console.warn("[ApprovalGate] waiter TTL 过期落库失败:", err instanceof Error ? err.message : err);
          }
          removeApprovalWaiter(approvalId, waiter);
          resolvePromise({ outcome: "expired", approvalId, toolName });
        })();
      }, Math.max(remaining, 0));
      // 不阻断进程退出（测试/CLI 场景）
      if (typeof waiter.timer === "object" && "unref" in waiter.timer) waiter.timer.unref();
    }
  });
}

export function toolRequiresApproval(toolName: string): boolean {
  if (process.env.REQUIRE_APPROVAL === "false") return false;
  if (APPROVAL_REQUIRED_OPS.has(toolName)) return true;
  if (isDestructiveApprovalEnabled()) {
    if (DESTRUCTIVE_NATIVE_OPS.has(toolName)) return true;
    // tRPC 侧与 native 对齐的删除（默认不拦，仅开关打开时）
    if (toolName === "memory.delete" || toolName === "post.delete") return true;
  }
  return false;
}

export function isNativeApprovalTool(toolName: string): boolean {
  return DESTRUCTIVE_NATIVE_OPS.has(toolName);
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

/** 将超时仍 pending 的审批标为 rejected；返回处理条数 */
export async function expireStaleApprovals(services: ServiceContainer): Promise<number> {
  const ttl = getApprovalPendingTtlMs();
  if (ttl <= 0) return 0;
  const cutoff = new Date(Date.now() - ttl);
  // 先取出将被翻转的行（W11：需逐条发 approval_resolved 事件唤醒挂起的 run）
  const stale = await services.prisma.approval.findMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    select: { id: true, toolName: true },
  });
  if (stale.length === 0) return 0;
  // 单条 updateMany 全量清理，避免分页 pageSize 漏扫；同时落审计字段
  const result = await services.prisma.approval.updateMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
    data: {
      status: "rejected",
      decidedBy: "system-ttl",
      decidedAt: new Date(),
      decisionNote: "审批超时，自动拒绝。",
    },
  });
  for (const row of stale) {
    notifyApprovalResolved(row.id, { outcome: "expired", approvalId: row.id, toolName: row.toolName });
  }
  return result.count;
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

  const created = await services.approval.create({
    toolName,
    args: normalizeArgs(args),
    status: "pending",
  });

  if (!created.success || !created.data) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建审批请求失败，请稍后重试。" });
  }

  const id = (created.data as { id: string }).id;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `操作「${toolName}」需要人工审批，已加入审批队列（approvalId=${id}）。请在 /approvals 批准后，携带同一参数与 approvalId 重试。`,
    cause: { reason: "PENDING_APPROVAL", approvalId: id },
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

    if (isNativeApprovalTool(approval.toolName) || NATIVE_GIT_WRITE_OPS.has(approval.toolName)) {
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
