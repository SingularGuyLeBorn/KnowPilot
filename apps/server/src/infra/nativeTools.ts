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
import { recordViolation } from "./constraintEvolution.js";
import { hasMockNativeTool, executeMockNativeTool } from "./mockNativeTools.js";
import { getTool, listTools } from "./tools/registry.js";
import type { NativeToolContext, NativeToolDefinition } from "./tools/native/types.js";
import {
  injectExpectPropsIntoParameters,
  peelExpectControls,
} from "./keyInfoExtractor.js";

// 域副作用注册（fs/web/shell/swarm/session/memory/integration）
import { registerNativeDomains } from "./tools/native/index.js";

export type { NativeToolContext, NativeToolDefinition } from "./tools/native/types.js";
export {
  syncSearchEnvFromConfig,
  isUnreadableArticlePage,
  readArticleContentWarning,
} from "./tools/native/web.js";

/**
 * P2-03：从 ToolCommand.schema().parameters 读 required 数组，返回 args 缺失的必填字段名。
 * 仅做轻量存在性校验（undefined/null 视为缺失；空字符串留给 handler 自行 trim 校验），
 * 避免引入 ajv 依赖；类型/格式校验仍由 handler 内 zod 负责。
 */
function checkRequiredParams(cmd: { schema(): { parameters: Record<string, unknown> } }, args: Record<string, unknown>): string[] {
  try {
    const params = cmd.schema().parameters;
    const required = params?.required;
    if (!Array.isArray(required)) return [];
    return required.filter((field) => {
      const v = args[field];
      return v === undefined || v === null;
    }).map((f) => String(f));
  } catch {
    return [];
  }
}

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

export async function executeNativeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: NativeToolContext,
): Promise<unknown> {
  ensureNativeToolsRegistered();

  // expect_* 是上下文层控制参数，剥掉后再进权限/handler，避免污染业务入参
  const { cleanArgs } = peelExpectControls(args);

  // Swarm 权限硬拦截：检查 agent 是否有权调用此工具
  if (ctx.agentSnapshot?.tier) {
    const permError = checkToolPermission(name, cleanArgs, {
      agentTier: ctx.agentSnapshot.tier,
      agentId: ctx.agentSnapshot.id,
      agentWorkspaceId: ctx.agentSnapshot.workspaceId,
      inToolRound: ctx.inToolRound ?? false,
    });
    if (permError) {
      recordViolation(
        ctx.agentSnapshot.id,
        permError.code,
        { toolName: name, message: permError.reason },
        ctx.config,
      );
      return {
        error: `[${permError.code}] ${permError.reason}`,
        permissionDenied: true,
      };
    }
  }

  // Mock 模式：命中已覆盖的 native 工具则走 Mock 实现，避免真实网络调用
  if (process.env.MOCK_NATIVE_TOOLS === "true") {
    if (hasMockNativeTool(name)) {
      return executeMockNativeTool(name, cleanArgs, ctx);
    }
  }

  const cmd = getTool(name);
  if (!cmd || cmd.kind !== "native") {
    throw new Error(
      `未知原生工具 "${name}"。可用：${listTools("native")
        .map((t) => t.name)
        .join(", ")}`,
    );
  }
  // P2-03：执行前用 schema 的 required 字段做轻量入参校验，缺必填字段直接返回结构化错误给 LLM 下轮修正，
  // 不进 handler（避免 handler 因字段缺失抛非结构化异常或误用默认值）。
  const missing = checkRequiredParams(cmd, cleanArgs);
  if (missing.length > 0) {
    return {
      error: `工具 ${name} 缺少必填参数: ${missing.join(", ")}。请检查参数后重试。`,
      validationError: true,
      missingParams: missing,
    };
  }
  // D 类工具回滚栈（W6）：本 run 携带 rollbackStack 时，执行前快照、成功后入栈；
  // 执行失败的工具不入栈（未产生副作用，无需补偿）
  const stack = cmd.destructive ? ctx.rollbackStack : undefined;
  const artifact = stack ? await stack.capture(cmd, cleanArgs, ctx) : undefined;
  const started = Date.now();
  const raw = await cmd.execute(cleanArgs, ctx);
  if (stack && artifact) {
    try {
      await stack.commit(cmd, cleanArgs, raw, artifact);
    } catch (commitErr) {
      console.warn(
        `[nativeTools] rollback commit 失败 tool=${name}:`,
        commitErr instanceof Error ? commitErr.message : String(commitErr),
      );
      // commit 失败不影响工具结果返回给 LLM，但日志告警供排查
    }
  }
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
  // P0-01 对齐：空数组返回默认只读集（不再 "all"），与 parseAgentTools 语义一致
  if (agentTools.length === 0) return [...DEFAULT_AGENT_NATIVE];
  if (native.length === 0) return [...DEFAULT_AGENT_NATIVE];
  return native;
}

export function buildNativeToolSchemas(allowed: string[] | "all") {
  ensureNativeToolsRegistered();
  const cmds =
    allowed === "all"
      ? // P1-03：native:"all" 时跳过 defaultHidden=true 的危险工具（run_shell/git_push/file_delete 等），
        // Agent 想用必须显式 `native:<name>` 声明。显式列表不受此限（已声明即授权）。
        listTools("native").filter((t) => !t.defaultHidden)
      : listTools("native").filter((t) => allowed.includes(t.name));
  return cmds.map((t) => {
    const s = t.schema();
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: s.description,
        parameters: injectExpectPropsIntoParameters(
          (s.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
        ),
      },
    };
  });
}
