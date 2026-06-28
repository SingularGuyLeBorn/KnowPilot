/**
 * tRPC 反射调用器 — 供 Agent / Trigger 内部调用 aiReadable procedures
 */

import type { ServiceContainer } from "./serviceContainer.js";

export function createTrpcInvoker(ctx: { services: ServiceContainer }) {
  return async (tool: string, args?: unknown) => {
    const { appRouter } = await import("../router.js");
    const caller = appRouter.createCaller(ctx as never);
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
