/**
 * 可选鉴权 — L5 单用户密码 / Token 模式
 *
 * AUTH_MODE=none（默认）：与现有行为一致，无鉴权。
 * AUTH_MODE=password：需 Bearer Token（login 或 AUTH_TOKEN）。
 */

import { TRPCError } from "@trpc/server";
import type { AppConfig } from "./config.js";

export function isAuthEnabled(config: AppConfig): boolean {
  return config.auth.mode === "password" && !!config.auth.password;
}

export function verifyAuthHeader(config: AppConfig, authorization?: string | string[]): boolean {
  if (!isAuthEnabled(config)) return true;
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!raw?.startsWith("Bearer ")) return false;
  const token = raw.slice("Bearer ".length).trim();
  return token.length > 0 && token === config.auth.token;
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
  if (password !== config.auth.password) return null;
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
