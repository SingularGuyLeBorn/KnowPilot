/**
 * OneBot v11 通用 IM Adapter（适用于 NapCatQQ / LLOneBot / Go-CQHttp 等成熟 QQ 框架）。
 * 协议规范：https://github.com/botuniverse/onebot-11
 *
 * 功能：
 * - 接收 HTTP 反向 Webhook 入站消息 (/api/webhooks/onebot)
 * - 支持私聊 (private) 与群聊 (group @Bot)
 * - 剥离 CQ 码与 @ 占位，自动清洗文本
 * - 通过 OneBot HTTP API (/send_msg, /send_private_msg, /send_group_msg) 回发 Agent 响应
 * - 安全：可绑定指定 QQ 账号（self_id 校验）、用户白名单、群聊白名单、消息类型过滤、@ 才响应
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

/** 把项目内相对路径（如 /uploads/xxx.png）转成绝对路径，供 OneBot 本地文件发送 */
function resolveOneBotFilePath(input: string): string {
  if (!input || typeof input !== "string") return "";
  if (/^https?:\/\//i.test(input)) return input;
  const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd().includes("apps") ? path.join(process.cwd(), "../..") : process.cwd());
  let rel = input;
  if (rel.startsWith("/")) rel = rel.slice(1);
  return path.resolve(projectRoot, rel).replace(/\\/g, "/");
}

/** 从 Markdown/文本中提取要发送的图片 URL/路径 */
function extractImageUrlsFromMarkdown(text: string): string[] {
  const urls: string[] = [];
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) urls.push(match[1]);
  }
  return urls;
}

/** 从文本中移除 Markdown 图片语法，保留 alt 文本作为纯文本提示 */
function stripMarkdownImages(text: string): string {
  return text.replace(/!\[([^\]]*)\]\([^)]+\)/g, (__, alt) => (alt ? `[图片：${alt}]` : ""));
}

export type OneBotMediaType = "image" | "video";

export type OneBotMediaPayload = {
  userId?: string | number;
  groupId?: string | number;
  file: string;
  caption?: string;
  type: OneBotMediaType;
};

export type OneBotMessageType = "text" | "image" | "at" | "reply" | "file" | "other";

export type OneBotConfig = {
  httpUrl: string;
  accessToken: string;
  secret: string;
  enabled: boolean;
  allowedUsers: string[];
  /** 指定本 Bot 的 QQ 账号；收到 self_id 不匹配的消息会忽略 */
  qqAccount?: string;
  /** 群聊白名单；空=拒绝所有群；*=允许所有群 */
  allowedGroups: string[];
  /** 群内允许的消息类型；默认 text */
  groupMessageTypes: OneBotMessageType[];
  /** 群内是否需要 @ 本 Bot 才响应；默认 true */
  groupRequireAt: boolean;
};

/** 从 message / raw_message 中提取文本、图片、以及用于过滤的元信息 */
function parseOneBotMessage(body: Record<string, unknown>): {
  textParts: string[];
  imageUrls: string[];
  types: Set<OneBotMessageType>;
  atSelf: boolean;
} {
  const textParts: string[] = [];
  const imageUrls: string[] = [];
  const types = new Set<OneBotMessageType>();
  let atSelf = false;
  const selfId = String(body.self_id ?? "");

  if (Array.isArray(body.message)) {
    for (const seg of body.message as any[]) {
      const type = String(seg.type ?? "");
      if (type === "text") {
        types.add("text");
        if (seg.data?.text) textParts.push(seg.data.text);
      } else if (type === "image") {
        types.add("image");
        const imgUrl = seg.data?.url || (seg.data?.file?.startsWith("http") ? seg.data.file : "");
        if (imgUrl) imageUrls.push(imgUrl);
      } else if (type === "at") {
        types.add("at");
        if (selfId && String(seg.data?.qq ?? "") === selfId) atSelf = true;
      } else if (type === "reply") {
        types.add("reply");
      } else if (type === "file") {
        types.add("file");
      } else {
        types.add("other");
      }
    }
  } else if (typeof body.raw_message === "string" && body.raw_message) {
    let raw = body.raw_message;

    // 提取 CQ:image 中的 url
    const cqImgRegex = /\[CQ:image,[^\]]*url=([^,\]]+)/g;
    let match: RegExpExecArray | null;
    while ((match = cqImgRegex.exec(raw)) !== null) {
      if (match[1]) imageUrls.push(match[1]);
    }

    // 检测 @ 本 Bot
    if (selfId) {
      const atRegex = new RegExp(`\\[CQ:at,qq=${selfId}\\]`);
      if (atRegex.test(raw)) atSelf = true;
    }

    // 检测消息类型
    if (/\[CQ:image,/.test(raw)) types.add("image");
    if (/\[CQ:at,/.test(raw)) types.add("at");
    if (/\[CQ:reply,/.test(raw)) types.add("reply");
    if (/\[CQ:file,/.test(raw)) types.add("file");
    if (/\[CQ:[^\]]+\]/.test(raw)) types.add("other");
    if (raw.replace(/\[CQ:[^\]]+\]/g, "").trim()) types.add("text");

    // 清洗 CQ 码
    raw = raw.replace(/\[CQ:at,qq=[^\]]+\]/g, "").trim();
    raw = raw.replace(/\[CQ:[^\]]+\]/g, "").trim();
    if (raw) textParts.push(raw);
  } else if (typeof body.message === "string" && body.message) {
    // 兜底：message 是字符串
    textParts.push(body.message);
    types.add("text");
  }

  return { textParts, imageUrls, types, atSelf };
}

export function createOneBotAdapter(cfg: OneBotConfig): ChannelAdapter {
  let state = "disconnected";
  let lastError: string | undefined;
  const openMode = cfg.allowedUsers.includes("*");
  if (openMode) {
    console.log("[onebot] 白名单模式：允许所有用户（ONEBOT_ALLOWED_USERS=*）");
  } else if (cfg.allowedUsers.length > 0) {
    console.log(`[onebot] 白名单模式：仅允许 ${cfg.allowedUsers.length} 个 QQ 号`);
  } else {
    console.log("[onebot] 白名单模式：未配置白名单，拒绝所有用户");
  }
  if (cfg.qqAccount) {
    console.log(`[onebot] 强制绑定 QQ 账号：${cfg.qqAccount}（self_id 不匹配则忽略）`);
  }
  if (cfg.allowedGroups.includes("*")) {
    console.log("[onebot] 群聊模式：允许所有群聊");
  } else if (cfg.allowedGroups.length > 0) {
    console.log(`[onebot] 群聊模式：仅允许 ${cfg.allowedGroups.length} 个群`);
  } else {
    console.log("[onebot] 群聊模式：未配置群聊白名单，拒绝所有群聊");
  }
  console.log(`[onebot] 群聊消息类型：${cfg.groupMessageTypes.join(",") || "none"}；需@：${cfg.groupRequireAt}`);

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
    const openMode = cfg.allowedUsers.includes("*");
    const allowed = openMode || cfg.allowedUsers.includes(opts.userId);
    if (!allowed) {
      console.log(`[onebot] 忽略非白名单用户 QQ: ${opts.userId}`);
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

    const selfId = String(b.self_id ?? "").trim();
    if (cfg.qqAccount && selfId !== cfg.qqAccount) {
      return {
        ok: false as const,
        error: `self_id 不匹配：收到 ${selfId || "(empty)"}，配置要求 ${cfg.qqAccount}`,
      };
    }

    const messageType = String(b.message_type ?? "");
    const userId = String(b.user_id ?? "").trim();
    const groupId = b.group_id ? String(b.group_id).trim() : undefined;
    const msgId = String(b.message_id ?? crypto.randomUUID());

    const isGroup = messageType === "group";

    if (isGroup && groupId) {
      // 群聊白名单
      const groupOpenMode = cfg.allowedGroups.includes("*");
      const groupAllowed = groupOpenMode || cfg.allowedGroups.includes(groupId);
      if (!groupAllowed) {
        console.log(`[onebot] 忽略非白名单群聊：group=${groupId}`);
        return { ok: true as const, ignored: true };
      }
    }

    // 异步解析消息中的文本、图片 (CQ 码 / Segment 数组)
    (async () => {
      const parsed = parseOneBotMessage(b);
      const { textParts, imageUrls: imageUrlsToDownload, types, atSelf } = parsed;

      // 群聊消息类型过滤 + @ 要求
      if (isGroup && groupId) {
        if (cfg.groupMessageTypes.length > 0) {
          const allowedSet = new Set(cfg.groupMessageTypes);
          // 若消息只包含 text，且 text 未在白名单，忽略；但 text 通常与 at 共存，需同时允许
          const relevantTypes = new Set([...types]);
          relevantTypes.delete("other"); // other 不纳入过滤，避免误判纯文本里夹带未知段
          const hasAllowed = [...relevantTypes].some((t) => allowedSet.has(t));
          if (!hasAllowed) {
            console.log(`[onebot] 忽略群聊消息类型：group=${groupId}, types=${[...types].join(",")}`);
            return;
          }
        }
        if (cfg.groupRequireAt && !atSelf) {
          console.log(`[onebot] 忽略群聊非 @ 消息：group=${groupId}, user=${userId}`);
          return;
        }
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
        groupId: isGroup ? groupId : undefined,
      });
    })().catch((err) => {
      console.error("[onebot] 异步解析 Webhook 消息失败:", err);
    });

    return { ok: true as const };
  };

  const adapter: ChannelAdapter & {
    ingestWebhookPayload: typeof ingestWebhookPayload;
    sendOneBotApi: (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>;
    sendImage: (payload: Omit<OneBotMediaPayload, "type">) => Promise<unknown>;
    sendVideo: (payload: Omit<OneBotMediaPayload, "type">) => Promise<unknown>;
    sendOneBotMedia: (payload: OneBotMediaPayload) => Promise<unknown>;
  } = {
    channel: "onebot",
    name: "OneBot v11 (NapCatQQ / LLOneBot)",
    enabled: cfg.enabled,
    getStatus: () => ({
      state: cfg.enabled ? state : "disconnected",
      detail: cfg.enabled ? `url=${cfg.httpUrl}${cfg.qqAccount ? ` account=${cfg.qqAccount}` : ""}` : "未配置",
      lastError,
    }),
    start: async () => {
      if (!cfg.enabled) return;
      state = "connected";
      lastError = undefined;
      if (cfg.qqAccount) {
        try {
          const info = (await adapter.sendOneBotApi("/get_login_info", {})) as {
    data?: { user_id?: string | number; self_id?: string | number };
  };
          const selfId = String(info.data?.user_id ?? info.data?.self_id ?? "");
          if (selfId && selfId !== cfg.qqAccount) {
            throw new Error(`当前登录账号 ${selfId} 与配置 ${cfg.qqAccount} 不匹配`);
          }
          if (selfId) {
            console.log(`[onebot] 登录账号校验通过：${selfId}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[onebot] 登录账号校验失败: ${msg}`);
          // 不阻断启动（QQ 可能尚未完成登录），但记录 lastError
          lastError = msg;
        }
      }
    },
    stop: async () => {
      state = "disconnected";
    },
    sendOneBotApi: async (endpoint: string, payload: Record<string, unknown>) => {
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
    },
    sendOneBotMedia: async function (payload: OneBotMediaPayload) {
      if (!cfg.enabled) throw new Error("OneBot 适配器未启用");
      const target = payload.groupId ?? payload.userId;
      if (!target) throw new Error("发送图片/视频需要指定 userId 或 groupId");
      const filePath = resolveOneBotFilePath(payload.file);
      if (!filePath) throw new Error("file 参数为空");
      const segment = { type: payload.type, data: { file: filePath } };
      if (payload.groupId) {
        return this.sendOneBotApi("/send_group_msg", {
          group_id: Number(payload.groupId) || payload.groupId,
          message: [segment],
        });
      }
      return this.sendOneBotApi("/send_private_msg", {
        user_id: Number(payload.userId) || payload.userId,
        message: [segment],
      });
    },
    sendImage: async function (payload: Omit<OneBotMediaPayload, "type">) {
      return this.sendOneBotMedia({ ...payload, type: "image" });
    },
    sendVideo: async function (payload: Omit<OneBotMediaPayload, "type">) {
      return this.sendOneBotMedia({ ...payload, type: "video" });
    },
    reply: async function (msg: UnifiedMessage, chunk: ChannelReplyChunk) {
      // 只发送最终完整回复；QQ 不适合流式分片刷屏，中间 chunk 全部忽略。
      if (!chunk.finish) return;

      const ctx = replyCtx.get(msg.meta.eventId) ?? {
        userId: msg.envelope.peerId,
        groupId: msg.envelope.chatId,
        isGroup: Boolean(msg.envelope.chatId),
        msgId: msg.meta.eventId,
      };

      const mdToPlain = (s: string): string => {
        return (
          s
            // 标题
            .replace(/^#{1,6}\s+/gm, "")
            // 粗体/斜体
            .replace(/(\*\*|__)(.+?)\1/g, "$2")
            .replace(/(\*|_)(.+?)\1/g, "$2")
            // 行内代码：保留内容，去掉反引号
            .replace(/`([^`]+)`/g, "$1")
            // 链接 [文本](url) → 文本 (url)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
            // 无序列表
            .replace(/^\s*[-*+]\s+/gm, "")
            // 有序列表 1. / 2)
            .replace(/^\s*\d+[.)]\s+/gm, "")
            // 块引用
            .replace(/^\s*>\s+/gm, "")
            // 分隔线
            .replace(/^\s*-{3,}\s*$/gm, "---")
        );
      };

      const reasoning = chunk.reasoning?.trim();
      const plainReasoning = reasoning ? mdToPlain(reasoning) : "";

      // 提取 Markdown 图片，先发送图片，再发送纯文本（避免消息过长被截断后图片发不出去）
      const imageUrls = extractImageUrlsFromMarkdown(chunk.text);
      const textWithoutImages = stripMarkdownImages(chunk.text);
      const plainAnswer = mdToPlain(textWithoutImages) || "（空回复）";

      // 预算：总长度上限 5000，thinking 最多 1500，剩余给正文
      const MAX_TOTAL = 5000;
      const MAX_REASONING = 1500;
      const reasoningPart = plainReasoning.slice(0, MAX_REASONING);
      const answerBudget = MAX_TOTAL - (reasoningPart ? reasoningPart.length + 25 : 0);
      const answerPart = plainAnswer.slice(0, Math.max(100, answerBudget));
      const content = reasoningPart
        ? `<thinking>\n${reasoningPart}\n</thinking>\n\n${answerPart}`
        : answerPart;

      const textSegments = content ? [{ type: "text", data: { text: content } }] : [];
      const imageSegments = imageUrls.map((url) => ({
        type: "image",
        data: { file: resolveOneBotFilePath(url) },
      }));

      const buildMessage = () => {
        if (imageSegments.length === 0) return content;
        return [...textSegments, ...imageSegments];
      };

      if (ctx.isGroup && ctx.groupId) {
        const message = imageSegments.length > 0
          ? [{ type: "reply", data: { id: ctx.msgId } }, ...textSegments, ...imageSegments]
          : content;
        await this.sendOneBotApi("/send_group_msg", {
          group_id: Number(ctx.groupId) || ctx.groupId,
          message,
        }).catch(async () => {
          // 备用降级：发纯文本
          await this.sendOneBotApi("/send_group_msg", {
            group_id: Number(ctx.groupId) || ctx.groupId,
            message: content,
          });
        });
      } else {
        await this.sendOneBotApi("/send_private_msg", {
          user_id: Number(ctx.userId) || ctx.userId,
          message: buildMessage(),
        });
      }

      replyCtx.delete(msg.meta.eventId);
    },
    ingestWebhookPayload,
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
  const qqAccount = (process.env.ONEBOT_QQ_ACCOUNT || "").trim();
  const allowedGroups = (process.env.ONEBOT_ALLOWED_GROUPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const groupMessageTypes = (process.env.ONEBOT_GROUP_MESSAGE_TYPES || "text")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as OneBotMessageType[];
  const groupRequireAt = (process.env.ONEBOT_GROUP_REQUIRE_AT || "true").trim().toLowerCase() !== "false";

  return {
    httpUrl: httpUrl || "http://127.0.0.1:3001",
    accessToken,
    secret,
    enabled,
    allowedUsers: allowed,
    qqAccount: qqAccount || undefined,
    allowedGroups,
    groupMessageTypes: groupMessageTypes.length > 0 ? groupMessageTypes : ["text"],
    groupRequireAt,
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
