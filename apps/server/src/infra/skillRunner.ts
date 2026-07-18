/**
 * Skill 执行器 — 加载 Skill 并支持 Prompt 模式 / TS 沙箱执行
 */

import vm from "node:vm";
import type { ServiceContainer } from "./serviceContainer.js";
import type { SkillEntity } from "../services.js";

const SKILL_TIMEOUT_MS = 8_000;

export function skillToolName(skillName: string): string {
  return `skill__${skillName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function parseSkillToolName(toolName: string): string | null {
  if (!toolName.startsWith("skill__")) return null;
  return toolName.slice(7);
}

export async function findSkillByName(services: ServiceContainer, name: string): Promise<SkillEntity> {
  const list = await services.skill.list({ page: 1, pageSize: 100, keyword: name, enabled: true });
  const exact = list.items.find((s) => s.name === name);
  if (exact) return exact;
  const fuzzy = list.items.find((s) => s.name.includes(name) || name.includes(s.name));
  if (fuzzy) return fuzzy;
  throw new Error(`Skill "${name}" 不存在或未启用。请先在 /skills 创建或在 content/skills/ 添加配置后 db:sync。`);
}

/**
 * A2：批量按 name 加载多个 Skill，一次 list 查询替代 N 次 findSkillByName。
 * 先精确匹配；未命中的 name 保留 fuzzy 兜底（与 findSkillByName 行为一致）。
 * 返回 Map<请求的 name, SkillEntity>，未命中的 name 不在 Map 中。
 */
export async function findSkillsByNames(
  services: ServiceContainer,
  names: string[],
): Promise<Map<string, SkillEntity>> {
  const result = new Map<string, SkillEntity>();
  if (names.length === 0) return result;
  const list = await services.skill.list({ page: 1, pageSize: 200, enabled: true });
  const byName = new Map<string, SkillEntity>();
  for (const s of list.items) byName.set(s.name, s);
  for (const name of names) {
    const exact = byName.get(name);
    if (exact) {
      result.set(name, exact);
      continue;
    }
    const fuzzy = list.items.find((s) => s.name.includes(name) || name.includes(s.name));
    if (fuzzy) result.set(name, fuzzy);
  }
  return result;
}

export function buildSkillToolSchema(skill: SkillEntity) {
  return {
    type: "function" as const,
    function: {
      name: skillToolName(skill.name),
      description: skill.description || `执行 Skill「${skill.name}」`,
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "要交给该技能处理的内容或任务描述" },
          context: { type: "string", description: "可选背景信息，如相关文件路径、代码片段" },
        },
        required: ["input"],
      },
    },
  };
}

function isExecutableSkillCode(code: string): boolean {
  return (
    /\bfunction\s+run\s*\(/.test(code) ||
    /\bexport\s+(default\s+)?(async\s+)?function\s+run/.test(code) ||
    /\bconst\s+run\s*=/.test(code) ||
    /\bmodule\.exports\s*=/.test(code) ||
    /```(?:typescript|ts|javascript|js)/.test(code)
  );
}

function extractCodeBody(raw: string): string {
  const fenced = raw.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}

/** 在 Node vm 沙箱中执行 Skill TS/JS 代码（须定义 run(input, context?)） */
export function executeSkillInSandbox(
  skill: SkillEntity,
  input: string,
  context?: string,
): Promise<{ mode: "sandbox"; skill: string; result: unknown; logs: string[] }> {
  const code = extractCodeBody(skill.code);
  const logs: string[] = [];

  const sandbox: vm.Context = {
    input,
    context,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => logs.push(`[warn] ${args.map(String).join(" ")}`),
      error: (...args: unknown[]) => logs.push(`[error] ${args.map(String).join(" ")}`),
    },
    module: { exports: {} as unknown },
    exports: {} as Record<string, unknown>,
  };

  const wrapped = `
"use strict";
${code}

const __fn =
  (typeof run === "function" ? run : null) ||
  (typeof module !== "undefined" && module.exports && typeof module.exports === "function" ? module.exports : null) ||
  (typeof module !== "undefined" && module.exports && typeof module.exports.run === "function" ? module.exports.run : null) ||
  (typeof exports !== "undefined" && typeof exports.default === "function" ? exports.default : null);

if (!__fn) {
  throw new Error("Skill 可执行代码须定义 run(input, context?) 函数或 module.exports = run");
}
__fn(input, context);
`;

  const script = new vm.Script(wrapped, { filename: `skill://${skill.name}` });

  const run = () => {
    const value = script.runInNewContext(sandbox, { timeout: SKILL_TIMEOUT_MS });
    if (value && typeof (value as Promise<unknown>).then === "function") {
      // 修复：原实现用 Promise.race + setTimeout，但 setTimeout 在 skill 正常完成后
      // 仍未清除，导致 timer 持有 reject 闭包 8 秒不被 GC。改为手动 clearTimeout。
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Skill「${skill.name}」执行超时（${SKILL_TIMEOUT_MS}ms）`)),
          SKILL_TIMEOUT_MS,
        );
        (value as Promise<unknown>).then(
          (result) => { clearTimeout(timer); resolve(result); },
          (err) => { clearTimeout(timer); reject(err); },
        );
      });
    }
    return value;
  };

  return Promise.resolve()
    .then(run)
    .then((result) => ({ mode: "sandbox" as const, skill: skill.name, result, logs }));
}

/** metaJson.stats：Skill 真实使用账本（供 skill_discover 排序，禁止默认 100% 假繁荣） */
export type SkillUsageStats = {
  usageCount: number;
  successCount: number;
  failCount: number;
  /** 0–100，按 successCount/usageCount 四舍五入 */
  successRate: number;
  lastUsedAt: string;
};

export function parseSkillUsageStats(metaJson?: string | null): SkillUsageStats | null {
  if (!metaJson) return null;
  try {
    const meta = JSON.parse(metaJson) as { stats?: Partial<SkillUsageStats> };
    const s = meta.stats;
    if (!s || typeof s.usageCount !== "number" || s.usageCount <= 0) return null;
    const usageCount = s.usageCount;
    const successCount = typeof s.successCount === "number" ? s.successCount : 0;
    const failCount = typeof s.failCount === "number" ? s.failCount : Math.max(0, usageCount - successCount);
    const successRate =
      typeof s.successRate === "number"
        ? s.successRate
        : Math.round((successCount / usageCount) * 100);
    return {
      usageCount,
      successCount,
      failCount,
      successRate,
      lastUsedAt: typeof s.lastUsedAt === "string" ? s.lastUsedAt : "",
    };
  } catch {
    return null;
  }
}

/** 纯函数：累加一次调用结果到 metaJson.stats（单测可直接验） */
export function mergeSkillUsageStats(
  metaJson: string | null | undefined,
  success: boolean,
  now: Date = new Date(),
): { metaJson: string; stats: SkillUsageStats } {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(metaJson || "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const prev = (meta.stats && typeof meta.stats === "object" ? meta.stats : {}) as Partial<SkillUsageStats>;
  const usageCount = (prev.usageCount ?? 0) + 1;
  const successCount = (prev.successCount ?? 0) + (success ? 1 : 0);
  const failCount = (prev.failCount ?? 0) + (success ? 0 : 1);
  const stats: SkillUsageStats = {
    usageCount,
    successCount,
    failCount,
    successRate: Math.round((successCount / usageCount) * 100),
    lastUsedAt: now.toISOString(),
  };
  meta.stats = stats;
  return { metaJson: JSON.stringify(meta), stats };
}

function isSkillExecSuccess(result: unknown): boolean {
  if (result && typeof result === "object" && "error" in result) {
    const err = (result as { error: unknown }).error;
    if (err !== undefined && err !== null && err !== "") return false;
  }
  return true;
}

async function persistSkillUsage(
  services: ServiceContainer,
  skill: SkillEntity,
  success: boolean,
): Promise<void> {
  const update = services.skill?.update;
  if (typeof update !== "function") return;
  try {
    const { metaJson } = mergeSkillUsageStats(skill.metaJson, success);
    await update.call(services.skill, { id: skill.id, metaJson } as never);
  } catch (err) {
    console.warn(
      `[skillRunner] 写入 Skill 使用统计失败（${skill.name}）:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** 执行 Skill：可执行代码走沙箱，否则返回 Prompt 指引；每次调用回写 metaJson.stats */
export async function executeSkill(
  services: ServiceContainer,
  skillRef: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const skill = await findSkillByName(services, skillRef);
  const input = String(args.input ?? "");
  const context = args.context ? String(args.context) : undefined;

  let result: unknown;
  if (isExecutableSkillCode(skill.code)) {
    try {
      result = await executeSkillInSandbox(skill, input, context);
    } catch (err: unknown) {
      result = {
        mode: "sandbox",
        skill: skill.name,
        error: err instanceof Error ? err.message : String(err),
        fallbackInstructions: skill.code.slice(0, 4000),
        input,
        context,
      };
    }
  } else {
    result = {
      mode: "prompt",
      skill: skill.name,
      description: skill.description,
      trigger: skill.trigger,
      instructions: skill.code,
      input,
      context,
      message: `已加载 Skill「${skill.name}」。请严格遵循 instructions 处理 input${context ? "，并结合 context" : ""}。`,
    };
  }

  await persistSkillUsage(services, skill, isSkillExecSuccess(result));
  return result;
}
