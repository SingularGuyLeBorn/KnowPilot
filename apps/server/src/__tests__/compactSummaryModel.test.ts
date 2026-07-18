import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AppConfig } from "../infra/config.js";
import { resolveCompactSummaryModel } from "../infra/autoCompact.js";
import {
  __resetFreeLlmRuntimeForTests,
  setFreellmGatewayRuntime,
  setOpenRouterFreeModelCatalog,
} from "../infra/freeLlmRuntime.js";

function baseConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    llm: {
      defaultProvider: "deepseek",
      defaultModel: "deepseek-v4-flash",
      providers: {
        deepseek: { apiKey: "sk-paid", model: "deepseek-v4-flash", baseUrl: "" },
        openrouter: { apiKey: "", model: "", baseUrl: "" },
      },
    },
    compact: {
      enabled: true,
      triggerRatio: 0.75,
      keepRecent: 8,
      summaryModel: "auto",
      microCompact: { enabled: true, toolResultMaxChars: 4000 },
      memoryFlush: { enabled: false, maxFacts: 5 },
    },
    ...overrides,
  } as AppConfig;
}

describe("resolveCompactSummaryModel", () => {
  beforeEach(() => {
    __resetFreeLlmRuntimeForTests();
  });
  afterEach(() => {
    __resetFreeLlmRuntimeForTests();
  });

  it("显式 summaryModel 优先于 auto", () => {
    const cfg = baseConfig({
      compact: { ...baseConfig().compact, summaryModel: "my/custom:free" },
    });
    expect(resolveCompactSummaryModel(cfg, "deepseek-v4-flash")).toBe("my/custom:free");
  });

  it("auto + OpenRouter key + :free 目录 → 选轻量免费模型", () => {
    const cfg = baseConfig();
    (cfg.llm.providers as any).openrouter = { apiKey: "or-key", model: "", baseUrl: "" };
    setOpenRouterFreeModelCatalog({
      syncedAt: new Date().toISOString(),
      models: [
        { id: "vendor/big-model:free", name: "big", contextLength: 200000 },
        { id: "vendor/flash-mini:free", name: "flash", contextLength: 128000 },
      ],
    });
    expect(resolveCompactSummaryModel(cfg, "deepseek-v4-flash")).toBe("vendor/flash-mini:free");
  });

  it("有付费 key 且无 OpenRouter 时不误用 freellm 模型名", () => {
    setFreellmGatewayRuntime({
      apiKey: "free-key",
      baseUrl: "https://example.com/v1",
      model: "some/free-gateway-model",
      syncedAt: new Date().toISOString(),
    });
    const cfg = baseConfig();
    expect(resolveCompactSummaryModel(cfg, "deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  it("无正式 key、freellm 兜底默认 provider 时用网关模型", () => {
    setFreellmGatewayRuntime({
      apiKey: "free-key",
      baseUrl: "https://example.com/v1",
      model: "gateway/cheap",
      syncedAt: new Date().toISOString(),
    });
    const cfg = baseConfig();
    (cfg.llm.providers as any).deepseek = { apiKey: "", model: "deepseek-v4-flash", baseUrl: "" };
    expect(resolveCompactSummaryModel(cfg, "deepseek-v4-flash")).toBe("gateway/cheap");
  });
});
