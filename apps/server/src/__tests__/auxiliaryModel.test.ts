import { describe, it, expect, beforeEach } from "vitest";
import {
  pickOpenRouterFreeModel,
  resolveAuxiliaryModel,
  scoreOpenRouterFreeModel,
} from "../infra/auxiliaryModel.js";
import {
  __resetFreeLlmRuntimeForTests,
  setOpenRouterFreeModelCatalog,
} from "../infra/freeLlmRuntime.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

describe("auxiliaryModel — OpenRouter strong_free", () => {
  beforeEach(() => {
    __resetFreeLlmRuntimeForTests();
  });

  it("strong_free 优先大模型 / 高上下文，而不是 flash/mini", () => {
    setOpenRouterFreeModelCatalog({
      syncedAt: new Date().toISOString(),
      models: [
        { id: "google/gemma-3-4b-it:free", name: "Gemma 4B", contextLength: 128_000 },
        { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 70B", contextLength: 128_000 },
        { id: "google/gemini-2.0-flash-exp:free", name: "Flash", contextLength: 1_000_000 },
      ],
    });
    const picked = pickOpenRouterFreeModel("strong_free");
    expect(picked).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });

  it("lite_free 偏好 flash/mini（与 compact 摘要取向一致）", () => {
    setOpenRouterFreeModelCatalog({
      syncedAt: new Date().toISOString(),
      models: [
        { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 70B", contextLength: 128_000 },
        { id: "google/gemini-2.0-flash-exp:free", name: "Flash", contextLength: 128_000 },
      ],
    });
    expect(pickOpenRouterFreeModel("lite_free")).toBe("google/gemini-2.0-flash-exp:free");
  });

  it("resolveAuxiliaryModel：显式配置优先生效", () => {
    const config = createTestConfig("/tmp/kp-aux", {
      llm: {
        defaultProvider: "openrouter",
        providers: {
          openrouter: {
            apiKey: "sk-or-test",
            baseUrl: "https://openrouter.ai/api/v1",
            model: "openrouter/auto",
          },
        },
      } as never,
    });
    expect(
      resolveAuxiliaryModel(config, {
        configured: "qwen/qwen3-32b:free",
        mainModel: "deepseek-chat",
      }),
    ).toBe("qwen/qwen3-32b:free");
  });

  it("resolveAuxiliaryModel：auto + OpenRouter key → strong_free 目录选型", () => {
    setOpenRouterFreeModelCatalog({
      syncedAt: new Date().toISOString(),
      models: [
        { id: "qwen/qwen3-32b:free", name: "Qwen3 32B", contextLength: 40_000 },
        { id: "google/gemma-2-9b-it:free", name: "Gemma small", contextLength: 8_000 },
      ],
    });
    const config = createTestConfig("/tmp/kp-aux", {
      llm: {
        defaultProvider: "openrouter",
        providers: {
          openrouter: {
            apiKey: "sk-or-test",
            baseUrl: "https://openrouter.ai/api/v1",
            model: "openrouter/auto",
          },
        },
      } as never,
    });
    expect(
      resolveAuxiliaryModel(config, {
        configured: "auto",
        mainModel: "deepseek-chat",
        preference: "strong_free",
      }),
    ).toBe("qwen/qwen3-32b:free");
  });

  it("score：70b 高于同上下文 flash", () => {
    const a = scoreOpenRouterFreeModel(
      { id: "x/llama-3.3-70b-instruct:free", name: "70b", contextLength: 128_000 },
      "strong_free",
    );
    const b = scoreOpenRouterFreeModel(
      { id: "x/gemini-flash:free", name: "flash", contextLength: 128_000 },
      "strong_free",
    );
    expect(a).toBeGreaterThan(b);
  });
});
