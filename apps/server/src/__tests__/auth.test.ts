/**
 * 可选鉴权单元测试 — L5-M03
 */

import { describe, it, expect } from "vitest";
import {
  isAuthEnabled,
  verifyAuthHeader,
  loginWithPassword,
  getRemoteAccessInfo,
} from "../infra/auth.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

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
});
