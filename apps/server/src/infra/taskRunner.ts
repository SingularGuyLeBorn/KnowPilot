/**
 * TaskRunner — 后台任务实际执行逻辑
 */

import type { PrismaClient } from "@prisma/client";
import { runContentSync } from "../scripts/sync.js";
import { fetchRssSource, fetchDueRssSources } from "./rssFetch.js";

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
  if (name.includes("rss") || name.includes("feed")) return "rss:fetch";
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

  if (action === "rss:fetch") {
    const sourceId = typeof input.sourceId === "string" ? input.sourceId : undefined;
    const maxItems = typeof input.maxItems === "number" ? input.maxItems : 20;
    const autoDraft = input.autoDraft === true;

    if (sourceId) {
      const result = await fetchRssSource(prisma, sourceId, { maxItems, timeoutMs: 20000 });
      return {
        action: "rss:fetch",
        sourceId,
        sourceName: result.sourceName,
        success: result.success,
        fetchedCount: result.fetchedCount,
        newCount: result.newCount,
        error: result.error,
        timestamp: new Date().toISOString(),
      };
    }

    // 未指定 sourceId 时，抓取所有到期的 RSS 源
    const results = await fetchDueRssSources(prisma, { maxItems, timeoutMs: 20000 });
    return {
      action: "rss:fetch",
      sourceId: null,
      scanned: results.length,
      totalNew: results.reduce((sum, r) => sum + r.newCount, 0),
      results: results.map((r) => ({
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        success: r.success,
        fetchedCount: r.fetchedCount,
        newCount: r.newCount,
        error: r.error,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  return {
    action: "noop",
    message: `任务「${task.name}」已执行；可在 input.action 中指定 db:sync 或 rss:fetch 等动作。`,
    timestamp: new Date().toISOString(),
  };
}
