import { describe, expect, it, beforeEach } from "vitest";
import { parseReadmeKeys, parseJsonKeys } from "../infra/freeKeysSync.js";
import {
  __resetFreeLlmRuntimeForTests,
  setFreellmGatewayRuntime,
  withFreellmGatewayFallback,
  setOpenRouterFreeModels,
  getOpenRouterFreeModels,
} from "../infra/freeLlmRuntime.js";
import { inferProviderFromModel, resolveProvider } from "../infra/llmClient.js";
import type { AppConfig } from "../infra/config.js";

// preferenceScore 未导出时用 parse 间接测；若导出失败则本地复制排序逻辑测 parse
function score(model?: string): number {
  const m = (model ?? "").toLowerCase();
  if (m.includes("deepseek-v4-flash")) return 100;
  if (m === "smart-chat") return 90;
  if (m.endsWith(":free")) return 80;
  if (m.startsWith("openrouter/")) return 70;
  return 10;
}

describe("freeKeysSync / freeLlmRuntime", () => {
  beforeEach(() => {
    __resetFreeLlmRuntimeForTests();
  });

  it("parseReadmeKeys 解析 freellm 表格", () => {
    const md = `| Key | Model | Status | Budget | Rate Limit | Expires | Description |
| --- | --- | --- | --- | --- | --- | --- |
| \`sk-abc1234567890\` | deepseek-v4-flash | New | $20 | 10 RPM | 2026-07-09 | test |
| \`sk-openrouterowl1\` | openrouter/owl-alpha | New | $20 | 10 RPM | 2026-07-08 | or |
| \`sk-freemodelnvidia\` | nvidia/nemotron-3:free | New | $20 | 10 RPM | 2026-07-09 | free |
`;
    const keys = parseReadmeKeys(md);
    expect(keys).toHaveLength(3);
    expect(keys[0]!.model).toBe("deepseek-v4-flash");
    expect(keys[1]!.provider).toBe("openrouter");
    expect(keys[2]!.model).toContain(":free");
    expect(score(keys[0]!.model)).toBeGreaterThan(score(keys[1]!.model));
  });

  it("parseJsonKeys 支持数组形态", () => {
    const keys = parseJsonKeys([
      { key: "sk-aaaa", model: "smart-chat", provider: "auto" },
      { apiKey: "sk-bbbb", model: "kimi-k2.5" },
    ]);
    expect(keys.map((k) => k.key)).toEqual(["sk-aaaa", "sk-bbbb"]);
  });

  it("withFreellmGatewayFallback 仅在 env key 空时注入", () => {
    setFreellmGatewayRuntime({
      apiKey: "sk-free",
      baseUrl: "https://aiapiv2.pekpik.com/v1",
      model: "smart-chat",
      syncedAt: new Date().toISOString(),
    });
    const empty = withFreellmGatewayFallback({ apiKey: "", model: "x", baseUrl: "" });
    expect(empty.apiKey).toBe("sk-free");
    expect(empty.baseUrl).toContain("pekpik");
    const kept = withFreellmGatewayFallback({
      apiKey: "sk-env",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com/v1",
    });
    expect(kept.apiKey).toBe("sk-env");
  });

  it("OpenRouter :free 模型在有 key 时走 openrouter provider", () => {
    const config = {
      llm: {
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
        providers: {
          deepseek: { apiKey: "sk-ds", model: "deepseek-v4-flash", baseUrl: "" },
          openrouter: {
            apiKey: "sk-or",
            model: "meta-llama/llama-3.2-3b-instruct:free",
            baseUrl: "https://openrouter.ai/api/v1",
          },
        },
        fallbackModels: [],
      },
    } as unknown as AppConfig;

    const p = inferProviderFromModel(config, "meta-llama/llama-3.2-3b-instruct:free");
    expect(p.id).toBe("openrouter");
    expect(p.apiKey).toBe("sk-or");
  });

  it("env 无 key 时 resolveProvider 可用 freellm 网关", () => {
    setFreellmGatewayRuntime({
      apiKey: "sk-gateway",
      baseUrl: "https://aiapiv2.pekpik.com/v1",
      model: "deepseek-v4-flash",
      syncedAt: new Date().toISOString(),
    });
    const config = {
      llm: {
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
        providers: {
          deepseek: { apiKey: "", model: "deepseek-v4-flash", baseUrl: "" },
        },
        fallbackModels: [],
      },
    } as unknown as AppConfig;
    const p = resolveProvider(config, "deepseek");
    expect(p.apiKey).toBe("sk-gateway");
    expect(p.baseUrl).toContain("pekpik");
  });

  it("setOpenRouterFreeModels 去重", () => {
    setOpenRouterFreeModels(["a:free", "b:free", "a:free"]);
    expect(getOpenRouterFreeModels()).toEqual(["a:free", "b:free"]);
  });
});
