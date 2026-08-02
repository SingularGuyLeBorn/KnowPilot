/**
 * OneBot v11 通用 IM Adapter（适用于 NapCatQQ / LLOneBot / Go-CQHttp 等成熟 QQ 框架）。
 * 协议规范：https://github.com/botuniverse/onebot-11
 *
 * 功能：
 * - 接收 HTTP 反向 Webhook 入站消息 (/api/webhooks/onebot)
 * - 支持私聊 (private) 与群聊 (group @Bot)
 * - 剥离 CQ 码与 @ 占位，自动清洗文本
 * - 通过 OneBot HTTP API (/send_msg, /send_private_msg, /send_group_msg) 回发 Agent 响应
 */

import crypto from "node:crypto";
import type {
  ChannelAdapter,
  ChannelReplyChunk,
  UnifiedMessage,
} from "../messageGateway.js";
import { handleIncomingMessage } from "../messageGateway.js";

export type OneBotConfig = {
  httpUrl: string;
  accessToken: string;
  secret: string;
  enabled: boolean;
  allowedUsers: string[];
};

export function createOneBotAdapter(cfg: OneBotConfig): ChannelAdapter {
  let state = "disconnected";
  let lastError: string | undefined;
  const replyCtx = new Map<
    string,
    { userId: string; groupId?: string; isGroup: boolean; msgId: string }
  >();

  const ingestText = (opts: {
    userId: string;
    text: string;
    msgId: string;
    groupId?: string;
  }) => {
    if (cfg.allowedUsers.length && !cfg.allowedUsers.includes(opts.userId)) {
      console.warn(`[onebot] 拒绝非白名单用户 QQ: ${opts.userId}`);
      return;
    }
    const text = opts.text.trim();
    if (!text) return;

    const msg: UnifiedMessage = {
      envelope: {
        channel: "onebot",
        peerId: opts.userId,
        chatId: opts.groupId,
        timestamp: new Date().toISOString(),
      },
      payload: { text },
      meta: { eventId: opts.msgId, replyTo: opts.msgId },
    };

    replyCtx.set(opts.msgId, {
      userId: opts.userId,
      groupId: opts.groupId,
      isGroup: Boolean(opts.groupId),
      msgId: opts.msgId,
    });

    handleIncomingMessage(msg)
      .then((r) => {
        if (!r.ok) console.warn(`[onebot] 入站失败: ${r.error}`);
      })
      .catch((err) => {
        console.warn(`[onebot] 入站异常:`, err instanceof Error ? err.message : err);
      });
  };

  /** 校验 X-Signature (SHA1 HMAC) Signature */
  const verifySignature = (rawBody: Buffer | string, signatureHeader: string): boolean => {
    if (!cfg.secret) return true;
    if (!signatureHeader) return false;
    const expectedSig = "sha1=" + crypto.createHmac("sha1", cfg.secret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSig));
  };

  /** 供 Express webhook 调用 */
  const ingestWebhookPayload = (body: unknown, rawBody?: Buffer | string, signatureHeader?: string) => {
    if (cfg.secret && rawBody && signatureHeader) {
      if (!verifySignature(rawBody, signatureHeader)) {
        return { ok: false as const, error: "OneBot 签名校验失败 (X-Signature)" };
      }
    }

    const b = body as Record<string, unknown>;
    const postType = String(b.post_type ?? "");
    if (postType !== "message") {
      // 忽略 notice, meta_event (如 heartbeat)
      return { ok: true as const, ignored: true };
    }

    const messageType = String(b.message_type ?? "");
    const userId = String(b.user_id ?? "").trim();
    const groupId = b.group_id ? String(b.group_id).trim() : undefined;
    const msgId = String(b.message_id ?? crypto.randomUUID());
    
    // 文本清洗：去除 CQ 码与 @ 占位符
    let rawText = String(b.raw_message ?? b.message ?? "");
    // 去除 [CQ:at,qq=...]
    rawText = rawText.replace(/\[CQ:at,qq=[^\]]+\]/g, "").trim();
    // 去除 CQ 码占位符
    rawText = rawText.replace(/\[CQ:[^\]]+\]/g, "").trim();

    if (!userId || !rawText) {
      return { ok: false as const, error: "缺少 user_id 或有效文本内容" };
    }

    ingestText({
      userId,
      text: rawText,
      msgId,
      groupId: messageType === "group" ? groupId : undefined,
    });

    return { ok: true as const };
  };

  const sendOneBotApi = async (endpoint: string, payload: Record<string, unknown>) => {
    if (!cfg.httpUrl) throw new Error("OneBot HTTP URL 未配置");
    const baseUrl = cfg.httpUrl.endsWith("/") ? cfg.httpUrl.slice(0, -1) : cfg.httpUrl;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.accessToken) {
      headers["Authorization"] = `Bearer ${cfg.accessToken}`;
    }

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OneBot API ${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    return await res.json().catch(() => ({}));
  };

  const adapter: ChannelAdapter & {
    ingestWebhookPayload: typeof ingestWebhookPayload;
    sendOneBotApi: typeof sendOneBotApi;
  } = {
    channel: "onebot",
    name: "OneBot v11 (NapCatQQ / LLOneBot)",
    enabled: cfg.enabled,
    getStatus: () => ({
      state: cfg.enabled ? state : "disconnected",
      detail: cfg.enabled ? `url=${cfg.httpUrl}` : "未配置",
      lastError,
    }),
    start: async () => {
      if (!cfg.enabled) return;
      state = "connected";
      lastError = undefined;
    },
    stop: async () => {
      state = "disconnected";
    },
    reply: async (msg, chunk: ChannelReplyChunk) => {
      if (!chunk.finish && chunk.text.length < 80) return; // 避免分片过多刷屏
      const ctx = replyCtx.get(msg.meta.eventId) ?? {
        userId: msg.envelope.peerId,
        groupId: msg.envelope.chatId,
        isGroup: Boolean(msg.envelope.chatId),
        msgId: msg.meta.eventId,
      };

      const content = chunk.text.slice(0, 4000) || "（空回复）";

      if (ctx.isGroup && ctx.groupId) {
        await sendOneBotApi("/send_group_msg", {
          group_id: Number(ctx.groupId) || ctx.groupId,
          message: [
            { type: "reply", data: { id: ctx.msgId } },
            { type: "text", data: { text: content } },
          ],
        }).catch(async () => {
          // 备用降级：发纯文本
          await sendOneBotApi("/send_group_msg", {
            group_id: Number(ctx.groupId) || ctx.groupId,
            message: content,
          });
        });
      } else {
        await sendOneBotApi("/send_private_msg", {
          user_id: Number(ctx.userId) || ctx.userId,
          message: content,
        });
      }

      if (chunk.finish) replyCtx.delete(msg.meta.eventId);
    },
    ingestWebhookPayload,
    sendOneBotApi,
  };

  return adapter;
}

export function loadOneBotConfigFromEnv(): OneBotConfig {
  const httpUrl = (process.env.ONEBOT_HTTP_URL || "").trim();
  const accessToken = (process.env.ONEBOT_ACCESS_TOKEN || "").trim();
  const secret = (process.env.ONEBOT_SECRET || "").trim();
  const allowed = (process.env.ONEBOT_ALLOWED_USERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const enabled =
    process.env.ONEBOT_ENABLED === "true" ||
    Boolean(httpUrl) ||
    Boolean(secret);

  return {
    httpUrl: httpUrl || "http://127.0.0.1:3000",
    accessToken,
    secret,
    enabled,
    allowedUsers: allowed,
  };
}

export function getOneBotAdapterIngest(
  adapter: ChannelAdapter,
): ((body: unknown, rawBody?: Buffer | string, signature?: string) => { ok: boolean; error?: string }) | null {
  const a = adapter as ChannelAdapter & {
    ingestWebhookPayload?: (
      body: unknown,
      rawBody?: Buffer | string,
      signature?: string,
    ) => { ok: boolean; error?: string };
  };
  return a.ingestWebhookPayload ?? null;
}
