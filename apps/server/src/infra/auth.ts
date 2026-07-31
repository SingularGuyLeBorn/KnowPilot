/**
 * 可选鉴权 — L5 单用户密码 / Token 模式
 *
 * AUTH_MODE=none（默认）：与现有行为一致，无鉴权。
 * AUTH_MODE=password：需 Bearer Token（login 或 AUTH_TOKEN）。
 */

import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { AppConfig } from "./config.js";

export function isAuthEnabled(config: AppConfig): boolean {
  return config.auth.mode === "password" && !!config.auth.password;
}

/** 常量时间比较密钥/密码（防时序侧信道）；长度不等先返回 false */
function safeEqualSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifyAuthHeader(config: AppConfig, authorization?: string | string[]): boolean {
  if (!isAuthEnabled(config)) return true;
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!raw?.startsWith("Bearer ")) return false;
  const token = raw.slice("Bearer ".length).trim();
  return token.length > 0 && safeEqualSecret(token, config.auth.token);
}

export function assertAuthHeader(config: AppConfig, authorization?: string | string[]): void {
  if (!verifyAuthHeader(config, authorization)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "未授权：请先登录或提供有效的 Authorization Bearer Token。",
    });
  }
}

export function loginWithPassword(
  config: AppConfig,
  password: string,
): { token: string } | null {
  if (!isAuthEnabled(config)) {
    return { token: "" };
  }
  if (password.length === 0 || !safeEqualSecret(password, config.auth.password)) return null;
  return { token: config.auth.token };
}

export function getRemoteAccessInfo(config: AppConfig) {
  return {
    publicUrl: config.publicUrl || null,
    corsOrigins: config.corsOrigins,
    tunnelConfigured: !!config.cloudflare.tunnelToken,
    authEnabled: isAuthEnabled(config),
    authRecommended: !!config.publicUrl && !isAuthEnabled(config),
  };
}

/**
 * 公网 URL 已配置但未开密码鉴权 → 不安全。
 * - production / KP_REQUIRE_PUBLIC_AUTH=1：抛错（调用方应拒启）
 * - 开发：仅 warn（本地常配 PUBLIC_URL 给 AgentMail webhook，由 remote 脚本硬拦隧道）
 * - KP_ALLOW_INSECURE_PUBLIC=1：显式逃生，仅 warn
 */
export function assertPublicUrlAuthSafe(config: AppConfig): void {
  if (!config.publicUrl?.trim()) return;
  if (isAuthEnabled(config)) return;
  const msg =
    "检测到 PUBLIC_URL 但 AUTH_MODE 未设为 password。公网暴露必须启用鉴权：" +
    "在 .env 设置 AUTH_MODE=password 与 AUTH_PASSWORD；" +
    "隧道请用 pnpm remote（无鉴权会拒绝）；本地临时可设 KP_ALLOW_INSECURE_PUBLIC=1。";
  if (process.env.KP_ALLOW_INSECURE_PUBLIC === "1") {
    console.warn(`  ⚠️ [安全] ${msg}（KP_ALLOW_INSECURE_PUBLIC=1 强制放行）`);
    return;
  }
  const isProd =
    config.env === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.KP_REQUIRE_PUBLIC_AUTH === "1";
  if (isProd) {
    throw new Error(msg);
  }
  console.warn(`  ⚠️ [安全] ${msg}（开发模式仅警告；生产 / KP_REQUIRE_PUBLIC_AUTH=1 将拒绝启动）`);
}
