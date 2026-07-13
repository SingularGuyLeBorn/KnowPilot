/**
 * 将一组 schema + handler 注册进全局 ToolCommand 表
 */

import { registerTool } from "../registry.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";

export function registerNativeDomain(
  defs: NativeToolDefinition[],
  handlers: Record<string, NativeToolHandler>,
): void {
  for (const def of defs) {
    const handler = handlers[def.name];
    if (!handler) {
      console.warn(`[native/${def.name}] 有 schema 无 handler，跳过注册`);
      continue;
    }
    registerTool<NativeToolContext>({
      name: def.name,
      kind: "native",
      schema: () => ({ description: def.description, parameters: def.parameters }),
      execute: (args, ctx) => handler(args, ctx),
    });
  }
}
