/**
 * Webhook 验签叶子：QQ 官方 Bot Ed25519 + 飞书 verification token 硬校验。
 * 无 prisma / Express 依赖，便于单测。
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";

/** Ed25519 PKCS8：版本 + OID + 32 字节 seed 前缀（RFC 8410） */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** QQ：Bot Secret 重复拼接至 ≥32 字节后截断为 seed（与官方 Go 示例一致） */
export function qqEd25519SeedFromSecret(botSecret: string): Buffer {
  let seed = botSecret;
  while (Buffer.byteLength(seed, "utf8") < 32) {
    seed = seed + seed;
  }
  return Buffer.from(seed, "utf8").subarray(0, 32);
}

export function qqEd25519PrivateKeyFromSecret(botSecret: string): KeyObject {
  const seed = qqEd25519SeedFromSecret(botSecret);
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export function qqEd25519PublicKeyFromSecret(botSecret: string): KeyObject {
  return createPublicKey(qqEd25519PrivateKeyFromSecret(botSecret));
}

/**
 * 校验事件推送：msg = timestamp + rawBody；signature 为 hex。
 * 缺头 / 非法 hex / 验签失败 → false。
 */
export function verifyQqEventSignature(opts: {
  botSecret: string;
  signatureHex: string | undefined;
  timestamp: string | undefined;
  rawBody: string | Buffer;
}): boolean {
  const { botSecret, signatureHex, timestamp, rawBody } = opts;
  if (!botSecret || !signatureHex || !timestamp) return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  // 官方文档：末字节高 3 bit 须为 0
  if ((sig[63]! & 0xe0) !== 0) return false;
  const msg = Buffer.concat([
    Buffer.from(String(timestamp), "utf8"),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8"),
  ]);
  try {
    return cryptoVerify(
      null,
      msg,
      qqEd25519PublicKeyFromSecret(botSecret),
      sig,
    );
  } catch {
    return false;
  }
}

/** op=13 URL 验证：对 event_ts + plain_token 私钥签名，返回 hex */
export function signQqUrlValidation(opts: {
  botSecret: string;
  eventTs: string;
  plainToken: string;
}): string {
  const msg = Buffer.from(`${opts.eventTs}${opts.plainToken}`, "utf8");
  const sig = cryptoSign(null, msg, qqEd25519PrivateKeyFromSecret(opts.botSecret));
  return sig.toString("hex");
}

export type QqWebhookGateResult =
  | { kind: "challenge"; plain_token: string; signature: string }
  | { kind: "ok" }
  | { kind: "reject"; status: number; error: string };

/**
 * QQ webhook 门禁：先处理 op=13 challenge，再验签事件。
 * body 已 parse；rawBody 用于验签（缺 rawBody 时拒绝对事件）。
 */
export function gateQqWebhook(opts: {
  botSecret: string;
  body: unknown;
  rawBody: string | Buffer | undefined;
  signatureHex: string | undefined;
  timestamp: string | undefined;
}): QqWebhookGateResult {
  const { botSecret, body, rawBody, signatureHex, timestamp } = opts;
  if (!botSecret.trim()) {
    return { kind: "reject", status: 503, error: "QQ_BOT_SECRET 未配置" };
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const op = Number(b.op);
  if (op === 13) {
    const d = (b.d ?? {}) as Record<string, unknown>;
    const plainToken = String(d.plain_token ?? "");
    const eventTs = String(d.event_ts ?? "");
    if (!plainToken || !eventTs) {
      return { kind: "reject", status: 400, error: "op=13 缺 plain_token/event_ts" };
    }
    const signature = signQqUrlValidation({ botSecret, eventTs, plainToken });
    return { kind: "challenge", plain_token: plainToken, signature };
  }
  if (rawBody === undefined || rawBody === null || rawBody === "") {
    return { kind: "reject", status: 401, error: "缺 rawBody，无法验签" };
  }
  if (
    !verifyQqEventSignature({
      botSecret,
      signatureHex,
      timestamp,
      rawBody,
    })
  ) {
    return { kind: "reject", status: 401, error: "QQ Ed25519 验签失败" };
  }
  return { kind: "ok" };
}

/**
 * 飞书：verification token 已配置时必须匹配；未配置则硬拒（禁止裸 webhook）。
 */
export function gateFeishuVerificationToken(opts: {
  configuredToken: string;
  incomingToken: string;
}): { ok: true } | { ok: false; error: string } {
  const configured = opts.configuredToken.trim();
  if (!configured) {
    return {
      ok: false,
      error: "FEISHU_BOT_VERIFICATION_TOKEN 未配置，拒绝 webhook（防伪造事件）",
    };
  }
  if (!opts.incomingToken.trim()) {
    return { ok: false, error: "请求缺 verification token" };
  }
  if (opts.incomingToken !== configured) {
    return { ok: false, error: "verification token 不匹配" };
  }
  return { ok: true };
}
