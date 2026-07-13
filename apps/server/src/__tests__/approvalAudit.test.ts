/**
 * W1：审批审计合规测试
 *
 * 1. 审批执行后记录保留（软删除）：status=executed + executedAt，决策审计字段落库
 * 2. 过期清理不受旧 pageSize:100 限制：超过 100 条 pending 一条 updateMany 全扫到
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import { expireStaleApprovals } from "../infra/approvalGate.js";

describe("W1 审批审计合规", () => {
  let caller: any;
  let ctx: Awaited<ReturnType<typeof createContextInner>>;
  const prevTtl = process.env.APPROVAL_PENDING_TTL_MS;

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
  });

  afterAll(() => {
    if (prevTtl === undefined) delete process.env.APPROVAL_PENDING_TTL_MS;
    else process.env.APPROVAL_PENDING_TTL_MS = prevTtl;
  });

  it("审批执行后记录仍在且 status=executed，审计字段落库", async () => {
    const agent = await caller.agent.create({
      name: `ApprovalAudit_${Date.now()}`,
      description: "w1 audit test",
      tools: ["skill:*"],
      model: "deepseek-chat",
    });
    expect(agent.success).toBe(true);
    const agentId = agent.data!.id;

    const created = await caller.approval.create({
      toolName: "agent.delete",
      args: { id: agentId },
      status: "pending",
    });
    expect(created.success).toBe(true);

    // 批准：决策审计字段应自动落库
    const approved = await caller.approval.update({ id: created.data.id, status: "approved" });
    expect(approved.success).toBe(true);
    expect(approved.data.decidedBy).toBe("local-user");
    expect(approved.data.decidedAt).toBeTruthy();

    const executed = await caller.approval.execute({ id: created.data.id });
    expect(executed.success).toBe(true);

    // 操作确实执行了
    await expect(caller.agent.getById({ id: agentId })).rejects.toThrow();

    // 审计关键断言：记录未被物理删除，而是软删除为 executed
    const record = await caller.approval.getById({ id: created.data.id });
    expect(record.status).toBe("executed");
    expect(record.executedAt).toBeTruthy();
  });

  it("拒绝时写入 decisionNote 与决策审计字段", async () => {
    const created = await caller.approval.create({
      toolName: "agent.delete",
      args: { id: "nonexistent" },
      status: "pending",
    });
    expect(created.success).toBe(true);

    const rejected = await caller.approval.update({
      id: created.data.id,
      status: "rejected",
      decisionNote: "测试拒绝理由",
    });
    expect(rejected.success).toBe(true);
    expect(rejected.data.decisionNote).toBe("测试拒绝理由");
    expect(rejected.data.decidedBy).toBe("local-user");
    expect(rejected.data.decidedAt).toBeTruthy();

    await caller.approval.delete({ id: created.data.id });
  });

  it("过期清理超过 100 条也全扫到", async () => {
    process.env.APPROVAL_PENDING_TTL_MS = "60000"; // TTL 1 分钟
    const staleCount = 105;
    const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 分钟前，已过期

    await ctx.prisma.approval.createMany({
      data: Array.from({ length: staleCount }, (_, i) => ({
        toolName: "test.stale",
        args: { i },
        status: "pending",
        createdAt: oldDate,
      })),
    });
    // 2 条未过期 pending，不应被清理
    await ctx.prisma.approval.createMany({
      data: [0, 1].map((i) => ({
        toolName: "test.fresh",
        args: { i },
        status: "pending",
      })),
    });

    try {
      const n = await expireStaleApprovals(ctx.services);
      expect(n).toBeGreaterThanOrEqual(staleCount);

      const remainingStale = await ctx.prisma.approval.count({
        where: { toolName: "test.stale", status: "pending" },
      });
      expect(remainingStale).toBe(0);

      const remainingFresh = await ctx.prisma.approval.count({
        where: { toolName: "test.fresh", status: "pending" },
      });
      expect(remainingFresh).toBe(2);

      // 超时拒绝也落审计字段
      const sample = await ctx.prisma.approval.findFirst({ where: { toolName: "test.stale" } });
      expect(sample?.status).toBe("rejected");
      expect(sample?.decidedBy).toBe("system-ttl");
      expect(sample?.decidedAt).toBeTruthy();
    } finally {
      await ctx.prisma.approval.deleteMany({ where: { toolName: { in: ["test.stale", "test.fresh"] } } });
      if (prevTtl === undefined) delete process.env.APPROVAL_PENDING_TTL_MS;
      else process.env.APPROVAL_PENDING_TTL_MS = prevTtl;
    }
  });
});
