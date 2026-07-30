/**
 * llm tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { getLlmBudgetStatus } from "../llmBudget.js";
import {
  getFreellmGatewayRuntime,
  getOpenRouterFreeModelCatalog,
  getOpenRouterFreeSyncedAt,
  filterOpenRouterFreeModels,
  loadOpenRouterFreeCatalogFromDisk,
} from "../freeLlmRuntime.js";
import { listFreellmChannels, syncFreeKeys } from "../freeKeysSync.js";
import { listLocalLlmBackends } from "../localLlmCatalog.js";

export const llmRouter = router({
  freeModelsStatus: publicProcedure
    .meta({ description: "免费模型同步状态（OpenRouter :free + freellm 网关）。", aiReadable: false })
    .query(async ({ ctx }) => {
      if (!getOpenRouterFreeModelCatalog()) {
        loadOpenRouterFreeCatalogFromDisk(ctx.config.projectRoot);
      }
      const catalog = getOpenRouterFreeModelCatalog();
      const channels = await listFreellmChannels(ctx.prisma);
      const runtime = getFreellmGatewayRuntime();
      return {
        openRouter: {
          hasApiKey: !!ctx.config.llm.providers.openrouter?.apiKey?.trim(),
          syncedAt: getOpenRouterFreeSyncedAt(),
          count: catalog?.models.length ?? 0,
        },
        freellm: {
          runtimeModel: runtime?.model ?? null,
          runtimeBaseUrl: runtime?.baseUrl ?? null,
          credentialCount: channels.length,
        },
      };
    }),

  listFreeModels: publicProcedure
    .meta({ description: "列出 OpenRouter :free 模型目录（含上下文/定价/模态）。", aiReadable: false })
    .input(
      z
        .object({
          q: z.string().optional(),
          modality: z.enum(["text", "multimodal", "all"]).default("all"),
          sort: z.enum(["context_desc", "context_asc", "name"]).default("context_desc"),
        })
        .default({}),
    )
    .query(({ ctx, input }) => {
      if (!getOpenRouterFreeModelCatalog()) {
        loadOpenRouterFreeCatalogFromDisk(ctx.config.projectRoot);
      }
      const items = filterOpenRouterFreeModels({
        q: input.q,
        modality: input.modality,
        sort: input.sort,
      });
      return {
        syncedAt: getOpenRouterFreeSyncedAt(),
        hasApiKey: !!ctx.config.llm.providers.openrouter?.apiKey?.trim(),
        total: items.length,
        items,
      };
    }),

  listFreellmChannels: publicProcedure
    .meta({ description: "列出已探活的 freellm 网关通道（不含明文 key）。", aiReadable: false })
    .query(async ({ ctx }) => {
      const items = await listFreellmChannels(ctx.prisma);
      const runtime = getFreellmGatewayRuntime();
      return {
        runtimeModel: runtime?.model ?? null,
        runtimeBaseUrl: runtime?.baseUrl ?? null,
        total: items.length,
        items,
      };
    }),

  refreshFreeModels: publicProcedure
    .meta({ description: "立即同步 freellm key + OpenRouter :free 目录。", aiReadable: false })
    .mutation(async ({ ctx }) => {
      const result = await syncFreeKeys(ctx.prisma, ctx.config);
      return { success: true as const, ...result };
    }),

  listLocalModels: publicProcedure
    .meta({
      description:
        "探测本机 OpenAI 兼容后端（Ollama / llama.cpp / LM Studio / vLLM）并列出已加载模型。会话模型 id 形如 ollama/llama3.2。",
      aiReadable: false,
    })
    .input(
      z
        .object({
          providers: z
            .array(z.enum(["ollama", "llamacpp", "lmstudio", "vllm"]))
            .optional(),
          timeoutMs: z.number().int().min(500).max(15_000).default(2500),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const result = await listLocalLlmBackends(ctx.config, {
        timeoutMs: input.timeoutMs,
        providers: input.providers,
      });
      return {
        ...result,
        modelIdHint: "选中后会话 model 为 {provider}/{upstreamName}，如 ollama/qwen2.5:7b",
      };
    }),
});
