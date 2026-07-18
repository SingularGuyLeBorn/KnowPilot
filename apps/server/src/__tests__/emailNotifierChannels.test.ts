/**
 * 通知通道：ntfy / 多通道扇出
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/agentMailClient.js", () => ({
  sendAgentMailMessage: vi.fn(async () => ({ ok: true, messageId: "m1", inboxId: "i1" })),
}));

import {
  __resetNotifyBreakersForTests,
  sendEmailNotification,
} from "../infra/emailNotifier.js";
import type { AppConfig } from "../infra/config.js";

const config = { emailProvider: "none" } as AppConfig;

describe("emailNotifier channels", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetNotifyBreakersForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    delete process.env.NTFY_TOPIC;
    delete process.env.EMAIL_TO;
    process.env.EMAIL_PROVIDER = "none";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    __resetNotifyBreakersForTests();
    delete process.env.NTFY_TOPIC;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_TO;
  });

  it("仅 NTFY_TOPIC 时可推送（EMAIL_PROVIDER=none）", async () => {
    process.env.NTFY_TOPIC = "kp-test-topic-xyz";
    const result = await sendEmailNotification(config, undefined, {
      subject: "标题",
      body: "正文",
    });
    expect(result).toMatchObject({ success: true });
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("ntfy.sh/kp-test-topic-xyz");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Title: "标题" });
  });

  it("agentmail + ntfy 双通道扇出", async () => {
    process.env.EMAIL_PROVIDER = "agentmail";
    process.env.EMAIL_TO = "u@example.com";
    process.env.NTFY_TOPIC = "kp-dual";
    const result = await sendEmailNotification(
      { emailProvider: "agentmail" } as AppConfig,
      undefined,
      { subject: "双通道", body: "hi" },
    );
    expect(result).toMatchObject({ success: true });
    expect(vi.mocked(fetch)).toHaveBeenCalled();
  });

  it("ntfy 连续失败达阈值后熔断跳过", async () => {
    process.env.NTFY_TOPIC = "kp-breaker";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("fail", { status: 503 })),
    );

    for (let i = 0; i < 3; i++) {
      const r = await sendEmailNotification(config, undefined, {
        subject: `fail-${i}`,
        body: "x",
      });
      expect("error" in r).toBe(true);
      expect((r as { error: string }).error).toContain("ntfy");
    }

    const callsAfterFailures = vi.mocked(fetch).mock.calls.length;
    const blocked = await sendEmailNotification(config, undefined, {
      subject: "should-skip",
      body: "x",
    });
    expect("error" in blocked).toBe(true);
    expect((blocked as { error: string }).error).toContain("熔断");
    // 开闸期间不再打真实 fetch
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsAfterFailures);
  });
});
