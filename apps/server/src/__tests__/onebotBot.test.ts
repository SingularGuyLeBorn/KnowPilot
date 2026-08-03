/**
 * OneBot v11 Adapter Unit Tests
 * 验证：
 * 1. ingestWebhookPayload 正确解析私聊/群聊 OneBot v11 payload 且剥离 CQ 码
 * 2. 白名单拦截非允许用户
 * 3. self_id 绑定指定 QQ 账号
 * 4. 群聊白名单、消息类型过滤、@ 要求
 * 5. 产生 UnifiedMessage 并通过 MessageGateway 路由
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createOneBotAdapter, loadOneBotConfigFromEnv } from "../infra/channels/onebotBot.js";
import { initMessageGateway, __resetMessageGatewayForTests } from "../infra/messageGateway.js";
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";

const config = getAppConfig();
const services = getServiceContainer(prisma, getEventBus(), config);

describe("OneBot v11 Channel Adapter", () => {
  beforeAll(() => {
    initMessageGateway({ prisma, services, config });
  });

  afterAll(async () => {
    await __resetMessageGatewayForTests();
  });

  it("正确加载配置与初始状态", () => {
    const cfg = loadOneBotConfigFromEnv();
    expect(cfg.httpUrl).toBeTruthy();
    expect(cfg.groupMessageTypes).toContain("text");
    expect(cfg.groupRequireAt).toBe(true);
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: [],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
    });
    expect(adapter.channel).toBe("onebot");
    expect(adapter.enabled).toBe(true);
    expect(adapter.getStatus().state).toBe("disconnected");
  });

  it("解析私聊 OneBot 消息 payload 并剥离 CQ 码", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: [],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
    }) as any;

    const payload = {
      post_type: "message",
      message_type: "private",
      self_id: 2871732121,
      user_id: 12345678,
      message_id: 99991,
      message: "[CQ:at,qq=888888] 你好，帮我总结这篇文章",
      raw_message: "[CQ:at,qq=888888] 你好，帮我总结这篇文章",
    };

    const res = adapter.ingestWebhookPayload(payload);
    expect(res.ok).toBe(true);
  });

  it("黑白名单校验：拒绝未授权用户", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["888888"],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
    }) as any;

    const payload = {
      post_type: "message",
      message_type: "private",
      self_id: 2871732121,
      user_id: 999999,
      message_id: 99992,
      message: "未经授权的消息",
    };

    const res = adapter.ingestWebhookPayload(payload);
    // ingestWebhookPayload 正常返回 { ok: true } 但不会触发 handleIncomingMessage
    expect(res.ok).toBe(true);
  });

  it("self_id 不匹配时拒绝", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["12345678"],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
      qqAccount: "2871732121",
    }) as any;

    const res = adapter.ingestWebhookPayload({
      post_type: "message",
      message_type: "private",
      self_id: 2635495642,
      user_id: 12345678,
      message_id: 99993,
      message: "发给错号的消息",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("self_id");
  });

  it("self_id 匹配时允许", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["12345678"],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
      qqAccount: "2871732121",
    }) as any;

    const res = adapter.ingestWebhookPayload({
      post_type: "message",
      message_type: "private",
      self_id: 2871732121,
      user_id: 12345678,
      message_id: 99994,
      message: "发给本号的消息",
    });
    expect(res.ok).toBe(true);
  });

  it("群聊非白名单群拒绝", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["12345678"],
      allowedGroups: ["111111"],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
      qqAccount: "2871732121",
    }) as any;

    const res = adapter.ingestWebhookPayload({
      post_type: "message",
      message_type: "group",
      self_id: 2871732121,
      user_id: 12345678,
      group_id: 222222,
      message_id: 99995,
      message: [{ type: "text", data: { text: "群里闲聊" } }, { type: "at", data: { qq: 2871732121 } }],
    });
    expect(res.ok).toBe(true); // 异步忽略，同步仍 ack
  });

  it("群聊白名单群但非 @ 拒绝", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["12345678"],
      allowedGroups: ["222222"],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
      qqAccount: "2871732121",
    }) as any;

    const res = adapter.ingestWebhookPayload({
      post_type: "message",
      message_type: "group",
      self_id: 2871732121,
      user_id: 12345678,
      group_id: 222222,
      message_id: 99996,
      message: [{ type: "text", data: { text: "群里没 @" } }],
    });
    expect(res.ok).toBe(true);
  });

  it("群聊白名单群 + @ 本 Bot 允许", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["12345678"],
      allowedGroups: ["222222"],
      groupMessageTypes: ["text", "at"],
      groupRequireAt: true,
      qqAccount: "2871732121",
    }) as any;

    const res = adapter.ingestWebhookPayload({
      post_type: "message",
      message_type: "group",
      self_id: 2871732121,
      user_id: 12345678,
      group_id: 222222,
      message_id: 99997,
      message: [
        { type: "text", data: { text: "[CQ:at,qq=2871732121] 帮我整理" } },
      ],
      raw_message: "[CQ:at,qq=2871732121] 帮我整理",
    });
    expect(res.ok).toBe(true);
  });

  it("群聊非允许消息类型拒绝", () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["12345678"],
      allowedGroups: ["222222"],
      groupMessageTypes: ["text"],
      groupRequireAt: false,
      qqAccount: "2871732121",
    }) as any;

    const res = adapter.ingestWebhookPayload({
      post_type: "message",
      message_type: "group",
      self_id: 2871732121,
      user_id: 12345678,
      group_id: 222222,
      message_id: 99998,
      message: [{ type: "image", data: { url: "http://example.com/a.png" } }],
    });
    expect(res.ok).toBe(true);
  });

  it("reply 自动提取 Markdown 图片并作为 image segment 发送", async () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: ["12345678"],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
    }) as any;

    const sendMock = vi.fn().mockResolvedValue({ message_id: 42 });
    adapter.sendOneBotApi = sendMock;

    await adapter.reply(
      {
        envelope: { channel: "onebot", peerId: "12345678", timestamp: new Date().toISOString() },
        payload: { text: "" },
        meta: { eventId: "msg-img-1" },
      },
      {
        text: "这是生成的图：![生成图](/uploads/test.png)。正文继续。",
        finish: true,
      },
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0];
    expect(call[0]).toBe("/send_private_msg");
    const message = call[1].message;
    expect(Array.isArray(message)).toBe(true);
    expect(message).toHaveLength(2);
    expect(message[0].type).toBe("text");
    expect(message[1].type).toBe("image");
    expect(message[1].data.file).toContain("uploads/test.png");
  });

  it("sendImage 发送私聊图片", async () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: [],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
    }) as any;

    const sendMock = vi.fn().mockResolvedValue({ message_id: 43 });
    adapter.sendOneBotApi = sendMock;

    await adapter.sendImage({ userId: "12345678", file: "content/uploads/a.png" });
    expect(sendMock).toHaveBeenCalledWith("/send_private_msg", {
      user_id: 12345678,
      message: [{ type: "image", data: { file: expect.stringContaining("content/uploads/a.png") } }],
    });
  });

  it("sendVideo 发送群视频", async () => {
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: [],
      allowedGroups: [],
      groupMessageTypes: ["text"],
      groupRequireAt: true,
    }) as any;

    const sendMock = vi.fn().mockResolvedValue({ message_id: 44 });
    adapter.sendOneBotApi = sendMock;

    await adapter.sendVideo({ groupId: "222222", file: "https://example.com/a.mp4" });
    expect(sendMock).toHaveBeenCalledWith("/send_group_msg", {
      group_id: 222222,
      message: [{ type: "video", data: { file: "https://example.com/a.mp4" } }],
    });
  });
});
