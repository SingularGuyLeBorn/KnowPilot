/**
 * 回合后 Skill 后台审查（对标 Hermes agent/background_review.py + turn_finalizer nudge）
 *
 * 主 SSE onDone 之后 fire-and-forget：不阻塞用户。
 * 独立 skill_review 会话（parent=用户会话），工具白名单仅 skills_*；跑完 completed 可打开查看。
 */

import type { AppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import type { StoredToolCall } from "./chatHistory.js";
import { resolveAuxiliaryModel } from "./auxiliaryModel.js";

const reviewLocks = new Set<string>();

/** 复盘旁路仅允许的工具（带 native: 前缀，与 Agent.tools 约定一致） */
export const SKILL_REVIEW_TOOLS = [
  "native:skills_list",
  "native:skill_view",
  "native:skill_manage",
] as const;

export const SKILL_REVIEW_PROMPT = `Review the conversation tool trace above and update the skill library. Be ACTIVE — most complex sessions produce at least one skill update.

Target: CLASS-LEVEL skills with SKILL.md + optional references/. Not one-session-one-skill names.

Signals (any one warrants action):
- User corrected style/workflow/format — embed into the governing skill.
- Non-trivial technique, fix, workaround, or tool-usage pattern emerged.
- A skill that was loaded was wrong/outdated — patch it NOW.

Preference order:
1. UPDATE a skill already viewed/loaded this session (skill_manage patch).
2. UPDATE an existing umbrella (skills_list + skill_view, then patch).
3. ADD references/templates/scripts via skill_manage write_file.
4. CREATE a new class-level umbrella only if nothing covers the class.
   Name MUST NOT be a PR number, error string, or today's task artifact.

Memory ≠ Skill: do NOT use memory tools here. If nothing durable, reply exactly: Nothing to save.
Do NOT capture environment-only failures as permanent "tool broken" constraints.`;

export function countToolCallsForNudge(toolCalls: StoredToolCall[] | undefined | null): number {
  if (!toolCalls?.length) return 0;
  return toolCalls.filter((t) => t.kind === "tool").length;
}

export function shouldNudgeSkillReview(toolCallCount: number, nudgeInterval: number): boolean {
  if (nudgeInterval <= 0) return false;
  return toolCallCount >= nudgeInterval;
}

function buildTraceDigest(toolCalls: StoredToolCall[]): string {
  const tools = toolCalls
    .filter((t) => t.kind === "tool")
    .map((t) => t.name)
    .filter(Boolean);
  const uniq = [...new Set(tools)];
  const viewed = tools.filter((n) => n === "skill_view" || n === "skills_list");
  return [
    `Tool calls this turn: ${tools.length}`,
    `Unique tools: ${uniq.slice(0, 40).join(", ") || "(none)"}`,
    viewed.length ? `Skill disclosure tools used: ${viewed.length}` : "No skills_list/skill_view this turn.",
  ].join("\n");
}

export type SkillReviewSpawnArgs = {
  config: AppConfig;
  services: ServiceContainer;
  agentId: string;
  sessionId: string;
  toolCalls: StoredToolCall[];
  /** 测试可注入 */
  runReview?: (message: string) => Promise<unknown>;
};

/**
 * 若达 nudge 阈值则旁路启动审查。返回是否调度了审查（供单测）。
 */
export function maybeSpawnSkillBackgroundReview(args: SkillReviewSpawnArgs): boolean {
  const interval = args.config.skills?.nudgeInterval ?? 10;
  const count = countToolCallsForNudge(args.toolCalls);
  if (!shouldNudgeSkillReview(count, interval)) return false;

  const lockKey = args.sessionId || args.agentId;
  if (reviewLocks.has(lockKey)) return false;
  reviewLocks.add(lockKey);

  const digest = buildTraceDigest(args.toolCalls);
  const message = `[skill-background-review]\n${digest}\n\n${SKILL_REVIEW_PROMPT}`;

  void (async () => {
    try {
      if (args.runReview) {
        await args.runReview(message);
        return;
      }
      await runDefaultSkillReview(args, message);
    } catch (err) {
      console.warn(
        "[skillBackgroundReview] 审查失败（忽略）:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      reviewLocks.delete(lockKey);
    }
  })();

  return true;
}

/** 测试用：清空 per-session 审查锁 */
export function __resetSkillReviewLocksForTests(): void {
  reviewLocks.clear();
}

async function runDefaultSkillReview(args: SkillReviewSpawnArgs, message: string): Promise<void> {
  const { chatAgent } = await import("./agentRuntime.js");
  const { createTrpcInvoker } = await import("./trpcInvoker.js");

  let mainModel = "";
  try {
    const agent = (await args.services.agent.getById(args.agentId)) as { model?: string };
    mainModel = typeof agent?.model === "string" ? agent.model : "";
  } catch {
    mainModel = "";
  }
  const reviewModel = resolveAuxiliaryModel(args.config, {
    configured: args.config.skills?.reviewModel ?? "auto",
    mainModel: mainModel || "deepseek-chat",
    preference: "strong_free",
  });

  const title = `[skill-review] ${new Date().toISOString().slice(0, 16)}`;
  const created = await args.services.session.create({
    title,
    agentId: args.agentId,
    model: reviewModel,
    kind: "skill_review",
    parentSessionId: args.sessionId,
    status: "running",
    taskDescription: "Skill background review",
  } as never);
  if (!created.success || !created.data) {
    throw new Error(created.error?.message ?? "无法创建 skill-review 会话");
  }
  const reviewSessionId = (created.data as { id: string }).id;
  try {
    const invoke = createTrpcInvoker({ services: args.services });
    await chatAgent(
      args.services,
      args.config,
      { agentId: args.agentId, sessionId: reviewSessionId, message, model: reviewModel },
      invoke,
      { toolsOverride: [...SKILL_REVIEW_TOOLS] },
    );
    await args.services.session
      .update({ id: reviewSessionId, status: "completed" } as never)
      .catch(() => {});
  } catch (err) {
    await args.services.session
      .update({ id: reviewSessionId, status: "failed" } as never)
      .catch(() => {});
    throw err;
  }
}

/** 列出某父会话下的旁路复盘会话（供运行栏） */
export async function listSkillReviewSideRuns(
  services: ServiceContainer,
  parentSessionId: string,
  pageSize = 30,
): Promise<{
  items: Array<{
    id: string;
    title: string;
    status: string;
    model: string;
    updatedAt: string;
    kind: string;
  }>;
}> {
  const res = await services.session.list({
    page: 1,
    pageSize,
    parentSessionId,
    kind: "skill_review",
  });
  return {
    items: res.items.map((s) => {
      const row = s as {
        id: string;
        title?: string;
        status?: string;
        model?: string;
        updatedAt?: Date | string;
        kind?: string;
      };
      const updatedAt =
        typeof row.updatedAt === "string"
          ? row.updatedAt
          : row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : new Date().toISOString();
      return {
        id: row.id,
        title: row.title ?? "[skill-review]",
        status: row.status ?? "active",
        model: row.model ?? "",
        updatedAt,
        kind: row.kind ?? "skill_review",
      };
    }),
  };
}
