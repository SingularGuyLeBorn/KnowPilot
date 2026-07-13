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

/** 默认需要人工审批的 tRPC 工具路径 */
const APPROVAL_REQUIRED_OPS = new Set([
  "agent.delete",
  "skill.delete",
  "mcp.delete",
  "task.delete",
  "file.delete",
  "git.push",
  "git.commit",
  "git.pull",
]);

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

/** pending 审批过期毫秒；0 或未解析出有效值时关闭 TTL（默认 24h） */
export function getApprovalPendingTtlMs(): number {
  const raw = process.env.APPROVAL_PENDING_TTL_MS;
  if (raw === undefined || raw === "") return 24 * 60 * 60 * 1000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 24 * 60 * 60 * 1000;
  return n;
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
  const cutoff = Date.now() - ttl;
  const list = await services.approval.list({ page: 1, pageSize: 100, status: "pending" });
  let n = 0;
  for (const item of list.items) {
    const created = new Date(item.createdAt).getTime();
    if (Number.isFinite(created) && created < cutoff) {
      await services.approval.update({
        id: item.id,
        status: "rejected",
      });
      n += 1;
    }
  }
  return n;
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

/** 执行已批准的审批请求，成功后删除审批记录 */
export async function executeApprovedOperation(
  ctx: { services: ServiceContainer },
  approvalId: string,
): Promise<OperationResult<unknown>> {
  try {
    let approval: { id: string; toolName: string; args: unknown; status: string };
    try {
      approval = (await ctx.services.approval.getById(approvalId)) as {
        id: string;
        toolName: string;
        args: unknown;
        status: string;
      };
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

    if (isNativeApprovalTool(approval.toolName)) {
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

    await ctx.services.approval.delete(approval.id);
    return success({
      data: execResult,
      operation: "execute",
      entity: "approval",
    });
  } catch (err) {
    return failureFromError(err, "execute", "approval");
  }
}
