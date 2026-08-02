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
      encryptKey: "",
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
      encryptKey: "",
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

  it("im.message.receive_v1 剥 @ 后入站（白名单匹配）", async () => {
    const { handleIncomingMessage } = await import("../infra/messageGateway.js");
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "tok",
      encryptKey: "",
      enabled: true,
      allowedOpenIds: ["ou_user1"],
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

  it("未配置白名单时拒绝所有 p2p 入站", async () => {
    const { handleIncomingMessage } = await import("../infra/messageGateway.js");
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "tok",
      encryptKey: "",
      enabled: true,
      allowedOpenIds: [],
    });
    adapter.ingestWebhookPayload({
      header: { event_type: "im.message.receive_v1", event_id: "ev2", token: "tok" },
      event: {
        sender: { sender_id: { open_id: "ou_user2" } },
        message: {
          message_id: "om_2",
          chat_id: "oc_chat2",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "你好" }),
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it("* 白名单允许任意 openid", async () => {
    const { handleIncomingMessage } = await import("../infra/messageGateway.js");
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "tok",
      encryptKey: "",
      enabled: true,
      allowedOpenIds: ["*"],
    });
    adapter.ingestWebhookPayload({
      header: { event_type: "im.message.receive_v1", event_id: "ev3", token: "tok" },
      event: {
        sender: { sender_id: { open_id: "ou_anyone" } },
        message: {
          message_id: "om_3",
          chat_id: "oc_chat3",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "开放模式" }),
        },
      },
    });
    await vi.waitFor(() => {
      expect(handleIncomingMessage).toHaveBeenCalled();
    });
    const msg = (handleIncomingMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.payload.text).toBe("开放模式");
  });

  it("群聊无 mention 时忽略（无论是否配置白名单）", () => {
    const adapter = createFeishuBotAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: "tok",
      encryptKey: "",
      enabled: true,
      allowedOpenIds: ["ou_x"],
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
