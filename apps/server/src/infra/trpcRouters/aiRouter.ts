/**
 * ai tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { router, publicProcedure } from "../../trpc/trpc.js";
import { success, failure } from "../../trpc/result.js";
import { listNativeTools, executeNativeTool } from "../nativeTools.js";
import { summarizeAgentTools } from "../agentTools.js";
import { createTrpcInvoker } from "../trpcInvoker.js";
import { extractTextFromImage, getOcrStatus, probeOcrPython } from "../ocrService.js";

const createTrpcInvokerForCtx = createTrpcInvoker;

export const aiRouter = router({
  tools: publicProcedure
    .meta({ description: "动态获取系统中所有注册的 API 工具及其 JSON Schema 参数说明。", aiReadable: true })
    .query(async () => {
      const { appRouter } = await import("../../router.js");
      const toolsList: any[] = [];
      const procedures = appRouter._def.procedures;
      for (const [path, proc] of Object.entries(procedures)) {
        if (path.startsWith("ai.")) continue;
        const def = (proc as any)._def;
        if (!def) continue;
        const meta = def.meta || {};
        if (meta.aiReadable === false) continue;
        const inputs = def.inputs || [];
        const inputValidator = inputs[0];
        let parameters: any = { type: "object", properties: {} };
        if (inputValidator && typeof inputValidator.parse === "function") {
          try { parameters = zodToJsonSchema(inputValidator); } catch (e: any) {
            parameters = { type: "object", description: `参数定义转换异常: ${e.message}` };
          }
        }
        toolsList.push({ name: path, description: meta.description || `执行系统操作 ${path}`, parameters });
      }
      for (const tool of listNativeTools()) {
        toolsList.push({
          name: `native.${tool.name}`,
          description: `[原生工具] ${tool.description}`,
          parameters: tool.parameters,
        });
      }
      return toolsList;
    }),

  invoke: publicProcedure
    .meta({ description: "动态反射调用指定的后端工具，支持 AI 自主执行操作。", aiReadable: true })
    .input(z.object({ tool: z.string().min(1, "必须指定工具名称"), args: z.any().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { tool, args } = input;
      const start = Date.now();
      try {
        const { appRouter } = await import("../../router.js");
        const procedures = appRouter._def.procedures as any;
        if (!procedures[tool]) {
          return failure({
            code: "AI_TOOL_NOT_FOUND",
            message: `调用失败：找不到名称为 "${tool}" 的工具。`,
            suggestion: "请调用 ai.tools 获取可用工具并核对拼写。",
            retryable: false,
            operation: "invoke",
            entity: "ai",
            durationMs: Date.now() - start,
          });
        }
        // 软删铁律等：aiReadable:false 的 procedure 对 Agent 反射不可达（不仅从 ai.tools 隐藏）
        const procMeta = (procedures[tool] as { _def?: { meta?: { aiReadable?: boolean } } })?._def?.meta;
        if (procMeta?.aiReadable === false) {
          return failure({
            code: "AI_TOOL_FORBIDDEN",
            message: `调用失败：工具 "${tool}" 不对 Agent 开放（aiReadable=false）。`,
            suggestion: "删除请用 post.delete / file_delete / directory_delete / garden.delete（软删）；永久删除仅人类 UI。",
            retryable: false,
            operation: "invoke",
            entity: "ai",
            durationMs: Date.now() - start,
          });
        }
        const caller = appRouter.createCaller(ctx);
        const parts = tool.split(".");
        if (parts[0] === "native" && parts.length === 2) {
          const result = await executeNativeTool(parts[1], (args as Record<string, unknown>) || {}, {
            config: ctx.config,
            services: ctx.services,
            invokeTrpc: createTrpcInvokerForCtx(ctx),
          });
          return success({ data: result, operation: "invoke", entity: "ai", durationMs: Date.now() - start });
        }
        let method = caller as any;
        for (const part of parts) {
          if (!method || method[part] === undefined) throw new Error(`无法解析调用链路: ${tool}`);
          method = method[part];
        }
        if (typeof method !== "function") throw new Error(`解析出的对象不是可执行的函数`);
        const result = await method(args);
        return success({ data: result, operation: "invoke", entity: "ai", durationMs: Date.now() - start });
      } catch (error: any) {
        return failure({
          code: "AI_CALL_EXECUTION_ERROR",
          message: `工具 "${tool}" 执行时抛出异常：${error.message}`,
          details: { originalError: String(error) },
          suggestion: "请检查调用参数是否完整，或者联系管理员排查后台服务。",
          retryable: false,
          operation: "invoke",
          entity: "ai",
          durationMs: Date.now() - start,
        });
      }
    }),
});
