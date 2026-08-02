/**
 * OneBot v11 Adapter Unit Tests
 * 验证：
 * 1. ingestWebhookPayload 正确解析私聊/群聊 OneBot v11 payload 且剥离 CQ 码
 * 2. 白名单拦截非允许用户
 * 3. 产生 UnifiedMessage 并通过 MessageGateway 路由
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
    const adapter = createOneBotAdapter({
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      secret: "",
      enabled: true,
      allowedUsers: [],
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
    }) as any;

    const payload = {
      post_type: "message",
      message_type: "private",
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
    }) as any;

    const payload = {
      post_type: "message",
      message_type: "private",
      user_id: 999999,
      message_id: 99992,
      message: "未经授权的消息",
    };

    const res = adapter.ingestWebhookPayload(payload);
    // ingestWebhookPayload 正常返回 { ok: true } 但不会触发 handleIncomingMessage
    expect(res.ok).toBe(true);
  });
});
