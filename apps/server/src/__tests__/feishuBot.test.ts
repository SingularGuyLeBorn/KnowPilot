import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFeishuBotAdapter } from "../infra/channels/feishuBot.js";

vi.mock("../infra/messageGateway.js", () => ({
  handleIncomingMessage: vi.fn(async () => ({ ok: true, sessionId: "s1" })),
}));

vi.mock("../infra/config.js", () => ({
  getAppConfig: () => ({ integrations: { feishu: {} } }),
}));

vi.mock("../infra/feishuClient.js", () => ({
  feishuReplyText: vi.fn(async () => ({})),
  feishuSendText: vi.fn(async () => ({})),
}));

describe("feishuBot ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("url_verification 返回 challenge", () => {
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "tok",
      enabled: true,
      allowedOpenIds: [],
    });
    const r = adapter.ingestWebhookPayload({
      type: "url_verification",
      challenge: "c-123",
      token: "tok",
    });
    expect(r.ok).toBe(true);
    expect(r.challenge).toBe("c-123");
  });

  it("未配置 verification token 时拒绝 url_verification", () => {
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "",
      enabled: true,
      allowedOpenIds: [],
    });
    const r = adapter.ingestWebhookPayload({
      type: "url_verification",
      challenge: "c-123",
      token: "anything",
    });
    expect(r).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringMatching(/VERIFICATION_TOKEN|未配置/),
      }),
    );
  });

  it("im.message.receive_v1 剥 @ 后入站", async () => {
    const { handleIncomingMessage } = await import("../infra/messageGateway.js");
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "tok",
      enabled: true,
      allowedOpenIds: [],
    });
    const r = adapter.ingestWebhookPayload({
      header: { event_type: "im.message.receive_v1", event_id: "ev1", token: "tok" },
      event: {
        sender: { sender_id: { open_id: "ou_user1" } },
        message: {
          message_id: "om_1",
          chat_id: "oc_chat1",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "@_user_1 帮我写周报" }),
          mentions: [{ key: "@_user_1", name: "见微" }],
        },
      },
    });
    expect(r.ok).toBe(true);
    await vi.waitFor(() => {
      expect(handleIncomingMessage).toHaveBeenCalled();
    });
    const msg = (handleIncomingMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.envelope.channel).toBe("feishu");
    expect(msg.envelope.peerId).toBe("ou_user1");
    expect(msg.payload.text).toContain("帮我写周报");
    expect(msg.payload.text).not.toContain("@_user_1");
  });

  it("群聊无 mention 且无白名单时忽略", () => {
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "tok",
      enabled: true,
      allowedOpenIds: [],
    });
    const r = adapter.ingestWebhookPayload({
      header: { event_type: "im.message.receive_v1", token: "tok" },
      event: {
        sender: { sender_id: { open_id: "ou_x" } },
        message: {
          message_id: "om_2",
          chat_id: "oc_g",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "闲聊" }),
        },
      },
    });
    expect(r.ok).toBe(false);
  });
});
