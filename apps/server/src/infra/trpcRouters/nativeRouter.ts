/**
 * native tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { webSearchSchema, nativeExecuteSchema } from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { listNativeTools, executeNativeTool } from "../nativeTools.js";
import { createTrpcInvoker } from "../trpcInvoker.js";
import { getCachedEnrichedServerCapabilities } from "../capabilities.js";

const createTrpcInvokerForCtx = createTrpcInvoker;

export const nativeRouter = router({
  list: publicProcedure
    .meta({ description: "列出所有内置原生工具及参数 Schema。", aiReadable: true })
    .query(() => listNativeTools()),
  capabilities: publicProcedure
    .meta({ description: "服务器原生能力状态（搜索/OCR/浏览器/read_article 平台）。", aiReadable: true })
    // P10/A10：改用缓存版本 + infoSource.count 精确计数，避免每次挂载查 DB 多取一页数据
    .query(({ ctx }) => getCachedEnrichedServerCapabilities(ctx.config, ctx.prisma)),
  execute: publicProcedure
    .meta({ description: "执行指定原生工具。", aiReadable: true })
    .input(nativeExecuteSchema)
    .mutation(({ ctx, input }) =>
      executeNativeTool(input.name, input.args, {
        config: ctx.config,
        services: ctx.services,
        invokeTrpc: createTrpcInvokerForCtx(ctx),
      }),
    ),
});

