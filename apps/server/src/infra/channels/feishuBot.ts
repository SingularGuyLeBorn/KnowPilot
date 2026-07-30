/**
 * 飞书机器人入站（事件订阅 webhook）→ MessageGateway。
 *
 * 配置：
 * - FEISHU_APP_ID / FEISHU_APP_SECRET（tenant token，出站回帖）
 * - FEISHU_BOT_VERIFICATION_TOKEN（必填；缺省或 mismatch 硬拒 webhook）
 * - FEISHU_BOT_ALLOWED_OPENIDS（可选白名单，逗号分隔）
 * - FEISHU_BOT_ENABLED=false 可强制关闭
 *
 * 飞书后台：事件订阅 → 请求地址 https://<公网>/api/webhooks/feishu
 * 订阅 im.message.receive_v1；权限 im:message / im:message:send_as_bot
 */

import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { getAppConfig } from "../config.js";
import { feishuReplyText, feishuSendText } from "../feishuClient.js";
import type {
  ChannelAdapter,
  ChannelReplyChunk,
  UnifiedMessage,
} from "../messageGateway.js";
import { handleIncomingMessage } from "../messageGateway.js";
import { gateFeishuVerificationToken } from "./webhookVerify.js";

export type FeishuBotConfig = {
  appId: string;
  appSecret: string;
  verificationToken: string;
  enabled: boolean;
  allowedOpenIds: string[];
};

type ReplyCtx = {
  openId: string;
  chatId: string;
  messageId: string;
  chatType: "p2p" | "group" | string;
};

export function loadFeishuBotConfigFromEnv(): FeishuBotConfig {
  const appId = (process.env.FEISHU_APP_ID || process.env.LARK_APP_ID || "").trim();
  const appSecret = (process.env.FEISHU_APP_SECRET || process.env.LARK_APP_SECRET || "").trim();
  const verificationToken = (
    process.env.FEISHU_BOT_VERIFICATION_TOKEN ||
    process.env.FEISHU_VERIFICATION_TOKEN ||
    ""
  ).trim();
  const allowed = (process.env.FEISHU_BOT_ALLOWED_OPENIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const yamlOff = process.env.FEISHU_BOT_ENABLED === "false";
  return {
    appId,
    appSecret,
    verificationToken,
    enabled: Boolean(appId && appSecret) && !yamlOff,
    allowedOpenIds: allowed,
  };
}

function stripMentions(text: string, mentions: Array<{ key?: string; name?: string }> | undefined): string {
  let out = text;
  if (Array.isArray(mentions)) {
    for (const m of mentions) {
      if (m.key) out = out.split(m.key).join("");
      if (m.name) out = out.replace(new RegExp(`@${m.name}`, "g"), "");
    }
  }
  // 飞书常见 @_user_1 占位
  out = out.replace(/@_user_\d+/g, "").replace(/@\S+/g, "");
  return out.replace(/\s+/g, " ").trim();
}

export function createFeishuBotAdapter(cfg: FeishuBotConfig): ChannelAdapter & {
  ingestWebhookPayload: (
    body: unknown,
  ) =>
    | { ok: true; challenge?: string }
    | { ok: false; error: string; challenge?: string };
} {
  let state = "disconnected";
  let lastError: string | undefined;
  const replyCtx = new Map<string, ReplyCtx>();
  let appConfig: AppConfig | null = null;

  const getConfig = (): AppConfig => {
    if (!appConfig) appConfig = getAppConfig();
    return appConfig;
  };

  const ingestText = (opts: {
    openId: string;
    chatId: string;
    text: string;
    messageId: string;
    chatType: string;
  }) => {
    if (cfg.allowedOpenIds.length && !cfg.allowedOpenIds.includes(opts.openId)) {
      console.warn(`[feishu-bot] 拒绝非白名单 ${opts.openId}`);
      return;
    }
    const text = opts.text.trim();
    if (!text) return;
    const msg: UnifiedMessage = {
      envelope: {
        channel: "feishu",
        peerId: opts.openId,
        chatId: opts.chatId,
        timestamp: new Date().toISOString(),
      },
      payload: { text },
      meta: { eventId: opts.messageId, replyTo: opts.messageId },
    };
    replyCtx.set(opts.messageId, {
      openId: opts.openId,
      chatId: opts.chatId,
      messageId: opts.messageId,
      chatType: opts.chatType,
    });
    handleIncomingMessage(msg)
      .then((r) => {
        if (!r.ok) console.warn(`[feishu-bot] 入站失败: ${r.error}`);
      })
      .catch((err) => {
        console.warn(`[feishu-bot] 入站异常:`, err instanceof Error ? err.message : err);
      });
  };

  const ingestWebhookPayload = (body: unknown) => {
    const b = body as Record<string, unknown>;

    // URL 验证（飞书配置事件订阅时）—— verification token 必填且必须匹配
    if (b.type === "url_verification" || (typeof b.challenge === "string" && !b.header)) {
      const token = String(b.token ?? "");
      const gate = gateFeishuVerificationToken({
        configuredToken: cfg.verificationToken,
        incomingToken: token,
      });
      if (!gate.ok) return { ok: false as const, error: gate.error };
      return { ok: true as const, challenge: String(b.challenge ?? "") };
    }

    // 事件 token 校验（header.token 或顶层 token）—— 未配置 / 不匹配一律拒
    const header = (b.header ?? {}) as Record<string, unknown>;
    const eventToken = String(header.token ?? b.token ?? "");
    const eventGate = gateFeishuVerificationToken({
      configuredToken: cfg.verificationToken,
      incomingToken: eventToken,
    });
    if (!eventGate.ok) return { ok: false as const, error: eventGate.error };

    const eventType = String(header.event_type ?? b.type ?? "");
    if (eventType && eventType !== "im.message.receive_v1") {
      return { ok: false as const, error: `忽略事件类型 ${eventType || "(empty)"}` };
    }

    const event = (b.event ?? {}) as Record<string, unknown>;
    const message = (event.message ?? {}) as Record<string, unknown>;
    const sender = (event.sender ?? {}) as Record<string, unknown>;
    const senderId = (sender.sender_id ?? {}) as Record<string, unknown>;

    const openId = String(senderId.open_id ?? sender.open_id ?? "").trim();
    const chatId = String(message.chat_id ?? "").trim();
    const messageId = String(message.message_id ?? header.event_id ?? randomUUID()).trim();
    const chatType = String(message.chat_type ?? "p2p");
    const msgType = String(message.message_type ?? "text");

    if (msgType !== "text") {
      return { ok: false as const, error: `暂只支持 text，收到 ${msgType}` };
    }

    let text = "";
    try {
      const contentRaw = message.content;
      const content =
        typeof contentRaw === "string"
          ? (JSON.parse(contentRaw) as { text?: string })
          : ((contentRaw as { text?: string }) ?? {});
      text = String(content.text ?? "");
    } catch {
      text = String(message.content ?? "");
    }

    const mentions = message.mentions as Array<{ key?: string; name?: string }> | undefined;
    text = stripMentions(text, mentions);

    // 群聊：要求被 @ 才响应（有 mentions 或原文含 @）
    if (chatType === "group" && (!mentions || mentions.length === 0)) {
      // 若飞书未带 mentions，仍允许白名单用户的纯文本（私聊等价）
      if (!cfg.allowedOpenIds.length) {
        return { ok: false as const, error: "群聊未 @ 机器人，忽略" };
      }
    }

    if (!openId || !chatId || !text) {
      return { ok: false as const, error: "缺 open_id/chat_id/text" };
    }

    ingestText({ openId, chatId, text, messageId, chatType });
    return { ok: true as const };
  };

  const adapter: ChannelAdapter & {
    ingestWebhookPayload: typeof ingestWebhookPayload;
  } = {
    channel: "feishu",
    name: "feishu-bot",
    enabled: cfg.enabled,
    getStatus: () => ({ state, lastError }),
    start: async () => {
      state = cfg.enabled ? "connected" : "disconnected";
      lastError = undefined;
      if (cfg.enabled) {
        console.log("[feishu-bot] 已启用（webhook 模式，等待 /api/webhooks/feishu）");
      }
    },
    stop: async () => {
      state = "disconnected";
      replyCtx.clear();
    },
    reply: async (msg, chunk: ChannelReplyChunk) => {
      if (!chunk.finish && !chunk.text.trim()) return;
      // 流式中间片可跳过；终稿必发。若只有中间片带文本也合并策略：终稿时发全文
      if (!chunk.finish) return;
      const text = chunk.text.trim();
      if (!text) return;
      const ctx = replyCtx.get(msg.meta.eventId);
      const config = getConfig();
      try {
        if (ctx?.messageId) {
          await feishuReplyText(ctx.messageId, text, config);
        } else if (msg.envelope.chatId) {
          const idType = msg.envelope.chatId.startsWith("oc_") ? "chat_id" : "open_id";
          const receiveId =
            idType === "open_id" ? msg.envelope.peerId : msg.envelope.chatId;
          await feishuSendText(receiveId, idType === "chat_id" ? "chat_id" : "open_id", text, config);
        } else {
          await feishuSendText(msg.envelope.peerId, "open_id", text, config);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn("[feishu-bot] 回帖失败:", lastError);
        throw err;
      } finally {
        if (chunk.finish) replyCtx.delete(msg.meta.eventId);
      }
    },
    ingestWebhookPayload,
  };

  return adapter;
}

type FeishuIngestResult =
  | { ok: true; challenge?: string }
  | { ok: false; error: string; challenge?: string };

export function getFeishuAdapterIngest(
  adapter: ChannelAdapter,
): ((body: unknown) => FeishuIngestResult) | null {
  const a = adapter as ChannelAdapter & {
    ingestWebhookPayload?: (body: unknown) => FeishuIngestResult;
  };
  return a.ingestWebhookPayload ?? null;
}
