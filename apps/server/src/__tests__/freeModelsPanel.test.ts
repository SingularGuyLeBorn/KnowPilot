import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  projectOpenRouterFreeModel,
  listFreellmChannels,
} from "../infra/freeKeysSync.js";
import {
  __resetFreeLlmRuntimeForTests,
  setOpenRouterFreeModelCatalog,
  filterOpenRouterFreeModels,
  setFreellmGatewayRuntime,
} from "../infra/freeLlmRuntime.js";

describe("freeModels catalog", () => {
  beforeEach(() => {
    __resetFreeLlmRuntimeForTests();
  });

  it("projectOpenRouterFreeModel 只接受 :free 并投影元数据", () => {
    expect(
      projectOpenRouterFreeModel({
        id: "meta-llama/llama-3.2-3b-instruct",
        name: "Llama",
      }),
    ).toBeNull();

    const m = projectOpenRouterFreeModel({
      id: "meta-llama/llama-3.2-3b-instruct:free",
      name: "Llama 3.2 3B (free)",
      description: "A free model",
      context_length: 131072,
      architecture: { modality: "text->text", tokenizer: "Llama3" },
      pricing: { prompt: "0", completion: "0" },
      top_provider: { name: "Together" },
    });
    expect(m).toMatchObject({
      id: "meta-llama/llama-3.2-3b-instruct:free",
      name: "Llama 3.2 3B (free)",
      contextLength: 131072,
      modality: "text->text",
      pricingPrompt: "0",
      topProvider: "Together",
    });
  });

  it("filterOpenRouterFreeModels 支持搜索与多模态筛选", () => {
    setOpenRouterFreeModelCatalog({
      syncedAt: new Date().toISOString(),
      models: [
        {
          id: "a/text:free",
          name: "Text Only",
          modality: "text->text",
          contextLength: 8_000,
        },
        {
          id: "b/vision:free",
          name: "Vision",
          description: "sees images",
          modality: "text+image->text",
          contextLength: 32_000,
        },
      ],
    });

    expect(filterOpenRouterFreeModels({ q: "vision" })).toHaveLength(1);
    expect(filterOpenRouterFreeModels({ modality: "multimodal" }).map((m) => m.id)).toEqual([
      "b/vision:free",
    ]);
    expect(filterOpenRouterFreeModels({ sort: "context_asc" })[0]!.id).toBe("a/text:free");
  });

  it("listFreellmChannels 永不返回 value 字段", async () => {
    setFreellmGatewayRuntime({
      apiKey: "sk-secret-should-not-leak",
      baseUrl: "https://aiapiv2.pekpik.com/v1",
      model: "smart-chat",
      credentialId: "cred-1",
      syncedAt: new Date().toISOString(),
    });

    const prisma = {
      credential: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "cred-1",
            name: "free-auto-smart-chat-xxxxxxxx",
            metadata: JSON.stringify({
              source: "free",
              model: "smart-chat",
              provider: "auto",
              baseUrl: "https://aiapiv2.pekpik.com/v1",
              budget: "$20",
              validated: true,
              syncedAt: new Date().toISOString(),
            }),
            expiresAt: null,
            lastUsedAt: null,
            // 模拟 ORM 若误 select value，列表函数也不应透出
            value: "sk-secret-should-not-leak",
          },
          {
            id: "cred-2",
            name: "paid-key",
            metadata: JSON.stringify({ source: "env" }),
            expiresAt: null,
            lastUsedAt: null,
            value: "sk-other",
          },
        ]),
      },
    };

    const items = await listFreellmChannels(prisma as any);
    expect(items).toHaveLength(1);
    expect(items[0]!.model).toBe("smart-chat");
    expect(items[0]!.isRuntime).toBe(true);
    expect(JSON.stringify(items)).not.toContain("sk-secret");
    expect(JSON.stringify(items)).not.toContain("value");
    expect(items[0]).not.toHaveProperty("value");
  });
});
