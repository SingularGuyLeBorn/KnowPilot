/**
 * InfoSource 信息源同步器
 *
 * 文件格式：content/sources/{slug}.json
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, filePathToSlug, getFileMtime, readStringArray, readNumber } from "./utils.js";

interface InfoSourceData {
  name: string;
  url: string;
  type: string;
  description: string;
  reliability: number;
  language: string;
  tags: string;
  enabled: boolean;
}

function normalizeType(raw: unknown): string {
  const t = String(raw ?? "general").toLowerCase();
  const allowed = ["blog", "paper", "news", "official", "community", "general", "rss"];
  return allowed.includes(t) ? t : "general";
}

export const infoSourceSyncer: Syncer<InfoSourceData> = {
  entityName: "InfoSource",
  contentDirName: "sources",
  extensions: [".json"],

  async scan(_prisma: PrismaClient, contentDir: string): Promise<SyncRecord<InfoSourceData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".json"]);
    const records: SyncRecord<InfoSourceData>[] = [];

    for (const filePath of filePaths) {
      try {
        const slug = filePathToSlug(contentDir, filePath);
        const mtime = getFileMtime(filePath);
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;

        const name = typeof data.name === "string" ? data.name : slug;
        const url = typeof data.url === "string" ? data.url : "";
        if (!url) {
          console.warn(`  ⚠️ [InfoSource 跳过] ${filePath}: url 为空`);
          continue;
        }

        records.push({
          slug,
          mtime,
          data: {
            name,
            url,
            type: normalizeType(data.type),
            description: typeof data.description === "string" ? data.description : "",
            reliability: Math.max(1, Math.min(5, readNumber(data.reliability, 3))),
            language: typeof data.language === "string" ? data.language : "auto",
            tags: readStringArray(data.tags).join(","),
            enabled: data.enabled !== false,
          },
        });
      } catch (e: unknown) {
        console.error(`  ❌ [InfoSource 解析失败] ${filePath}:`, e instanceof Error ? e.message : e);
      }
    }

    return records;
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<InfoSourceData>): Promise<void> {
    const { slug, mtime, data } = record;

    await prisma.infoSource.upsert({
      where: { sourceSlug: slug },
      update: {
        name: data.name,
        url: data.url,
        type: data.type,
        description: data.description,
        reliability: data.reliability,
        language: data.language,
        tags: data.tags,
        enabled: data.enabled,
        sourceMtime: mtime,
      },
      create: {
        name: data.name,
        url: data.url,
        type: data.type,
        description: data.description,
        reliability: data.reliability,
        language: data.language,
        tags: data.tags,
        enabled: data.enabled,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[]): Promise<number> {
    const allInDb = await prisma.infoSource.findMany({ select: { id: true, sourceSlug: true } });
    let deleted = 0;

    for (const row of allInDb) {
      if (row.sourceSlug && !activeSlugs.includes(row.sourceSlug)) {
        await prisma.infoSource.delete({ where: { id: row.id } });
        console.log(`  🗑️ [InfoSource 已清理] "${row.sourceSlug}" (本地文件已被删除)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.infoSource.findMany({
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
