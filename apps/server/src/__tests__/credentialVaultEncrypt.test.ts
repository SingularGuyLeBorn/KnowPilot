/**
 * CREDENTIAL_MASTER_KEY 加密落库路径（globalSetup 已注入测试 key）。
 */
import { describe, expect, it } from "vitest";
import {
  decryptCredentialValue,
  encryptCredentialValue,
} from "../infra/credentialVault.js";

describe("credentialVault 加密", () => {
  it("有 master key 时落库为 enc: 前缀且可解密", () => {
    expect(process.env.CREDENTIAL_MASTER_KEY?.length).toBeGreaterThanOrEqual(32);
    const enc = encryptCredentialValue("super-secret-token");
    expect(enc.startsWith("enc:")).toBe(true);
    expect(enc).not.toContain("super-secret-token");
    expect(decryptCredentialValue(enc)).toBe("super-secret-token");
  });

  it("明文旧值无前缀时原样返回（兼容历史）", () => {
    expect(decryptCredentialValue("legacy-plain")).toBe("legacy-plain");
  });
});
