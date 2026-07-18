/**
 * P0：工具预算切分 + 审批闸门单元测
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  partitionToolCallsByBudget,
  TOOL_BUDGET_SKIP_RESULT,
} from "../infra/agentTools.js";
import {
  toolRequiresApproval,
  isDestructiveApprovalEnabled,
  getApprovalPendingTtlMs,
  DESTRUCTIVE_NATIVE_OPS,
} from "../infra/approvalGate.js";
import type { LlmToolCall } from "../infra/llmClient.js";

function tc(id: string, name = "web_search"): LlmToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: "{}" },
  };
}

describe("partitionToolCallsByBudget", () => {
  it("额度充足时全部 runnable", () => {
    const calls = [tc("1"), tc("2"), tc("3")];
    const { runnable, deferred } = partitionToolCallsByBudget(calls, 0, 10);
    expect(runnable).toHaveLength(3);
    expect(deferred).toHaveLength(0);
  });

  it("额度不足时截断并保留 tool_call 顺序", () => {
    const calls = [tc("a"), tc("b"), tc("c")];
    const { runnable, deferred } = partitionToolCallsByBudget(calls, 1, 3);
    expect(runnable.map((c) => c.id)).toEqual(["a", "b"]);
    expect(deferred.map((c) => c.id)).toEqual(["c"]);
  });

  it("已用尽时全部 deferred", () => {
    const calls = [tc("x"), tc("y")];
    const { runnable, deferred } = partitionToolCallsByBudget(calls, 5, 5);
    expect(runnable).toHaveLength(0);
    expect(deferred).toHaveLength(2);
  });

  it("预算跳过结果带稳定错误码", () => {
    expect(TOOL_BUDGET_SKIP_RESULT.error).toBe("TOOL_BUDGET_EXCEEDED");
  });
});

describe("approvalGate destructive + TTL", () => {
  const prevDestructive = process.env.AGENT_DESTRUCTIVE_APPROVAL;
  const prevRequire = process.env.REQUIRE_APPROVAL;
  const prevTtl = process.env.APPROVAL_PENDING_TTL_MS;

  beforeEach(() => {
    delete process.env.AGENT_DESTRUCTIVE_APPROVAL;
    delete process.env.REQUIRE_APPROVAL;
    delete process.env.APPROVAL_PENDING_TTL_MS;
  });

  afterEach(() => {
    if (prevDestructive === undefined) delete process.env.AGENT_DESTRUCTIVE_APPROVAL;
    else process.env.AGENT_DESTRUCTIVE_APPROVAL = prevDestructive;
    if (prevRequire === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = prevRequire;
    if (prevTtl === undefined) delete process.env.APPROVAL_PENDING_TTL_MS;
    else process.env.APPROVAL_PENDING_TTL_MS = prevTtl;
  });

  it("默认不启用 destructive，native 删除不拦", () => {
    expect(isDestructiveApprovalEnabled()).toBe(false);
    expect(toolRequiresApproval("memory_delete")).toBe(false);
    expect(toolRequiresApproval("post.delete")).toBe(false);
  });

  it("AGENT_DESTRUCTIVE_APPROVAL=true 时拦 native 与对齐的 tRPC 删除", () => {
    process.env.AGENT_DESTRUCTIVE_APPROVAL = "true";
    expect(toolRequiresApproval("memory_delete")).toBe(true);
    expect(toolRequiresApproval("agent_delete")).toBe(true);
    expect(toolRequiresApproval("memory.delete")).toBe(true);
    expect(toolRequiresApproval("post.delete")).toBe(true);
    expect(toolRequiresApproval("web_search")).toBe(false);
    for (const name of DESTRUCTIVE_NATIVE_OPS) {
      expect(toolRequiresApproval(name)).toBe(true);
    }
  });

  it("既有 tRPC 危险操作仍默认需要审批", () => {
    expect(toolRequiresApproval("agent.delete")).toBe(true);
    expect(toolRequiresApproval("git.push")).toBe(true);
  });

  it("Agent native git 写操作与 tRPC 同档需审批（防绕过）", () => {
    expect(toolRequiresApproval("git_commit")).toBe(true);
    expect(toolRequiresApproval("git_pull")).toBe(true);
    expect(toolRequiresApproval("git_push")).toBe(true);
    expect(toolRequiresApproval("git.commit")).toBe(true);
    expect(toolRequiresApproval("git.pull")).toBe(true);
    // 只读不拦
    expect(toolRequiresApproval("git_status")).toBe(false);
    expect(toolRequiresApproval("git_diff")).toBe(false);
  });

  it("REQUIRE_APPROVAL=false 全局关闭", () => {
    process.env.REQUIRE_APPROVAL = "false";
    process.env.AGENT_DESTRUCTIVE_APPROVAL = "true";
    expect(toolRequiresApproval("agent.delete")).toBe(false);
    expect(toolRequiresApproval("memory_delete")).toBe(false);
  });

  it("APPROVAL_PENDING_TTL_MS 默认 24h，0 关闭", () => {
    expect(getApprovalPendingTtlMs()).toBe(24 * 60 * 60 * 1000);
    process.env.APPROVAL_PENDING_TTL_MS = "0";
    expect(getApprovalPendingTtlMs()).toBe(0);
    process.env.APPROVAL_PENDING_TTL_MS = "3600000";
    expect(getApprovalPendingTtlMs()).toBe(3600000);
  });
});
