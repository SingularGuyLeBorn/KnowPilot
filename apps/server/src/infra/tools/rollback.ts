/**
 * RunRollbackStack — run 级 D 类（destructive）工具回滚栈
 *
 * 设计：
 * - reactLoop 每 run 建一个栈，经 NativeToolContext.rollbackStack 注入工具上下文；
 * - executeNativeTool 在执行 destructive 工具前 capture（快照）、成功后 commit（入栈）；
 * - run 进入 failed 且非用户 abort 时，reactLoop 调 rollbackAll 逆序补偿；
 * - 补偿必须幂等（二次执行不产生新副作用）；不可逆操作（git_commit 等）只记 warn，如实声明。
 *
 * 叶子模块：只允许 import ./types.js，禁止 import 环内模块（nativeTools/agentTools/reactLoop…）。
 */

import type { ToolCommand } from "./types.js";

/** run 级快照总容量上限（按 JSON 字符数近似计量）：超出后不再快照，对应条目标记不可回滚并 warn */
export const ROLLBACK_SNAPSHOT_CAP_CHARS = 10 * 1024 * 1024;

export interface RollbackEntryOutcome {
  toolName: string;
  status: "rolled_back" | "warn" | "failed";
  message: string;
}

export interface RunRollbackReport {
  reason: "run_failed";
  /** 补偿执行顺序（逆序于工具执行顺序） */
  entries: RollbackEntryOutcome[];
  rolledBack: number;
  warned: number;
  failed: number;
  completedAt: string;
}

interface StackEntry {
  cmd: ToolCommand;
  args: Record<string, unknown>;
  captured: unknown;
  /** 快照被容量上限拒绝等原因 → 不可回滚（rollbackAll 时记 warn） */
  unrecoverable?: string;
  result: unknown;
}

/** capture 的返回工件；execute 成功后由 commit 一并入栈 */
export interface CaptureArtifact {
  captured: unknown;
  unrecoverable?: string;
}

function measureChars(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export class RunRollbackStack {
  private entries: StackEntry[] = [];
  private snapshotChars = 0;
  private capExceeded = false;
  private report: RunRollbackReport | null = null;

  constructor(private readonly opts?: { snapshotCapChars?: number }) {}

  private get cap(): number {
    return this.opts?.snapshotCapChars ?? ROLLBACK_SNAPSHOT_CAP_CHARS;
  }

  /** 本 run 已入栈的 destructive 工具条数 */
  get size(): number {
    return this.entries.length;
  }

  /**
   * 工具执行前调用：对实现 captureRollback 的 destructive 工具做快照。
   * 快照总量超上限 → 本条目不存快照并标记不可回滚（不阻断工具执行）。
   */
  async capture(cmd: ToolCommand, args: Record<string, unknown>, ctx: unknown): Promise<CaptureArtifact> {
    if (!cmd.captureRollback) return { captured: undefined };
    if (this.capExceeded) {
      return { captured: undefined, unrecoverable: `回滚快照总容量超上限（${this.cap} 字符），未快照，需人工检查` };
    }
    const captured = await cmd.captureRollback(args, ctx);
    const size = measureChars(captured);
    if (this.snapshotChars + size > this.cap) {
      this.capExceeded = true;
      console.warn(`[Rollback] 工具 ${cmd.name} 快照 ${size} 字符，超出 run 级上限 ${this.cap}，标记不可回滚`);
      return { captured: undefined, unrecoverable: `回滚快照 ${size} 字符超出 run 级上限（${this.cap}），未快照，需人工检查` };
    }
    this.snapshotChars += size;
    return { captured };
  }

  /** 工具执行成功后调用：条目入栈（执行失败的工具不入栈，无需补偿） */
  commit(cmd: ToolCommand, args: Record<string, unknown>, result: unknown, artifact: CaptureArtifact): void {
    this.entries.push({ cmd, args, captured: artifact.captured, unrecoverable: artifact.unrecoverable, result });
  }

  /**
   * run 失败（非用户 abort）→ 逆序补偿。
   * 幂等：重复调用返回同一份报告，不二次执行补偿。
   * 无 D 类工具执行过 → 返回 null（不产生空报告）。
   */
  async rollbackAll(ctx: unknown): Promise<RunRollbackReport | null> {
    if (this.report) return this.report;
    if (this.entries.length === 0) return null;

    const outcomes: RollbackEntryOutcome[] = [];
    for (const entry of [...this.entries].reverse()) {
      const { cmd, args } = entry;
      if (entry.unrecoverable) {
        outcomes.push({ toolName: cmd.name, status: "warn", message: entry.unrecoverable });
        continue;
      }
      if (!cmd.rollback) {
        outcomes.push({
          toolName: cmd.name,
          status: "warn",
          message: "不可逆操作：未实现自动回滚，需人工 revert / 检查",
        });
        continue;
      }
      try {
        const note = await cmd.rollback(args, entry.result, entry.captured, ctx);
        outcomes.push({ toolName: cmd.name, status: "rolled_back", message: note || "已回滚" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Rollback] 工具 ${cmd.name} 回滚失败:`, msg);
        outcomes.push({ toolName: cmd.name, status: "failed", message: `回滚失败：${msg}，需人工处理` });
      }
    }

    this.report = {
      reason: "run_failed",
      entries: outcomes,
      rolledBack: outcomes.filter((e) => e.status === "rolled_back").length,
      warned: outcomes.filter((e) => e.status === "warn").length,
      failed: outcomes.filter((e) => e.status === "failed").length,
      completedAt: new Date().toISOString(),
    };
    return this.report;
  }
}
