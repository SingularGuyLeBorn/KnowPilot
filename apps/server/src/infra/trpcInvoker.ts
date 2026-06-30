/**
 * tRPC 反射调用器 — 供 Agent / Trigger 内部调用 aiReadable procedures
 */

import type { Context } from "../trpc/context.js";
import { getAppConfig } from "./config.js";

export function createTrpcInvoker(ctx: Partial<Context> & { services: Context["services"] }) {
  return async (tool: string, args?: unknown) => {
    const { appRouter } = await import("../router.js");
    const config = ctx.config ?? getAppConfig();
    const fullCtx = {
      prisma: ctx.prisma!,
      services: ctx.services,
      eventBus: ctx.eventBus!,
      config,
      req: ctx.req ?? ({ headers: {} } as Context["req"]),
      res: ctx.res ?? ({} as Context["res"]),
    } satisfies Context;
    const caller = appRouter.createCaller(fullCtx as never);
    const parts = tool.split(".");
    let method = caller as Record<string, unknown>;
    for (const part of parts) {
      method = method[part] as Record<string, unknown>;
      if (!method) throw new Error(`无法解析工具: ${tool}`);
    }
    if (typeof method !== "function") throw new Error(`工具不可执行: ${tool}`);
    return (method as (a: unknown) => Promise<unknown>)(args);
  };
}
