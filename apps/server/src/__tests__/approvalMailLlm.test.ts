/**
 * 邮件回复审批：原文注入回 Agent 测试
 *
 * 验证 resolveApprovalFromMail 把邮件回复**原文**作为用户消息注入回 Agent
 * （和用户在聊天框打字等价），而非后端硬判断 approved/rejected：
 * - 邮件回复匹配 pending 审批 → approval.status=user_replied + 唤醒 + answer=原文
 * - 空回复 → ok:false，审批仍 pending
 * - 未找到对应 pending 审批 → ok:false
 * - 审批已处理 → ok:false
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import { resolveApprovalFromMail, notifyApprovalResolved, __resetApprovalWaitersForTests } from "../infra/approvalGate.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";

describe("邮件回复审批 原文注入", () => {
  let caller: any;
  let ctx: Awaited<ReturnType<typeof createContextInner>>;
  const prevRequire = process.env.REQUIRE_APPROVAL;

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
  });

  afterAll(() => {
    if (prevRequire === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = prevRequire;
  });

  async function createPendingApprovalWithMessageId(messageId: string) {
    const created = await caller.approval.create({
      toolName: "agent.delete",
      args: { id: "fake-agent-id-" + messageId },
      status: "pending",
    });
    await ctx.prisma.approval.update({
      where: { id: created.data.id },
      data: { lastNotifiedMessageId: messageId, lastNotifiedThreadId: "thread-" + messageId },
    });
    return created.data.id;
  }

  it("邮件回复匹配 pending 审批 → status=user_replied + answer=原文（注入回 Agent）", async () => {
    const approvalId = await createPendingApprovalWithMessageId("msg-inject-1");
    __resetApprovalWaitersForTests();

    // 注册一个等待者，验证唤醒时拿到 user_replied + answer 原文
    const { waitApprovalResolution } = await import("../infra/approvalGate.js");
    const waitPromise = waitApprovalResolution(ctx.services as ServiceContainer, approvalId, {
      signal: new AbortController().signal,
    }).catch(() => null);

    const result = await resolveApprovalFromMail(ctx.services as ServiceContainer, {
      inReplyTo: "msg-inject-1",
      text: "这个操作没问题，可以执行，谢谢",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("user_replied");
      expect(result.answer).toBe("这个操作没问题，可以执行，谢谢");
    }

    const record = await caller.approval.getById({ id: approvalId });
    expect(record.status).toBe("user_replied");
    expect(record.decidedBy).toBe("email-reply");

    // 等待者应被唤醒，拿到 user_replied + answer
    const resolution = await waitPromise;
    expect(resolution?.outcome).toBe("user_replied");
    expect(resolution?.answer).toBe("这个操作没问题，可以执行，谢谢");

    notifyApprovalResolved(approvalId, { outcome: "user_replied", approvalId, toolName: "agent.delete", answer: "" });
  });

  it("用户邮件回复表达拒绝 → 同样注入原文，Agent 续轮自行判断（后端不硬决策）", async () => {
    const approvalId = await createPendingApprovalWithMessageId("msg-inject-reject");
    __resetApprovalWaitersForTests();

    const result = await resolveApprovalFromMail(ctx.services as ServiceContainer, {
      inReplyTo: "msg-inject-reject",
      text: "先别执行这个，我还要再想想",
    });

    // 后端不判断拒绝，仍注入原文让 Agent 自己理解
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answer).toBe("先别执行这个，我还要再想想");
    const record = await caller.approval.getById({ id: approvalId });
    expect(record.status).toBe("user_replied");
  });

  it("空回复 → ok:false，审批仍 pending", async () => {
    const approvalId = await createPendingApprovalWithMessageId("msg-inject-empty");
    __resetApprovalWaitersForTests();

    const result = await resolveApprovalFromMail(ctx.services as ServiceContainer, {
      inReplyTo: "msg-inject-empty",
      text: "   ",
    });

    expect(result.ok).toBe(false);
    const record = await caller.approval.getById({ id: approvalId });
    expect(record.status).toBe("pending");
  });

  it("未找到对应 pending 审批 → ok:false", async () => {
    const result = await resolveApprovalFromMail(ctx.services as ServiceContainer, {
      inReplyTo: "nonexistent-message-id",
      text: "批准",
    });
    expect(result.ok).toBe(false);
  });

  it("审批已处理（非 pending）→ ok:false", async () => {
    const approvalId = await createPendingApprovalWithMessageId("msg-inject-done");
    await caller.approval.update({ id: approvalId, status: "approved" });
    __resetApprovalWaitersForTests();

    const result = await resolveApprovalFromMail(ctx.services as ServiceContainer, {
      inReplyTo: "msg-inject-done",
      text: "批准",
    });
    expect(result.ok).toBe(false);
  });
});
