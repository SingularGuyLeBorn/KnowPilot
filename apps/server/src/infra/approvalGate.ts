/**
 * ApprovalGate — 危险操作审批拦截
 *
 * 对 delete / git.push 等操作创建 pending Approval，或在携带已批准 approvalId 时放行。
 */

import { TRPCError } from "@trpc/server";
import type { ServiceContainer } from "./serviceContainer.js";
import { createTrpcInvoker } from "./trpcInvoker.js";
import { success, failureFromError } from "../trpc/result.js";
import type { OperationResult } from "@knowpilot/shared";

/** 默认需要人工审批的工具路径 */
const APPROVAL_REQUIRED_OPS = new Set([
  "agent.delete",
  "skill.delete",
  "mcp.delete",
  "task.delete",
  "file.delete",
  "git.push",
]);

export function toolRequiresApproval(toolName: string): boolean {
  if (process.env.REQUIRE_APPROVAL === "false") return false;
  return APPROVAL_REQUIRED_OPS.has(toolName);
}

function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...args };
  delete copy.approvalId;
  return copy;
}

function argsMatch(stored: unknown, requested: Record<string, unknown>): boolean {
  const a = normalizeArgs(
    typeof stored === "string" ? (JSON.parse(stored) as Record<string, unknown>) : ((stored as Record<string, unknown>) ?? {}),
  );
  const b = normalizeArgs(requested);
  return JSON.stringify(a) === JSON.stringify(b);
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

  if (approvalId) {
    let approval: { toolName: string; args: unknown; status: string };
    try {
      approval = (await services.approval.getById(approvalId)) as {
        toolName: string;
        args: unknown;
        status: string;
      };
    } catch {
      throw new TRPCError({ code: "NOT_FOUND", message: `审批记录不存在：${approvalId}` });
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

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `操作「${toolName}」需要人工审批，已加入审批队列。`,
    cause: { reason: "PENDING_APPROVAL", approvalId: (created.data as { id: string }).id },
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

    const invoke = createTrpcInvoker(ctx);
    const execResult = await invoke(approval.toolName, {
      ...storedArgs,
      approvalId: approval.id,
    });

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
