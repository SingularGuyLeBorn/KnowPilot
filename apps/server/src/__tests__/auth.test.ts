/**
 * 可选鉴权单元测试 — L5-M03
 */

import { describe, it, expect, vi } from "vitest";
import {
  isAuthEnabled,
  verifyAuthHeader,
  loginWithPassword,
  getRemoteAccessInfo,
  assertPublicUrlAuthSafe,
} from "../infra/auth.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";
import { handleAgentChatStop } from "../infra/agentStream.js";
import { SessionStreamHub } from "../infra/sessionStreamHub.js";

describe("auth module", () => {
  it("AUTH_MODE=none 时不启用鉴权", () => {
    const config = createTestConfig("/tmp", { auth: { mode: "none", password: "", token: "" } });
    expect(isAuthEnabled(config)).toBe(false);
    expect(verifyAuthHeader(config, undefined)).toBe(true);
  });

  it("AUTH_MODE=password 时需正确 Bearer Token", () => {
    const config = createTestConfig("/tmp", {
      auth: { mode: "password", password: "secret", token: "kp-test-token" },
    });
    expect(isAuthEnabled(config)).toBe(true);
    expect(verifyAuthHeader(config, undefined)).toBe(false);
    expect(verifyAuthHeader(config, "Bearer wrong")).toBe(false);
    expect(verifyAuthHeader(config, "Bearer kp-test-token")).toBe(true);
  });

  it("loginWithPassword 校验密码并返回 token", () => {
    const config = createTestConfig("/tmp", {
      auth: { mode: "password", password: "secret", token: "kp-test-token" },
    });
    expect(loginWithPassword(config, "wrong")).toBeNull();
    expect(loginWithPassword(config, "secret")).toEqual({ token: "kp-test-token" });
  });

  it("getRemoteAccessInfo 反映公开 URL 与鉴权建议", () => {
    const config = createTestConfig("/tmp", {
      publicUrl: "https://knowpilot.example.com",
      auth: { mode: "none", password: "", token: "" },
    });
    const info = getRemoteAccessInfo(config);
    expect(info.publicUrl).toBe("https://knowpilot.example.com");
    expect(info.authRecommended).toBe(true);
    expect(info.authEnabled).toBe(false);
  });

  it("assertPublicUrlAuthSafe：生产环境有 PUBLIC_URL 无鉴权则抛错", () => {
    const config = createTestConfig("/tmp", {
      publicUrl: "https://knowpilot.example.com",
      auth: { mode: "none", password: "", token: "" },
      env: "production",
    });
    const prevAllow = process.env.KP_ALLOW_INSECURE_PUBLIC;
    const prevReq = process.env.KP_REQUIRE_PUBLIC_AUTH;
    delete process.env.KP_ALLOW_INSECURE_PUBLIC;
    delete process.env.KP_REQUIRE_PUBLIC_AUTH;
    expect(() => assertPublicUrlAuthSafe(config)).toThrow(/PUBLIC_URL/);
    if (prevAllow === undefined) delete process.env.KP_ALLOW_INSECURE_PUBLIC;
    else process.env.KP_ALLOW_INSECURE_PUBLIC = prevAllow;
    if (prevReq === undefined) delete process.env.KP_REQUIRE_PUBLIC_AUTH;
    else process.env.KP_REQUIRE_PUBLIC_AUTH = prevReq;
  });

  it("assertPublicUrlAuthSafe：开发环境有 PUBLIC_URL 无鉴权仅警告不抛", () => {
    const config = createTestConfig("/tmp", {
      publicUrl: "https://knowpilot.example.com",
      auth: { mode: "none", password: "", token: "" },
      env: "development",
    });
    const prev = process.env.KP_ALLOW_INSECURE_PUBLIC;
    delete process.env.KP_ALLOW_INSECURE_PUBLIC;
    expect(() => assertPublicUrlAuthSafe(config)).not.toThrow();
    if (prev === undefined) delete process.env.KP_ALLOW_INSECURE_PUBLIC;
    else process.env.KP_ALLOW_INSECURE_PUBLIC = prev;
  });

  it("assertPublicUrlAuthSafe：password 模式放行", () => {
    const config = createTestConfig("/tmp", {
      publicUrl: "https://knowpilot.example.com",
      auth: { mode: "password", password: "x", token: "t" },
    });
    expect(() => assertPublicUrlAuthSafe(config)).not.toThrow();
  });

  it("chat/stop 在 AUTH_MODE=password 时拒绝无 Bearer", async () => {
    const config = createTestConfig("/tmp", {
      auth: { mode: "password", password: "secret", token: "kp-test-token" },
    });
    const hub = new SessionStreamHub({
      ringSize: 10,
      persist: false,
      eventTtlMs: 1000,
      cleanupIntervalMs: 0,
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    handleAgentChatStop(hub, config)(
      { body: { sessionId: "s1" }, headers: {} } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    await hub.dispose();
  });

  it("chat/stop 在 AUTH_MODE=password 时接受正确 Bearer", async () => {
    const config = createTestConfig("/tmp", {
      auth: { mode: "password", password: "secret", token: "kp-test-token" },
    });
    const hub = new SessionStreamHub({
      ringSize: 10,
      persist: false,
      eventTtlMs: 1000,
      cleanupIntervalMs: 0,
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    handleAgentChatStop(hub, config)(
      {
        body: { sessionId: "s1" },
        headers: { authorization: "Bearer kp-test-token" },
      } as never,
      res as never,
    );
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ stopped: expect.any(Boolean) }),
    );
    await hub.dispose();
  });
});
