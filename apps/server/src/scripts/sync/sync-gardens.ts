/**
 * Garden 同步器
 *
 * 扫描 content/{id}/_garden.md → upsert Garden 表。
 * 目录名 = Garden.id；frontmatter: title/description；正文 = homeContent。
 * Post syncer 跳过 _ 前缀文件，故本文件不会进 Post 表。
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";
import {
  SEED_GARDENS,
  isReservedContentDir,
  isValidGardenIdFormat,
} from "@knowpilot/shared";
import { Syncer, SyncRecord } from "./types.js";
import { getFileMtime } from "./utils.js";
import { getAppConfig } from "../../infra/config.js";
import { discoverGardenIds, GARDEN_META_FILE } from "./discover-gardens.js";

export { discoverGardenIds, GARDEN_META_FILE } from "./discover-gardens.js";

interface GardenData {
  id: string;
  title: string;
  description: string | null;
  homeContent: string;
}

function parseGardenFile(filePath: string, id: string): GardenData {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : id;
  const description =
    typeof data.description === "string" ? data.description : null;
  return {
    id,
    title,
    description,
    homeContent: content.replace(/^\uFEFF/, ""),
  };
}

export function serializeGardenFile(data: {
  title: string;
  description?: string | null;
  homeContent: string;
}): string {
  const fm: Record<string, string> = { title: data.title };
  if (data.description) fm.description = data.description;
  return matter.stringify(data.homeContent ?? "", fm);
}

export const gardenSyncer: Syncer<GardenData> = {
  entityName: "Garden",
  /** 占位：scan 自行读 content 根 */
  contentDirName: "posts",
  extensions: [".md"],

  /** 只认各花园 `_garden.md`；普通文章变更不得触发 Garden 全量扫 */
  async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<GardenData> | null> {
    if (path.basename(filePath) !== GARDEN_META_FILE) return null;
    const contentRoot = path.resolve(contentDir);
    const abs = path.resolve(filePath);
    const rel = path.relative(contentRoot, abs);
    const parts = rel.split(path.sep);
    if (parts.length !== 2 || parts[1] !== GARDEN_META_FILE) return null;
    const id = parts[0]!;
    if (!isValidGardenIdFormat(id) || isReservedContentDir(id)) return null;
    try {
      const data = parseGardenFile(abs, id);
      return { slug: id, mtime: getFileMtime(abs), data };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ❌ [Garden 单文件解析失败] ${abs}:`, msg);
      return null;
    }
  },

  async scan(prisma: PrismaClient, _contentDir: string): Promise<SyncRecord<GardenData>[]> {
    const contentRoot = getAppConfig().contentDir;
    const ids = discoverGardenIds(contentRoot);
    const records: SyncRecord<GardenData>[] = [];
    for (const id of ids) {
      const filePath = path.join(contentRoot, id, GARDEN_META_FILE);
      if (!fs.existsSync(filePath)) continue;
      try {
        const data = parseGardenFile(filePath, id);
        records.push({
          slug: id,
          mtime: getFileMtime(filePath),
          data,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ [Garden 解析失败] ${filePath}:`, msg);
      }
    }
    return records;
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<GardenData>): Promise<void> {
    const { slug: id, mtime, data } = record;
    await prisma.garden.upsert({
      where: { id },
      update: {
        title: data.title,
        description: data.description,
        homeContent: data.homeContent,
        sourceMtime: mtime,
        deletedAt: null,
      },
      create: {
        id,
        title: data.title,
        description: data.description,
        homeContent: data.homeContent,
        sourceMtime: mtime,
      },
    });
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[]): Promise<number> {
    if (activeSlugs.length === 0) {
      console.warn("  ⚠️ [Garden] activeSlugs 为空，跳过 cleanup 以防误删。");
      return 0;
    }
    const active = new Set(activeSlugs);
    const rows = await prisma.garden.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true },
    });
    let deleted = 0;
    for (const row of rows) {
      if (active.has(row.id)) continue;
      // 种子库永不因缺文件而软删（ensure 会补）
      if ((SEED_GARDENS as readonly string[]).includes(row.id)) continue;
      await prisma.garden.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });
      console.log(`  🗑️ [Garden 已软删] "${row.title}" (${row.id})`);
      deleted++;
    }
    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.garden.findMany({
      where: { deletedAt: null },
      select: { id: true, sourceMtime: true },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      if (row.sourceMtime) map.set(row.id, row.sourceMtime);
    }
    return map;
  },
};
