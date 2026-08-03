/**
 * ConstraintEvolution — 错误 → 红线自动进化闭环（P3）
 *
 * 职责：
 * 1. 记录 outputValidator 校验失败与 swarmPermissionGuard 拒绝事件。
 * 2. 同一 Agent 7 天内同类错误 ≥3 次时，自动升级为「已沉淀红线」。
 * 3. 将沉淀的红线通过 contextHooks 注入到该 Agent 的 system prompt「错误记录」层。
 *
 * 设计原则：
 * - 叶子模块，不依赖 prisma / loop；只读写 config/memories/_constraints/{agentId}.md。
 * - 所有 IO 异常降级（warn），不能 blocker 主流程。
 * - 记录操作幂等：重复相同错误只追加 violation 历史，promoted 只升级一次。
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { dump as yamlDump } from "js-yaml";
import { getAppConfig } from "./config.js";
import type { AppConfig } from "./config.js";

const CONSTRAINT_DIR_NAME = "_constraints";
const PROMOTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROMOTION_THRESHOLD = 3;
const MAX_VIOLATIONS_HISTORY = 100;

export interface ViolationContext {
  filePath?: string;
  toolName?: string;
  message?: string;
}

export interface ViolationRecord {
  code: string;
  at: string; // ISO
  context?: ViolationContext;
}

export interface PromotedConstraint {
  code: string;
  since: string; // ISO
  rule: string;
}

export interface ConstraintEvolutionFile {
  agentId: string;
  updatedAt: string;
  violations: ViolationRecord[];
  promoted: PromotedConstraint[];
}

/** 错误码 → 默认红线文案（保持可执行，与 outputValidator / permissionGuard 错误对齐） */
const DEFAULT_RULES: Record<string, string> = {
  MD_FRONTMATTER_INVALID:
    "Markdown frontmatter 必须是合法 YAML；落盘前请按 outputValidator 修复建议修正。",
  MD_FRONTMATTER_MISSING_TITLE:
    "content/ 下的 Markdown 文章 frontmatter 必须包含 `title: \"…\"`。",
  MD_PSEUDO_MATH_UNICODE:
    "数学公式禁止用 Unicode 伪符号（√、ₖ、ᵀ、·、Σ、≈ 等），必须用 $...$ / $$...$$ 包裹 LaTeX。",
  MD_IMAGE_EMPTY_URL: "Markdown 图片链接不能为空，应放入 content/uploads/ 并使用相对路径。",
  MD_IMAGE_ABSOLUTE_WINDOWS_PATH:
    "Markdown 图片禁止使用 Windows 绝对路径，应使用 content/uploads/ 相对路径。",
  MD_IMAGE_FILE_PROTOCOL: "Markdown 图片禁止使用 file:// 协议，应使用相对路径或完整 URL。",
  MD_IMAGE_ABSOLUTE_UNIX_PATH:
    "Markdown 图片禁止使用 Unix 绝对路径，应使用 content/uploads/ 相对路径或完整 URL。",
  TS_SYNTAX_ERROR:
    "TypeScript/TSX 代码必须通过语法检查（tsc --noEmit），修正语法错误后再落盘。",
  TS_VALIDATOR_ERROR:
    "TypeScript 校验器异常，请检查明显语法错误后重试；仍失败请 ask_user。",
  TIER_INSUFFICIENT:
    "当前 Agent 层级无权调用该工具；请换用允许的工具或派更高级别 Agent 执行。",
  CROSS_WORKSPACE_FORBIDDEN: "禁止跨 Workspace 操作；只能操作本 Workspace 内的资源。",
  SELF_DELETE_FORBIDDEN: "禁止删除自己。",
  UPWARD_MESSAGE_IN_TOOL_ROUND:
    "向上级发消息只能在最终回复中进行，工具调用轮次请用 agent_report_back 交付结果。",
  SAME_TIER_MESSAGING_FORBIDDEN: "同级 Agent 之间禁止直接发送消息。",
  UPWARD_REPLY_REQUIRED: "下级 Agent 只能回复上级已发来的消息，禁止主动向上级发起通信。",
  TIER_PROTECTED: "禁止操作超级 Agent。",
};

function getConstraintsDir(config: AppConfig): string {
  return path.join(config.configPaths.memories, CONSTRAINT_DIR_NAME);
}

function getConstraintFilePath(config: AppConfig, agentId: string): string {
  return path.join(getConstraintsDir(config), `${agentId}.md`);
}

function ensureConstraintsDir(config: AppConfig): void {
  const dir = getConstraintsDir(config);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildRuleForCode(code: string, context?: ViolationContext): string {
  const base = DEFAULT_RULES[code];
  if (base) return base;
  if (context?.message) {
    return `${code}：${context.message}`;
  }
  return `${code}：该错误已被记录为红线，请严格避免重复触发。`;
}

function loadConstraintFile(filePath: string): ConstraintEvolutionFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    const data = parsed.data as Partial<ConstraintEvolutionFile>;
    return {
      agentId: String(data.agentId ?? ""),
      updatedAt: String(data.updatedAt ?? ""),
      violations: Array.isArray(data.violations) ? data.violations : [],
      promoted: Array.isArray(data.promoted) ? data.promoted : [],
    };
  } catch (err) {
    console.warn(
      `[constraintEvolution] 读取约束文件失败，将重建：${filePath}`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function countRecentViolations(
  violations: ViolationRecord[],
  code: string,
  windowMs: number,
  now: number,
): number {
  return violations.filter((v) => {
    if (v.code !== code) return false;
    const at = new Date(v.at).getTime();
    return Number.isFinite(at) && now - at <= windowMs;
  }).length;
}

function buildMarkdownBody(promoted: PromotedConstraint[]): string {
  const lines = ["## 已升级为红线的错误", ""];
  if (promoted.length === 0) {
    lines.push("_暂无已升级红线的错误。_");
  } else {
    for (const p of promoted) {
      const date = p.since.slice(0, 10);
      lines.push(`- [${date}] (${p.code}) ${p.rule}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function writeConstraintFile(filePath: string, record: ConstraintEvolutionFile): void {
  const frontmatter = yamlDump({
    agentId: record.agentId,
    updatedAt: record.updatedAt,
    violations: record.violations,
    promoted: record.promoted,
  });
  const body = buildMarkdownBody(record.promoted);
  const content = `---\n${frontmatter}---\n\n${body}`;
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * 记录一次违规事件。
 * 如果 7 天内同类错误达到 3 次，会自动把该错误升级为红线并写入文件。
 * 本函数自身异常会静默降级，不会抛给调用方。
 */
export function recordViolation(
  agentId: string | null | undefined,
  errorCode: string,
  context?: ViolationContext,
  config?: AppConfig,
): void {
  if (!agentId) return;
  try {
    const cfg = config ?? getAppConfig();
    if (!cfg) return;
    ensureConstraintsDir(cfg);
    const filePath = getConstraintFilePath(cfg, agentId);
    const now = Date.now();
    const existing = loadConstraintFile(filePath);
    const record: ConstraintEvolutionFile = existing ?? {
      agentId,
      updatedAt: nowIso(),
      violations: [],
      promoted: [],
    };

    record.violations.push({
      code: errorCode,
      at: nowIso(),
      context: context && Object.keys(context).length > 0 ? context : undefined,
    });
    if (record.violations.length > MAX_VIOLATIONS_HISTORY) {
      record.violations = record.violations.slice(-MAX_VIOLATIONS_HISTORY);
    }

    const alreadyPromoted = record.promoted.some((p) => p.code === errorCode);
    if (!alreadyPromoted) {
      const recent = countRecentViolations(
        record.violations,
        errorCode,
        PROMOTION_WINDOW_MS,
        now,
      );
      if (recent >= PROMOTION_THRESHOLD) {
        record.promoted.push({
          code: errorCode,
          since: nowIso(),
          rule: buildRuleForCode(errorCode, context),
        });
      }
    }

    record.updatedAt = nowIso();
    writeConstraintFile(filePath, record);
  } catch (err) {
    console.warn(
      `[constraintEvolution] 记录违规失败（已降级）：`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * 读取某 Agent 的已升级红线，返回可注入 system prompt 的 Markdown 块。
 * 无红线时返回 null。
 */
export function getConstraintEvolutionBlock(
  agentId: string | null | undefined,
  config?: AppConfig,
): string | null {
  if (!agentId) return null;
  try {
    const cfg = config ?? getAppConfig();
    if (!cfg) return null;
    const filePath = getConstraintFilePath(cfg, agentId);
    const record = loadConstraintFile(filePath);
    if (!record || record.promoted.length === 0) return null;
    const lines = ["## 错误记录（运行时沉淀的教训）", ""];
    for (const p of record.promoted) {
      const date = p.since.slice(0, 10);
      lines.push(`- [${date}] **${p.code}**：${p.rule}`);
    }
    lines.push("");
    return lines.join("\n");
  } catch (err) {
    console.warn(
      `[constraintEvolution] 读取红线块失败（已降级）：`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** 将红线块融入现有 system prompt，替换或追加到「错误记录」小节 */
export function injectConstraintBlock(
  systemPrompt: string,
  block: string,
): string {
  if (!block) return systemPrompt;
  const headingRe = /^##\s+错误记录/im;
  if (!headingRe.test(systemPrompt)) {
    return `${systemPrompt}\n\n${block}`.trim();
  }

  // 找到「## 错误记录」小节，替换其内容直到下一个 ## 标题
  const lines = systemPrompt.split("\n");
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (headingRe.test(line)) {
      // 写入新的错误记录块
      result.push(...block.trim().split("\n"));
      i++;
      // 跳过原小节内容直到下一个 ## 标题
      while (i < lines.length && !lines[i]!.startsWith("## ")) {
        i++;
      }
      continue;
    }
    result.push(line);
    i++;
  }
  return result.join("\n");
}

/** 测试隔离：直接读取约束文件原始内容 */
export function readConstraintFileRaw(
  agentId: string,
  config: AppConfig,
): { data: ConstraintEvolutionFile; body: string } | null {
  const filePath = getConstraintFilePath(config, agentId);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  return {
    data: {
      agentId: String(parsed.data.agentId ?? ""),
      updatedAt: String(parsed.data.updatedAt ?? ""),
      violations: Array.isArray(parsed.data.violations) ? parsed.data.violations : [],
      promoted: Array.isArray(parsed.data.promoted) ? parsed.data.promoted : [],
    },
    body: parsed.content,
  };
}

