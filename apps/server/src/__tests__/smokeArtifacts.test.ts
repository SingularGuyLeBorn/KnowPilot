import { describe, expect, it } from "vitest";
import {
  isSmokeAgentName,
  isSmokeContentSlug,
  isSmokeInfoSource,
} from "../infra/smokeArtifacts.js";

describe("smokeArtifacts", () => {
  it("识别 smoke 信息源", () => {
    expect(isSmokeInfoSource("Smoke Source 1782745884400", "smoke-source-1782745884400")).toBe(true);
    expect(isSmokeInfoSource("DeepSeek 官方文档", "deepseek-official")).toBe(false);
  });

  it("识别 smoke 内容 slug", () => {
    expect(isSmokeContentSlug("smoke-post-123")).toBe(true);
    expect(isSmokeContentSlug("hello-world")).toBe(false);
  });

  it("识别 smoke Agent 名称", () => {
    expect(isSmokeAgentName("Smoke Agent 1782745884400")).toBe(true);
    expect(isSmokeAgentName("assistant")).toBe(false);
  });
});
