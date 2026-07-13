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

/** 测试用：清空注册表 */
export function __resetToolRegistryForTests(): void {
  registry.clear();
}
