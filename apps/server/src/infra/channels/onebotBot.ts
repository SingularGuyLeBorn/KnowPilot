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
import fs from "node:fs";
import path from "node:path";
import type {
  ChannelAdapter,
  ChannelReplyChunk,
  UnifiedMessage,
} from "../messageGateway.js";
import { handleIncomingMessage } from "../messageGateway.js";

async function saveOneBotImageLocally(url: string): Promise<string | null> {
  if (!url || !url.startsWith("http")) {
    console.log(`[onebot] 跳过非 HTTP 图片 URL: ${url}`);
    return null;
  }
  try {
    console.log(`[onebot] 正在下载图片: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[onebot] 下载图片失败 HTTP ${res.status}: ${url}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd().includes("apps") ? path.join(process.cwd(), "../..") : process.cwd());
    const uploadsDir = path.resolve(projectRoot, "content/uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = `qq-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, buffer);
    console.log(`✅ [onebot] 图片已转存至本地: /uploads/${filename}`);

    return `/uploads/${filename}`;
  } catch (err) {
    console.warn(`[onebot] 图片下载保存异常 (${url}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

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
    
    // 异步解析消息中的文本、图片 (CQ 码 / Segment 数组)
    (async () => {
      let textParts: string[] = [];
      let imageUrlsToDownload: string[] = [];

      if (Array.isArray(b.message)) {
        for (const seg of b.message as any[]) {
          if (seg.type === "text") {
            if (seg.data?.text) textParts.push(seg.data.text);
          } else if (seg.type === "image") {
            const imgUrl = seg.data?.url || (seg.data?.file?.startsWith("http") ? seg.data.file : "");
            if (imgUrl) imageUrlsToDownload.push(imgUrl);
          }
        }
      } else if (typeof b.raw_message === "string" && b.raw_message) {
        let raw = b.raw_message;

        // 提取 CQ:image 中的 url
        const cqImgRegex = /\[CQ:image,[^\]]*url=([^,\]]+)/g;
        let match: RegExpExecArray | null;
        while ((match = cqImgRegex.exec(raw)) !== null) {
          if (match[1]) imageUrlsToDownload.push(match[1]);
        }

        // 清洗 CQ 码
        raw = raw.replace(/\[CQ:at,qq=[^\]]+\]/g, "").trim();
        raw = raw.replace(/\[CQ:[^\]]+\]/g, "").trim();
        if (raw) textParts.push(raw);
      }

      // 下载并保存本地图片
      const localImageMarkdownList: string[] = [];
      for (const imgUrl of imageUrlsToDownload) {
        const localPath = await saveOneBotImageLocally(imgUrl);
        if (localPath) {
          localImageMarkdownList.push(`![QQ图片](${localPath})`);
        }
      }

      let combinedText = textParts.join("\n").trim();
      if (localImageMarkdownList.length > 0) {
        combinedText = combinedText
          ? `${combinedText}\n\n${localImageMarkdownList.join("\n")}`
          : localImageMarkdownList.join("\n");
      }

      if (!userId || !combinedText) {
        console.warn("[onebot] 缺少 user_id 或有效内容/图片，跳过处理");
        return;
      }

      ingestText({
        userId,
        text: combinedText,
        msgId,
        groupId: messageType === "group" ? groupId : undefined,
      });
    })().catch((err) => {
      console.error("[onebot] 异步解析 Webhook 消息失败:", err);
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
  const enabled = process.env.ONEBOT_ENABLED !== "false";

  return {
    httpUrl: httpUrl || "http://127.0.0.1:3001",
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
