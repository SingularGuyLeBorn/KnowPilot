/**
 * Express 速率限制中间件（P2 安全加固）
 *
 * 设计原则：
 * - 本地单用户优先：默认阈值宽松，日常开发不会触发。
 * - 远程暴露时兜底：防止 /chat/stream 等昂贵端点被滥用刷 LLM、防 tRPC 暴力枚举。
 * - 环境变量可调：RATE_LIMIT_ENABLED=false 整体关闭；RATE_LIMIT_*_PER_MIN 细粒度调阈。
 * - AUTH_MODE=none（裸奔）时尤其需要；AUTH_MODE=password 时叠加鉴权前限流防暴力。
 *
 * 两层：
 *   1. 全局：所有路由统一宽松阈值（默认 600 req / 15min / IP）。
 *   2. SSE chat stream：昂贵端点单独收紧（默认 30 POST / min / IP）。
 */

import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";

const enabled = process.env.RATE_LIMIT_ENABLED !== "false";

/** 统一 429 响应体，避免暴露内部细节 */
function jsonTooManyRequests(_req: unknown, res: { status: (code: number) => any; json: (body: unknown) => any }, _next: unknown) {
  res.status(429).json({
    error: "TOO_MANY_REQUESTS",
    message: "请求过于频繁，请稍后再试。本地开发如误触发可设 RATE_LIMIT_ENABLED=false 关闭。",
  });
}

const globalPer15Min = Math.max(60, parseInt(process.env.RATE_LIMIT_GLOBAL_PER_15MIN || "600", 10));
const streamPerMin = Math.max(5, parseInt(process.env.RATE_LIMIT_STREAM_PER_MIN || "30", 10));

/** 全局限流器：覆盖所有路由（含 tRPC、静态资源、SSE）。 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: globalPer15Min,
  standardHeaders: true,
  legacyHeaders: false,
  // 本地开发常见 127.0.0.1 / ::1，不跳过；远程暴露时按 IP 区分。
  // RATE_LIMIT_ENABLED=false 时整体关闭（skip 永真）。
  skip: () => !enabled,
  handler: jsonTooManyRequests as unknown as Options["handler"],
});

/** SSE chat stream 限流器：仅作用于 POST /api/agent/chat/stream。 */
export const chatStreamRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: streamPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  // GET 同一端点为 SSE 续传订阅，不计入「发起对话」预算；只限 POST 发起新对话。
  skip: (req) => !enabled || req.method !== "POST",
  keyGenerator: (req) => {
    // 同一用户多会话并发续传 GET 不计入；POST 按 IP 限频。
    // v8 要求自定义 keyGenerator 用 req.ip 时必须经 ipKeyGenerator 归一化 IPv6，否则抛 ERR_ERL_KEY_GEN_IPV6。
    // ipKeyGenerator 签名为 (ip: string) => string（非 (req) => string），故先取 ip 再传入。
    const raw = req.ip || (req.socket?.remoteAddress as string | undefined) || "unknown";
    return `chat-post:${ipKeyGenerator(raw)}`;
  },
  handler: jsonTooManyRequests as unknown as Options["handler"],
});
