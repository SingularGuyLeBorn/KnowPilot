/**
 * Task 同步器
 *
 * 文件格式：content/tasks/{slug}.json
 * 字段：name, type, status, cronExpression, input
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, filePathToSlug, getFileMtime } from "./utils.js";

interface TaskData {
  name: string;
  type: string;
  status: string;
  cronExpression: string | null;
  input: unknown;
}

function normalizeType(raw: unknown): string {
  const t = String(raw ?? "oneshot").toLowerCase();
  if (t === "scheduled" || t === "cron") return "cron";
  return "oneshot";
}

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? "pending").toLowerCase();
  if (s === "active") return "pending";
  if (["pending", "running", "success", "failed"].includes(s)) return s;
  return "pending";
}

export const taskSyncer: Syncer<TaskData> = {
  entityName: "Task",
  contentDirName: "tasks",
  extensions: [".json"],

  async scan(_prisma: PrismaClient, contentDir: string): Promise<SyncRecord<TaskData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".json"]);
    const records: SyncRecord<TaskData>[] = [];

    for (const filePath of filePaths) {
      try {
        const slug = filePathToSlug(contentDir, filePath);
        const mtime = getFileMtime(filePath);
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;

        const name = typeof data.name === "string" ? data.name : slug;
        records.push({
          slug,
          mtime,
          data: {
            name,
            type: normalizeType(data.type),
            status: normalizeStatus(data.status),
            cronExpression: typeof data.cronExpression === "string" ? data.cronExpression : null,
            input: data.input ?? {},
          },
        });
      } catch (e: unknown) {
        console.error(`  ❌ [Task 解析失败] ${filePath}:`, e instanceof Error ? e.message : e);
      }
    }

    return records;
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<TaskData>): Promise<void> {
    const { slug, mtime, data } = record;

    await prisma.task.upsert({
      where: { sourceSlug: slug },
      update: {
        name: data.name,
        type: data.type,
        status: data.status,
        cronExpression: data.cronExpression,
        input: data.input as object,
        sourceMtime: mtime,
      },
      create: {
        name: data.name,
        type: data.type,
        status: data.status,
        cronExpression: data.cronExpression,
        input: data.input as object,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[]): Promise<number> {
    const allInDb = await prisma.task.findMany({ select: { id: true, sourceSlug: true } });
    let deleted = 0;

    for (const row of allInDb) {
      if (row.sourceSlug && !activeSlugs.includes(row.sourceSlug)) {
        await prisma.task.delete({ where: { id: row.id } });
        console.log(`  🗑️ [Task 已清理] "${row.sourceSlug}" (本地文件已被删除)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.task.findMany({
      select: { sourceSlug: true, sourceMtime: true },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      if (row.sourceSlug && row.sourceMtime) {
        map.set(row.sourceSlug, row.sourceMtime);
      }
    }
    return map;
  },
};
