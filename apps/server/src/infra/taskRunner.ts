/**
 * TaskRunner — 后台任务实际执行逻辑
 */

import type { PrismaClient } from "@prisma/client";
import { runContentSync } from "../scripts/sync.js";

interface TaskRecord {
  id: string;
  name: string;
  type: string;
  input?: unknown;
}

function parseInput(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

function inferAction(task: TaskRecord, input: Record<string, unknown>): string {
  if (typeof input.action === "string") return input.action;
  const name = task.name.toLowerCase();
  if (name.includes("sync") || name.includes("同步")) return "db:sync";
  return "noop";
}

/** 执行单个 Task 并返回 output 对象 */
export async function executeTaskJob(
  prisma: PrismaClient,
  task: TaskRecord,
): Promise<Record<string, unknown>> {
  const input = parseInput(task.input);
  const action = inferAction(task, input);

  if (action === "db:sync") {
    const results = await runContentSync(prisma);
    return {
      action: "db:sync",
      synced: results.reduce((sum, r) => sum + r.upserted, 0),
      entities: results.map((r) => ({
        name: r.entityName,
        scanned: r.scanned,
        upserted: r.upserted,
        cleaned: r.cleaned,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  return {
    action: "noop",
    message: `任务「${task.name}」已执行；可在 input.action 中指定 db:sync 等动作。`,
    timestamp: new Date().toISOString(),
  };
}
