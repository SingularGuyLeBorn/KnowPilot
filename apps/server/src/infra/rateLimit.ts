/**
 * Express 速率限制中间件（P2 安全加固）
 *
 * 设计原则：
 * - 本地单用户优先：loopback 默认跳过全局限流（Chat 一页几十个 tRPC + SSE，默认全局 3000/15min 仍可能误伤 → 前端误报「后端未连接」）。
 * - 远程暴露时兜底：防止 /chat/stream 等昂贵端点被滥用刷 LLM、防 tRPC 暴力枚举。
 * - 环境变量可调：RATE_LIMIT_ENABLED=false 整体关闭；RATE_LIMIT_SKIP_LOCALHOST=false 强制对本机也限流。
 * - AUTH_MODE=none（裸奔）时尤其需要；AUTH_MODE=password 时叠加鉴权前限流防暴力。
 *
 * 两层：
 *   1. 全局：所有路由统一阈值（默认 3000 req / 15min / IP；loopback 默认跳过）。
 *   2. SSE chat stream：昂贵端点单独收紧（默认 60 POST / min / IP；loopback 同样跳过）。
 */

import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

const enabled = process.env.RATE_LIMIT_ENABLED !== "false";
/** 默认跳过本机；远程隧道/公网暴露时设 RATE_LIMIT_SKIP_LOCALHOST=false */
const skipLocalhost = process.env.RATE_LIMIT_SKIP_LOCALHOST !== "false";

function isLoopbackIp(raw: string | undefined): boolean {
  if (!raw) return false;
  const ip = raw.replace(/^::ffff:/, "").toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

function shouldSkipGlobal(req: Request): boolean {
  if (!enabled) return true;
  if (!skipLocalhost) return false;
  const raw = req.ip || (req.socket?.remoteAddress as string | undefined);
  return isLoopbackIp(raw);
}

/** 统一 429 响应体，避免暴露内部细节 */
function jsonTooManyRequests(_req: unknown, res: { status: (code: number) => any; json: (body: unknown) => any }, _next: unknown) {
  res.status(429).json({
    error: "TOO_MANY_REQUESTS",
    message: "请求过于频繁，请稍后再试。本地开发如误触发可设 RATE_LIMIT_ENABLED=false，或确认 RATE_LIMIT_SKIP_LOCALHOST 未关。",
  });
}

const globalPer15Min = Math.max(60, parseInt(process.env.RATE_LIMIT_GLOBAL_PER_15MIN || "3000", 10));
const streamPerMin = Math.max(5, parseInt(process.env.RATE_LIMIT_STREAM_PER_MIN || "60", 10));

/** 全局限流器：覆盖所有路由（含 tRPC、静态资源、SSE）。 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: globalPer15Min,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipGlobal,
  handler: jsonTooManyRequests as unknown as Options["handler"],
});

/** Chat 昂贵 POST 限流：/api/agent/chat/stream 与 /api/agent/chat/stop（同阈值）。 */
export const chatStreamRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: streamPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  // GET 同一端点为 SSE 续传订阅，不计入「发起对话」预算；只限 POST 发起新对话。
  // loopback 与全局限流一致：本地单用户不卡 Chat 发消息。
  skip: (req) => shouldSkipGlobal(req) || req.method !== "POST",
  keyGenerator: (req) => {
    // 同一用户多会话并发续传 GET 不计入；POST 按 IP 限频。
    // v8 要求自定义 keyGenerator 用 req.ip 时必须经 ipKeyGenerator 归一化 IPv6，否则抛 ERR_ERL_KEY_GEN_IPV6。
    // ipKeyGenerator 签名为 (ip: string) => string（非 (req) => string），故先取 ip 再传入。
    const raw = req.ip || (req.socket?.remoteAddress as string | undefined) || "unknown";
    return `chat-post:${ipKeyGenerator(raw)}`;
  },
  handler: jsonTooManyRequests as unknown as Options["handler"],
});
