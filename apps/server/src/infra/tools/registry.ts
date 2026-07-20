/**
 * 全局工具注册表 — 单一查询入口
 */

import type { ToolCommand, ToolKind } from "./types.js";

const registry = new Map<string, ToolCommand>();

export function registerTool<Ctx = unknown>(cmd: ToolCommand<Ctx>): void {
  if (!cmd.name?.trim()) {
    throw new Error("registerTool: name 不能为空");
  }
  if (registry.has(cmd.name)) {
    // 开发期允许热重载覆盖；生产仍覆盖但打日志
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[ToolRegistry] 覆盖已注册工具: ${cmd.name}`);
    }
  }
  registry.set(cmd.name, cmd as ToolCommand);
}

export function getTool(name: string): ToolCommand | undefined {
  return registry.get(name);
}

export function hasTool(name: string): boolean {
  return registry.has(name);
}

export function listTools(kind?: ToolKind): ToolCommand[] {
  const all = [...registry.values()];
  return kind ? all.filter((t) => t.kind === kind) : all;
}

export function listToolNames(kind?: ToolKind): string[] {
  return listTools(kind).map((t) => t.name);
}

/**
 * AGENT_DESTRUCTIVE_APPROVAL 审批清单唯一事实源：
 * native 且 destructive 且未声明 approvalExempt。
 * 挂在 registry 叶子，供 approvalGate 派生，避免 approvalGate↔域注册循环依赖。
 */
export function listDestructiveNativeOpsForApproval(): Set<string> {
  return new Set(
    listTools("native")
      .filter((t) => t.destructive === true && t.approvalExempt !== true)
      .map((t) => t.name),
  );
}

/** 测试用：清空注册表 */
export function __resetToolRegistryForTests(): void {
  registry.clear();
}
