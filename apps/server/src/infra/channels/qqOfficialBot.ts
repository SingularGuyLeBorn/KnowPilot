/**
 * QQ 开放平台官方 Bot（Access Token + HTTP 发消息；事件可 WebSocket 或 webhook）。
 * 文档：https://bot.q.qq.com/wiki/
 *
 * MVP：配置齐全后拉取 token；入站优先走 POST /api/webhooks/qq（公网/隧道）；
 * 若设 QQ_BOT_WS=1 则尝试官方网关长连接（沙箱调试）。
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type {
  ChannelAdapter,
  ChannelReplyChunk,
  UnifiedMessage,
} from "../messageGateway.js";
import { handleIncomingMessage } from "../messageGateway.js";

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";

export type QqBotConfig = {
  appId: string;
  secret: string;
  enabled: boolean;
  allowedOpenIds: string[];
  useWs: boolean;
};

type TokenState = { accessToken: string; expiresAt: number };

export function createQqOfficialBotAdapter(cfg: QqBotConfig): ChannelAdapter {
  let token: TokenState | null = null;
  let ws: WebSocket | null = null;
  let stopped = true;
  let state = "disconnected";
  let lastError: string | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const replyCtx = new Map<string, { openid: string; msgId: string; isGroup: boolean; groupOpenid?: string }>();

  const ensureToken = async (): Promise<string> => {
    if (token && Date.now() < token.expiresAt - 60_000) return token.accessToken;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: cfg.appId, clientSecret: cfg.secret }),
    });
    if (!res.ok) throw new Error(`QQ token HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number; message?: string };
    if (!json.access_token) throw new Error(json.message || "QQ token 无 access_token");
    token = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
    };
    return token.accessToken;
  };

  const ingestText = (opts: {
    openid: string;
    text: string;
    msgId: string;
    groupOpenid?: string;
  }) => {
    if (cfg.allowedOpenIds.length && !cfg.allowedOpenIds.includes(opts.openid)) {
      console.warn(`[qq] 拒绝非白名单 ${opts.openid}`);
      return;
    }
    const text = opts.text.trim();
    if (!text) return;
    const msg: UnifiedMessage = {
      envelope: {
        channel: "qq",
        peerId: opts.openid,
        chatId: opts.groupOpenid,
        timestamp: new Date().toISOString(),
      },
      payload: { text },
      meta: { eventId: opts.msgId, replyTo: opts.msgId },
    };
    replyCtx.set(opts.msgId, {
      openid: opts.openid,
      msgId: opts.msgId,
      isGroup: Boolean(opts.groupOpenid),
      groupOpenid: opts.groupOpenid,
    });
    void handleIncomingMessage(msg).then((r) => {
      if (!r.ok) console.warn(`[qq] 入站失败: ${r.error}`);
    });
  };

  /** 供 Express webhook 调用 */
  const ingestWebhookPayload = (body: unknown) => {
    const b = body as Record<string, unknown>;
    // QQ 回调可能包在 d 字段（WS 同构）或扁平
    const d = (b.d ?? b) as Record<string, unknown>;
    const author = (d.author ?? {}) as { id?: string; user_openid?: string; member_openid?: string };
    const openid = String(
      author.user_openid || author.member_openid || author.id || d.author_openid || "",
    ).trim();
    const content = String(d.content ?? "").replace(/<@!\d+>/g, "").trim();
    const msgId = String(d.id ?? d.msg_id ?? randomUUID());
    const groupOpenid = String(d.group_openid || d.group_id || "").trim() || undefined;
    if (!openid || !content) return { ok: false as const, error: "缺 openid/content" };
    ingestText({ openid, text: content, msgId, groupOpenid });
    return { ok: true as const };
  };

  const startWs = async () => {
    const accessToken = await ensureToken();
    const gatewayRes = await fetch(`${API_BASE}/gateway`, {
      headers: { Authorization: `QQBot ${accessToken}` },
    });
    if (!gatewayRes.ok) throw new Error(`QQ gateway HTTP ${gatewayRes.status}`);
    const gw = (await gatewayRes.json()) as { url?: string };
    if (!gw.url) throw new Error("QQ gateway 无 url");
    state = "connecting";
    await new Promise<void>((resolve, reject) => {
      ws = new WebSocket(gw.url!);
      ws.on("open", () => {
        state = "connected";
        resolve();
      });
      ws.on("message", (data) => {
        try {
          const frame = JSON.parse(String(data)) as { op?: number; t?: string; d?: Record<string, unknown> };
          if (frame.op === 10) {
            // Hello → Identify（简化：公域机器人 intents 需按开放平台勾选）
            ws?.send(
              JSON.stringify({
                op: 2,
                d: {
                  token: `QQBot ${accessToken}`,
                  intents: 0,
                  shard: [0, 1],
                },
              }),
            );
          } else if (frame.t === "C2C_MESSAGE_CREATE" || frame.t === "GROUP_AT_MESSAGE_CREATE") {
            ingestWebhookPayload({ d: frame.d });
          }
        } catch {
          /* ignore */
        }
      });
      ws.on("close", () => {
        state = "disconnected";
        ws = null;
        if (!stopped && cfg.useWs) {
          reconnectTimer = setTimeout(() => {
            void startWs().catch((e) => {
              lastError = e instanceof Error ? e.message : String(e);
            });
          }, 5_000);
        }
      });
      ws.on("error", (err) => {
        lastError = err.message;
        state = "error";
        reject(err);
      });
    });
  };

  const adapter: ChannelAdapter & { ingestWebhookPayload: typeof ingestWebhookPayload } = {
    channel: "qq",
    name: "QQ 官方机器人",
    enabled: cfg.enabled,
    getStatus: () => ({
      state: cfg.enabled ? state : "disconnected",
      detail: cfg.enabled
        ? `app=${cfg.appId.slice(0, 6)}… · ${cfg.useWs ? "ws" : "webhook"}`
        : "未配置",
      lastError,
    }),
    start: async () => {
      if (!cfg.enabled) return;
      stopped = false;
      await ensureToken();
      state = cfg.useWs ? "connecting" : "connected";
      if (cfg.useWs) await startWs();
      else lastError = undefined;
    },
    stop: async () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
      state = "disconnected";
    },
    reply: async (msg, chunk: ChannelReplyChunk) => {
      if (!chunk.finish && chunk.text.length < 80) return; // 非终稿且过短跳过，减少刷屏
      const accessToken = await ensureToken();
      const ctx = replyCtx.get(msg.meta.eventId) ?? {
        openid: msg.envelope.peerId,
        msgId: msg.meta.eventId,
        isGroup: Boolean(msg.envelope.chatId),
        groupOpenid: msg.envelope.chatId,
      };
      const content = chunk.text.slice(0, 4000) || "（空回复）";
      const path = ctx.isGroup && ctx.groupOpenid
        ? `/v2/groups/${encodeURIComponent(ctx.groupOpenid)}/messages`
        : `/v2/users/${encodeURIComponent(ctx.openid)}/messages`;
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          Authorization: `QQBot ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          msg_type: 0,
          msg_id: ctx.msgId,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`QQ 发消息 HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      if (chunk.finish) replyCtx.delete(msg.meta.eventId);
    },
    ingestWebhookPayload,
  };

  return adapter;
}

export function loadQqBotConfigFromEnv(): QqBotConfig {
  const appId = (process.env.QQ_BOT_APP_ID || "").trim();
  const secret = (process.env.QQ_BOT_SECRET || "").trim();
  const allowed = (process.env.QQ_BOT_ALLOWED_OPENIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const yamlOff = process.env.QQ_BOT_ENABLED === "false";
  return {
    appId,
    secret,
    enabled: Boolean(appId && secret) && !yamlOff,
    allowedOpenIds: allowed,
    useWs: process.env.QQ_BOT_WS === "1" || process.env.QQ_BOT_WS === "true",
  };
}

export function getQqAdapterIngest(
  adapter: ChannelAdapter,
): ((body: unknown) => { ok: boolean; error?: string }) | null {
  const a = adapter as ChannelAdapter & {
    ingestWebhookPayload?: (body: unknown) => { ok: boolean; error?: string };
  };
  return a.ingestWebhookPayload ?? null;
}
