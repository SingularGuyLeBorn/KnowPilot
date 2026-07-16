/**
 * 将一组 schema + handler 注册进全局 ToolCommand 表
 *
 * 第三参数 rollbacks：D 类（destructive）工具的幂等补偿，键与 def.name 对齐；
 * 无补偿实现的 destructive 工具（git_commit 等）run 失败时只记 warn「需人工 revert」。
 */

import { registerTool } from "../registry.js";
import type { ToolRollback } from "../types.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";

export function registerNativeDomain(
  defs: NativeToolDefinition[],
  handlers: Record<string, NativeToolHandler>,
  rollbacks?: Record<string, ToolRollback<NativeToolContext>>,
): void {
  for (const def of defs) {
    const handler = handlers[def.name];
    if (!handler) {
      console.warn(`[native/${def.name}] 有 schema 无 handler，跳过注册`);
      continue;
    }
    const rb = rollbacks?.[def.name];
    registerTool<NativeToolContext>({
      name: def.name,
      kind: "native",
      concurrencyClass: def.concurrencyClass,
      destructive: def.destructive,
      reentrant: def.reentrant,
      schema: () => ({ description: def.description, parameters: def.parameters }),
      execute: (args, ctx) => handler(args, ctx),
      captureRollback: rb?.capture,
      rollback: rb?.compensate,
    });
  }
}
