/**
 * ask_user：挂起/唤醒、邮件关联、提醒节奏、幂等
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __getAskUserReminderCountForTests,
  __resetAskUserGateForTests,
  bindAskUserMailIds,
  buildAskUserResumeMessage,
  createAskUserPending,
  listAskUserPendingForSession,
  resolveAskUser,
  resolveAskUserFromMail,
  waitAskUserResolution,
} from "../infra/askUserGate.js";
import type { AppConfig } from "../infra/config.js";

vi.mock("../infra/emailNotifier.js", () => ({
  sendEmailNotification: vi.fn(async () => ({ success: true, message: "ok" })),
}));

import { sendEmailNotification } from "../infra/emailNotifier.js";

const config = { emailProvider: "none" } as AppConfig;

describe("askUserGate", () => {
  beforeEach(() => {
    __resetAskUserGateForTests();
    vi.mocked(sendEmailNotification).mockClear();
    vi.useFakeTimers();
    process.env.ASK_USER_FIRST_REMINDER_MS = "1000";
    process.env.ASK_USER_REPEAT_REMINDER_MS = "2000";
    process.env.ASK_USER_TTL_MS = "60000";
  });

  afterEach(() => {
    __resetAskUserGateForTests();
    vi.useRealTimers();
    delete process.env.ASK_USER_FIRST_REMINDER_MS;
    delete process.env.ASK_USER_REPEAT_REMINDER_MS;
    delete process.env.ASK_USER_TTL_MS;
  });

  it("UI resolve 唤醒 waitAskUserResolution", async () => {
    const pending = await createAskUserPending({
      sessionId: "clxxxxxxxxxxxxxxxxxxxx",
      question: "选哪个模型？",
      options: ["A", "B"],
      channel: "ui",
      config,
    });
    const waitP = waitAskUserResolution(pending.askId);
    const result = resolveAskUser(pending.askId, "A", "ui");
    expect(result.ok).toBe(true);
    const resolution = await waitP;
    expect(resolution.outcome).toBe("answered");
    expect(resolution.answer).toBe("A");
    expect(buildAskUserResumeMessage(resolution)).toContain("用户已答复");
    expect(listAskUserPendingForSession("clxxxxxxxxxxxxxxxxxxxx")).toHaveLength(0);
  });

  it("邮件 in_reply_to 命中正确 askId", async () => {
    const pending = await createAskUserPending({
      sessionId: "clxxxxxxxxxxxxxxxxxxxx",
      question: "邮箱问句",
      channel: "email",
      config,
    });
    bindAskUserMailIds(pending.askId, {
      messageId: "<out-1@agentmail.to>",
      threadId: "thd_1",
    });
    const waitP = waitAskUserResolution(pending.askId);
    const matched = resolveAskUserFromMail({
      eventId: "evt_1",
      inReplyTo: "<out-1@agentmail.to>",
      text: "我选 DeepSeek",
    });
    expect(matched.ok).toBe(true);
    if (matched.ok) expect(matched.askId).toBe(pending.askId);
    const resolution = await waitP;
    expect(resolution.answer).toBe("我选 DeepSeek");
    expect(resolution.source).toBe("email");

    // 同 event 幂等
    const again = resolveAskUserFromMail({
      eventId: "evt_1",
      inReplyTo: "<out-1@agentmail.to>",
      text: "重复",
    });
    expect(again.ok).toBe(false);
  });

  it("10 分钟级首次提醒 + 周期性提醒（测试用缩短 ms）", async () => {
    const pending = await createAskUserPending({
      sessionId: "clxxxxxxxxxxxxxxxxxxxx",
      question: "还在吗？",
      channel: "ui",
      config,
    });

    expect(vi.mocked(sendEmailNotification)).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(sendEmailNotification)).toHaveBeenCalledTimes(1);
    expect(__getAskUserReminderCountForTests(pending.askId)).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.mocked(sendEmailNotification)).toHaveBeenCalledTimes(2);

    resolveAskUser(pending.askId, "收到", "ui");
    await vi.advanceTimersByTimeAsync(5000);
    // 答复后不再提醒
    expect(vi.mocked(sendEmailNotification)).toHaveBeenCalledTimes(2);
  });

  it("resolve 先于 wait 注册时仍能拿到答复（竞态幂等）", async () => {
    const pending = await createAskUserPending({
      sessionId: "clxxxxxxxxxxxxxxxxxxxx",
      question: "竞态题",
      channel: "ui",
      config,
    });
    expect(resolveAskUser(pending.askId, "先答", "ui").ok).toBe(true);
    const resolution = await waitAskUserResolution(pending.askId);
    expect(resolution.outcome).toBe("answered");
    expect(resolution.answer).toBe("先答");
  });

  it("TTL 超时以 expired 唤醒", async () => {
    process.env.ASK_USER_TTL_MS = "500";
    const pending = await createAskUserPending({
      sessionId: "clxxxxxxxxxxxxxxxxxxxx",
      question: "超时题",
      channel: "ui",
      config,
    });
    const waitP = waitAskUserResolution(pending.askId);
    await vi.advanceTimersByTimeAsync(600);
    const resolution = await waitP;
    expect(resolution.outcome).toBe("expired");
  });
});
