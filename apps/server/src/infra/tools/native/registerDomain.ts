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
    // 反向校验：approvalExempt 仅对 destructive 有意义；destructive 默认入审批清单（派生自 registry）
    if (def.approvalExempt && !def.destructive) {
      console.warn(
        `[native/${def.name}] approvalExempt 仅对 destructive 工具有效，已忽略（非 destructive 本就不入审批清单）`,
      );
    }
    const rb = rollbacks?.[def.name];
    // P1-03：destructive && !approvalExempt（需审批的危险工具）自动 defaultHidden=true，
    // 除非域定义显式声明 defaultHidden。这让 native:"all" 不会默认暴露 run_shell/git_push/
    // file_delete/github_delete_repo 等危险工具，Agent 想用必须显式 `native:<name>`。
    // approvalExempt 的 destructive（write_file 等可回滚写入）不自动隐藏——是常用工具。
    let defaultHidden = def.defaultHidden;
    if (defaultHidden === undefined) {
      defaultHidden = def.destructive === true && def.approvalExempt !== true;
    }
    registerTool<NativeToolContext>({
      name: def.name,
      kind: "native",
      concurrencyClass: def.concurrencyClass,
      destructive: def.destructive,
      approvalExempt: def.destructive ? def.approvalExempt : undefined,
      defaultHidden,
      schema: () => ({ description: def.description, parameters: def.parameters }),
      execute: (args, ctx) => handler(args, ctx),
      captureRollback: rb?.capture,
      rollback: rb?.compensate,
    });
  }
}
