/**
 * 企业微信智能机器人 — WebSocket 长连接（官方 aibot_* 协议）。
 * 文档：https://developer.work.weixin.qq.com/document/path/101463
 *
 * 未配置 WECOM_AIBOT_ID / WECOM_AIBOT_SECRET 时 enabled=false。
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type {
  ChannelAdapter,
  ChannelReplyChunk,
  UnifiedMessage,
} from "../messageGateway.js";
import { handleIncomingMessage } from "../messageGateway.js";

const WS_URL = "wss://openws.work.weixin.qq.com";
const PING_MS = 30_000;

export type WecomAibotConfig = {
  botId: string;
  secret: string;
  enabled: boolean;
  /** 允许的 userid 白名单；空 = 全部 */
  allowedUserIds: string[];
};

type Frame = {
  cmd?: string;
  headers?: { req_id?: string };
  body?: Record<string, unknown>;
  errcode?: number;
  errmsg?: string;
};

export function createWecomAibotAdapter(cfg: WecomAibotConfig): ChannelAdapter {
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let state = "disconnected";
  let lastError: string | undefined;
  /** msgid → 原始 UnifiedMessage（回发需 req_id） */
  const pendingByEvent = new Map<string, UnifiedMessage>();

  const sendJson = (obj: unknown) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (stopped || !cfg.enabled) return;
    clearTimers();
    reconnectTimer = setTimeout(() => {
      void startInternal();
    }, 5_000);
  };

  const handleFrame = (raw: string) => {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }
    if (frame.cmd === "aibot_msg_callback") {
      const body = frame.body ?? {};
      const msgid = String(body.msgid ?? randomUUID());
      const from = (body.from ?? {}) as { userid?: string };
      const userid = String(from.userid ?? "").trim();
      if (!userid) return;
      if (cfg.allowedUserIds.length && !cfg.allowedUserIds.includes(userid)) {
        console.warn(`[wecom] 拒绝非白名单用户 ${userid}`);
        return;
      }
      const chattype = String(body.chattype ?? "single");
      const chatid = chattype === "group" ? String(body.chatid ?? "") : "";
      const textObj = (body.text ?? {}) as { content?: string };
      let text = String(textObj.content ?? "").trim();
      // 去掉 @机器人 前缀
      text = text.replace(/^@\S+\s*/, "").trim();
      if (!text) return;
      const reqId = frame.headers?.req_id ?? msgid;
      const msg: UnifiedMessage = {
        envelope: {
          channel: "wecom",
          peerId: userid,
          chatId: chatid || undefined,
          timestamp: new Date().toISOString(),
        },
        payload: { text },
        meta: { eventId: msgid, replyTo: reqId, raw: body },
      };
      pendingByEvent.set(msgid, msg);
      void handleIncomingMessage(msg).then((r) => {
        if (!r.ok) console.warn(`[wecom] 入站失败: ${r.error}`);
      });
      return;
    }
    if (typeof frame.errcode === "number" && frame.errcode !== 0) {
      lastError = frame.errmsg || `errcode=${frame.errcode}`;
      console.warn(`[wecom] 帧错误: ${lastError}`);
    }
  };

  const startInternal = async () => {
    if (!cfg.enabled) return;
    stopped = false;
    state = "connecting";
    lastError = undefined;
    clearTimers();
    await new Promise<void>((resolve, reject) => {
      try {
        ws = new WebSocket(WS_URL);
      } catch (err) {
        state = "error";
        lastError = err instanceof Error ? err.message : String(err);
        reject(err);
        return;
      }
      ws.on("open", () => {
        sendJson({
          cmd: "aibot_subscribe",
          headers: { req_id: randomUUID() },
          body: { botid: cfg.botId, secret: cfg.secret },
        });
        state = "connected";
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            try {
              ws.ping();
            } catch {
              /* ignore */
            }
          }
        }, PING_MS);
        resolve();
      });
      ws.on("message", (data) => handleFrame(String(data)));
      ws.on("close", () => {
        state = "disconnected";
        clearTimers();
        ws = null;
        scheduleReconnect();
      });
      ws.on("error", (err) => {
        lastError = err.message;
        state = "error";
      });
    });
  };

  return {
    channel: "wecom",
    name: "企业微信智能机器人",
    enabled: cfg.enabled,
    getStatus: () => ({ state, detail: cfg.enabled ? `bot=${cfg.botId.slice(0, 6)}…` : "未配置", lastError }),
    start: () => startInternal(),
    stop: async () => {
      stopped = true;
      clearTimers();
      ws?.close();
      ws = null;
      state = "disconnected";
    },
    reply: async (msg, chunk: ChannelReplyChunk) => {
      const reqId = msg.meta.replyTo || msg.meta.eventId;
      const streamId = chunk.streamId || msg.meta.eventId;
      sendJson({
        cmd: "aibot_respond_msg",
        headers: { req_id: reqId },
        body: {
          msgtype: "stream",
          stream: {
            id: streamId,
            finish: chunk.finish,
            content: chunk.text.slice(0, 4000),
          },
        },
      });
      if (chunk.finish) pendingByEvent.delete(msg.meta.eventId);
    },
  };
}

export function loadWecomAibotConfigFromEnv(): WecomAibotConfig {
  const botId = (process.env.WECOM_AIBOT_ID || "").trim();
  const secret = (process.env.WECOM_AIBOT_SECRET || "").trim();
  const allowed = (process.env.WECOM_AIBOT_ALLOWED_USERIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const yamlOff = process.env.WECOM_AIBOT_ENABLED === "false";
  return {
    botId,
    secret,
    enabled: Boolean(botId && secret) && !yamlOff,
    allowedUserIds: allowed,
  };
}
