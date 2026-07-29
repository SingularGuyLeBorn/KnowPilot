/**
 * 本地 LLM provider：路由、无真实 key、模型名剥前缀
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAppConfig, resetAppConfigForTests } from "../infra/config.js";
import {
  inferProviderFromModel,
  resolveProvider,
} from "../infra/llmClient.js";
import { parseLocalModelRef, toLocalModelRef } from "@knowpilot/shared";

describe("local LLM providers", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    resetAppConfigForTests();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.VITE_DEEPSEEK_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.LLM_DEFAULT_PROVIDER;
  });

  afterEach(() => {
    process.env = { ...prev };
    resetAppConfigForTests();
  });

  it("parseLocalModelRef / toLocalModelRef 往返", () => {
    expect(parseLocalModelRef("ollama/llama3.2:latest")).toEqual({
      providerId: "ollama",
      apiModel: "llama3.2:latest",
    });
    expect(toLocalModelRef("lmstudio", "qwen2.5-7b")).toBe("lmstudio/qwen2.5-7b");
    expect(parseLocalModelRef("deepseek-v4-flash").providerId).toBeNull();
  });

  it("resolveProvider(ollama) 无需真实 API Key，带默认 baseUrl", () => {
    const config = createAppConfig();
    const p = resolveProvider(config, "ollama");
    expect(p.id).toBe("ollama");
    expect(p.apiKey).toBeTruthy();
    expect(p.baseUrl).toMatch(/11434/);
  });

  it("inferProviderFromModel 识别 ollama/ 前缀并剥前缀给上游", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    resetAppConfigForTests();
    const config = createAppConfig();
    const p = inferProviderFromModel(config, "ollama/qwen2.5:7b");
    expect(p.id).toBe("ollama");

    // 通过 chatCompletion 路径前的 resolveEffectiveModel 行为：用 infer + 内部逻辑间接验证
    // 这里直接测 infer；剥前缀在 llmClient.resolveEffectiveModel（同文件私有）
    // 用 llamacpp / lmstudio / vllm 路由覆盖
    expect(inferProviderFromModel(config, "llamacpp/my-gguf").id).toBe("llamacpp");
    expect(inferProviderFromModel(config, "lmstudio/foo").id).toBe("lmstudio");
    expect(inferProviderFromModel(config, "vllm/bar").id).toBe("vllm");
  });

  it("defaultProvider=ollama 时裸模型名走本地", () => {
    process.env.LLM_DEFAULT_PROVIDER = "ollama";
    resetAppConfigForTests();
    const config = createAppConfig();
    expect(config.llm.defaultProvider).toBe("ollama");
    expect(inferProviderFromModel(config, "llama3.2").id).toBe("ollama");
  });
});
