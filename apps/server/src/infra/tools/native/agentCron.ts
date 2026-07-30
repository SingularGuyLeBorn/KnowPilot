/**
 * Agent 自设 cron 工具：agent_cron_set / list / clear
 *
 * 权限：sub 禁止；manager 只能操作自己；super 可操作任意 Agent。
 * 每次 cron 点火由 AgentCronEngine 新建 kind=cron 会话并注入 prompt（可选 busPath）。
 */
import cron from "node-cron";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";
import {
  deleteCronJob,
  getCronJobById,
  getCronJobByName,
  listCronJobs,
  upsertCronJob,
} from "../../agentCronStore.js";

function operatorTier(ctx: NativeToolContext): string {
  return ctx.agentSnapshot?.tier ?? "sub";
}

function operatorId(ctx: NativeToolContext): string | null {
  return ctx.agentSnapshot?.id ?? null;
}

/** 解析目标 agentId：默认自己；校验权限 */
function resolveTargetAgentId(
  ctx: NativeToolContext,
  requested?: unknown,
): { agentId: string } | { error: string } {
  const tier = operatorTier(ctx);
  const selfId = operatorId(ctx);
  if (tier === "sub") {
    return { error: "[TIER_INSUFFICIENT] 子 Agent 不允许设置/查看/清除 cron 任务。" };
  }
  if (!selfId) {
    return { error: "缺少调用方 Agent 身份，无法操作 cron。" };
  }
  const target = requested ? String(requested) : selfId;
  if (tier !== "super" && target !== selfId) {
    return {
      error: "[SELF_ONLY] 管理 Agent 只能为自己设置 cron；跨 Agent 仅超级 Agent 可操作。",
    };
  }
  return { agentId: target };
}

async function ensureTargetAllowed(
  ctx: NativeToolContext,
  agentId: string,
): Promise<string | null> {
  const agent = await ctx.services.prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, tier: true, status: true, name: true },
  });
  if (!agent || agent.status === "deleted") return "目标 Agent 不存在";
  if (agent.tier === "sub") {
    return "不能给子 Agent 设置 cron（子 Agent 不允许持有定时任务）";
  }
  return null;
}

async function cronSetTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const target = resolveTargetAgentId(ctx, args.agentId);
  if ("error" in target) return { error: target.error };

  const name = String(args.name ?? "").trim();
  const cronExpr = String(args.cron ?? "").trim();
  const prompt = String(args.prompt ?? "").trim();
  if (!name) return { error: "name 不能为空（同 Agent 内唯一标识）" };
  if (!cronExpr) return { error: "cron 不能为空，如 \"0 9 * * *\"" };
  if (!cron.validate(cronExpr)) {
    return { error: `非法 cron 表达式：${cronExpr}（需标准 5 段，如 0 9 * * *）` };
  }
  if (prompt.length < 8) {
    return { error: "prompt 过短：请写清每次点火时 Agent 要做的详细初始任务说明" };
  }

  const deny = await ensureTargetAllowed(ctx, target.agentId);
  if (deny) return { error: deny };

  const enabled = args.enabled === undefined ? true : Boolean(args.enabled);
  const busPath =
    args.busPath === undefined || args.busPath === null || args.busPath === ""
      ? null
      : String(args.busPath);

  const row = await upsertCronJob(ctx.services.prisma, {
    agentId: target.agentId,
    name,
    cron: cronExpr,
    prompt,
    busPath,
    enabled,
  });

  try {
    const { getAgentCronEngine } = await import("../../agentCronEngine.js");
    const { getAppConfig } = await import("../../config.js");
    await getAgentCronEngine(ctx.services.prisma, ctx.services, getAppConfig()).refreshAgent(
      target.agentId,
    );
  } catch (err) {
    console.warn(
      "[agent_cron_set] 热刷新调度失败（进程重启后仍会加载）:",
      err instanceof Error ? err.message : err,
    );
  }
  try {
    const { notifyCronJobUpdated } = await import("../../uiStateNotify.js");
    await notifyCronJobUpdated(ctx.services.prisma, row);
  } catch {
    /* ignore */
  }

  return {
    success: true,
    job: {
      id: row.id,
      agentId: row.agentId,
      name: row.name,
      cron: row.cron,
      enabled: row.enabled,
      busPath: row.busPath,
      promptChars: row.prompt.length,
      note: "每次触发会新建 ChatSession（kind=cron），注入 prompt；busPath 有则拼进首条消息。",
    },
  };
}

async function cronListTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const target = resolveTargetAgentId(ctx, args.agentId);
  if ("error" in target) return { error: target.error };

  const rows = await listCronJobs(ctx.services.prisma, { agentId: target.agentId });
  return {
    agentId: target.agentId,
    total: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      cron: r.cron,
      enabled: r.enabled,
      busPath: r.busPath,
      promptPreview: r.prompt.slice(0, 160),
      lastRunAt: r.lastRunAt,
      lastRunStatus: r.lastRunStatus,
      lastSessionId: r.lastSessionId,
    })),
  };
}

async function cronClearTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const target = resolveTargetAgentId(ctx, args.agentId);
  if ("error" in target) return { error: target.error };

  const id = args.id ? String(args.id) : "";
  const name = args.name ? String(args.name).trim() : "";
  if (!id && !name) return { error: "需要 id 或 name" };

  if (id) {
    const existing = await getCronJobById(ctx.services.prisma, id);
    if (!existing) return { error: "cron 任务不存在" };
    if (existing.agentId !== target.agentId) {
      // super 传了别人的 id 但 agentId 默认自己时：若 super 且未指定 agentId，允许按 id 删
      if (operatorTier(ctx) !== "super") {
        return { error: "[SELF_ONLY] 只能清除自己的 cron 任务" };
      }
      // super 按 id 清除任意
      const { deleted } = await deleteCronJob(ctx.services.prisma, { id });
      await refreshSafe(ctx, existing.agentId);
      await notifyCronCleared(ctx, existing.agentId, existing.id, existing.name);
      return { success: true, deleted };
    }
  }

  if (name) {
    const existing = await getCronJobByName(ctx.services.prisma, target.agentId, name);
    if (!existing) return { error: `未找到 name=${name} 的 cron` };
  }

  const before =
    id
      ? await getCronJobById(ctx.services.prisma, id)
      : await getCronJobByName(ctx.services.prisma, target.agentId, name);
  const { deleted } = await deleteCronJob(ctx.services.prisma, {
    id: id || undefined,
    agentId: id ? undefined : target.agentId,
    name: id ? undefined : name,
  });
  await refreshSafe(ctx, target.agentId);
  if (before) await notifyCronCleared(ctx, before.agentId, before.id, before.name);
  return { success: true, deleted };
}

async function refreshSafe(ctx: NativeToolContext, agentId: string): Promise<void> {
  try {
    const { getAgentCronEngine } = await import("../../agentCronEngine.js");
    const { getAppConfig } = await import("../../config.js");
    await getAgentCronEngine(ctx.services.prisma, ctx.services, getAppConfig()).refreshAgent(
      agentId,
    );
  } catch {
    // ignore
  }
}

async function notifyCronCleared(
  ctx: NativeToolContext,
  agentId: string,
  jobId: string,
  name: string,
): Promise<void> {
  try {
    const { notifyCronJobUpdated } = await import("../../uiStateNotify.js");
    await notifyCronJobUpdated(ctx.services.prisma, {
      id: jobId,
      agentId,
      name,
      lastRunStatus: "cancelled",
    });
  } catch {
    /* ignore */
  }
}

const DEFS: NativeToolDefinition[] = [
  {
    name: "agent_cron_set",
    concurrencyClass: "A",
    description:
      "为 Agent 设置/更新 cron 定时任务（manager 只能设自己；super 可指定 agentId）。" +
      "每次触发会新建 ChatSession（kind=cron）并注入详细 prompt；可选 busPath（Workspace 相对路径）作为 file-as-bus 拼进首条消息。" +
      "子 Agent 禁止。cron 为 5 段表达式，如 \"0 9 * * *\"。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "任务名（同 Agent 内唯一，用于 upsert）" },
        cron: { type: "string", description: "5 段 cron，如 0 9 * * *" },
        prompt: {
          type: "string",
          description: "每次点火注入的详细初始任务说明（越具体越好）",
        },
        busPath: {
          type: "string",
          description: "可选：相对 Workspace 的状态文件路径，点火时读入拼进首条消息",
        },
        enabled: { type: "boolean", description: "默认 true" },
        agentId: { type: "string", description: "目标 Agent；默认自己；仅 super 可设他人" },
      },
      required: ["name", "cron", "prompt"],
    },
  },
  {
    name: "agent_cron_list",
    concurrencyClass: "B",
    description: "列出 Agent 的 cron 任务。manager 只看自己；super 可传 agentId。",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "目标 Agent；默认自己" },
      },
    },
  },
  {
    name: "agent_cron_clear",
    concurrencyClass: "A",
    description: "删除 cron 任务（id 或 name）。manager 只能删自己的；super 可删任意。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        agentId: { type: "string", description: "配合 name；默认自己" },
      },
    },
  },
];

const HANDLERS: Record<string, NativeToolHandler> = {
  agent_cron_set: cronSetTool,
  agent_cron_list: cronListTool,
  agent_cron_clear: cronClearTool,
};

export function registerAgentCronTools(): void {
  registerNativeDomain(DEFS, HANDLERS);
}
