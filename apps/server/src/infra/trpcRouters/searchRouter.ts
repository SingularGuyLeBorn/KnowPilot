/**
 * search tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import {
  webSearchSchema,
  globalSearchSchema,
  tagFacetsSchema,
  browseByTagSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { executeNativeTool } from "../nativeTools.js";
import { createTrpcInvoker } from "../trpcInvoker.js";
import { runGlobalSearch } from "../globalSearch.js";
import { browseByTag, collectTagFacets } from "../tagBrowse.js";

const createTrpcInvokerForCtx = createTrpcInvoker;

export const searchRouter = router({
  web: publicProcedure
    .meta({ description: "联网搜索（Tavily / SerpAPI）。", aiReadable: true })
    .input(webSearchSchema)
    .query(({ ctx, input }) =>
      executeNativeTool("web_search", {
        query: input.query,
        maxResults: input.maxResults,
        engine: input.provider === "auto" ? undefined : input.provider,
      }, {
        config: ctx.config,
        services: ctx.services,
        invokeTrpc: createTrpcInvokerForCtx(ctx),
      }),
    ),
  global: publicProcedure
    .meta({ description: "跨实体全局搜索（Post/Agent/Skill/Memory/Task/MCP/Message）。", aiReadable: true })
    .input(globalSearchSchema)
    .query(({ ctx, input }) =>
      runGlobalSearch(ctx.prisma, ctx.services, input.query, input.entities, input.limit),
    ),
  tagFacets: publicProcedure
    .meta({
      description: "跨实体标签词表与计数（Post/Skill/Memory/Prompt/InfoSource/Inbox）。",
      aiReadable: true,
    })
    .input(tagFacetsSchema)
    .query(({ ctx, input }) => collectTagFacets(ctx.prisma, input.entities, input.limit)),
  byTag: publicProcedure
    .meta({
      description: "按统一标签浏览跨实体条目（同义词已归并）。",
      aiReadable: true,
    })
    .input(browseByTagSchema)
    .query(({ ctx, input }) => browseByTag(ctx.prisma, input.tag, input.entities, input.limit)),
});

