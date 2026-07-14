/**
 * 原生工具注册表 — Agent 可直接调用的内置能力
 *
 * PR-4 全部落地：所有 handler/schema 已按域迁至 infra/tools/native/*
 * （fs / web / shell / swarm / session / memory / integration）。
 * 本文件只保留：域注册入口 + Swarm 权限闸门 + Mock 拦截 + registry 分发。
 * 新增 native 工具 = 在对应域文件加 schema + handler（开闭原则，勿改本文件分发逻辑）。
 */

import { DEFAULT_AGENT_NATIVE } from "@knowpilot/shared";
import { checkToolPermission } from "./swarmPermissionGuard.js";
import { hasMockNativeTool, executeMockNativeTool } from "./mockNativeTools.js";
import { getTool, listTools } from "./tools/registry.js";
import type { NativeToolContext, NativeToolDefinition } from "./tools/native/types.js";

// 域副作用注册（fs/web/shell/swarm/session/memory/integration）
import { registerNativeDomains } from "./tools/native/index.js";

export type { NativeToolContext, NativeToolDefinition } from "./tools/native/types.js";
export {
  syncSearchEnvFromConfig,
  isUnreadableArticlePage,
  readArticleContentWarning,
} from "./tools/native/web.js";

/** 域工具灌入统一注册表（唯一注册路径：registerNativeDomains） */
let nativeToolsRegistered = false;
function ensureNativeToolsRegistered(): void {
  // 测试清空 registry 后需能重新灌入；探测两个不同域的工具防部分注册
  if (nativeToolsRegistered && getTool("read_file") && getTool("agent_create")) return;
  registerNativeDomains();
  nativeToolsRegistered = true;
}
ensureNativeToolsRegistered();

export function listNativeTools(): NativeToolDefinition[] {
  ensureNativeToolsRegistered();
  return listTools("native").map((t) => {
    const s = t.schema();
    return { name: t.name, description: s.description, parameters: s.parameters };
  });
}

/** 异步任务工具统一命名空间：async_task_{run|status|wait|cancel}。
 * 旧名 run_async/task_status/await_async/cancel_async 已废弃并移除。 */
export const TOOL_NAME_ALIASES: Record<string, string> = {};

export async function executeNativeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: NativeToolContext,
): Promise<unknown> {
  ensureNativeToolsRegistered();
  const resolvedName = TOOL_NAME_ALIASES[name] ?? name;

  // Swarm 权限硬拦截：检查 agent 是否有权调用此工具
  if (ctx.agentSnapshot?.tier) {
    const permError = checkToolPermission(name, args, {
      agentTier: ctx.agentSnapshot.tier,
      agentId: ctx.agentSnapshot.id,
      agentWorkspaceId: ctx.agentSnapshot.workspaceId,
      inToolRound: ctx.inToolRound ?? false,
    });
    if (permError) {
      return {
        error: `[${permError.code}] ${permError.reason}`,
        permissionDenied: true,
      };
    }
  }

  // Mock 模式：命中已覆盖的 native 工具则走 Mock 实现，避免真实网络调用
  if (process.env.MOCK_NATIVE_TOOLS === "true") {
    if (hasMockNativeTool(name)) {
      return executeMockNativeTool(name, args, ctx);
    }
  }

  const cmd = getTool(resolvedName);
  if (!cmd || cmd.kind !== "native") {
    throw new Error(
      `未知原生工具 "${resolvedName}"（原始名 "${name}"）。可用：${listTools("native")
        .map((t) => t.name)
        .join(", ")}`,
    );
  }
  const started = Date.now();
  const raw = await cmd.execute(args, ctx);
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.elapsedMs !== "number") {
      return { ...obj, elapsedMs: Date.now() - started };
    }
  }
  return raw;
}

export function resolveAllowedNativeTools(agentTools: string[]): string[] | "all" {
  const native = agentTools.filter((t) => t.startsWith("native:")).map((t) => t.replace(/^native:/, ""));
  if (agentTools.length === 0) return "all";
  if (native.length === 0) return [...DEFAULT_AGENT_NATIVE];
  return native;
}

export function buildNativeToolSchemas(allowed: string[] | "all") {
  ensureNativeToolsRegistered();
  const cmds =
    allowed === "all"
      ? listTools("native")
      : listTools("native").filter((t) => allowed.includes(t.name));
  return cmds.map((t) => {
    const s = t.schema();
    return {
      type: "function" as const,
      function: { name: t.name, description: s.description, parameters: s.parameters },
    };
  });
}
