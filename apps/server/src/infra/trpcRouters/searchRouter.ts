/**
 * search tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { webSearchSchema, globalSearchSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { executeNativeTool } from "../nativeTools.js";
import { createTrpcInvoker } from "../trpcInvoker.js";
import { runGlobalSearch } from "../globalSearch.js";

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
});

