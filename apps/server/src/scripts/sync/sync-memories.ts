/**
 * Memory 同步器
 *
 * 文件格式：content/memories/{slug}.md
 * frontmatter: content, type, strength, keywords
 * 正文：content（如 frontmatter 未提供则使用正文）
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, readStringArray, readNumber, getFileMtime } from "./utils.js";

interface MemoryData {
  content: string;
  type: string;
  strength: number;
  keywords: string; // 逗号分隔
}

export const memorySyncer: Syncer<MemoryData> = {
  entityName: "Memory",
  contentDirName: "memories",
  extensions: [".md", ".json"],

  async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<MemoryData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".md", ".json"]);
    const records: SyncRecord<MemoryData>[] = [];
    for (const filePath of filePaths) {
      const r = await this.scanFile!(filePath, contentDir);
      if (r) records.push(r);
    }
    return records;
  },

  // A13：单文件解析
  async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<MemoryData> | null> {
    try {
      const slug = filePathToSlug(contentDir, filePath);
      const mtime = getFileMtime(filePath);
      const ext = path.extname(filePath).toLowerCase();

      let memoryContent: string;
      let type: string;
      let strength: number;
      let keywords: string[];

      if (ext === ".json") {
        // 兼容旧版运行时生成的 .json 记忆文件
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        memoryContent = typeof parsed.content === "string" ? parsed.content : "";
        type = typeof parsed.type === "string" ? parsed.type : "episodic";
        strength = typeof parsed.strength === "number" ? parsed.strength : 1.0;
        keywords = Array.isArray(parsed.keywords) ? parsed.keywords.filter((k: unknown) => typeof k === "string") : [];
      } else {
        const { data, content } = parseMarkdownFile(filePath);
        memoryContent = typeof data.content === "string" ? data.content : content.trim();
        type = typeof data.type === "string" ? data.type : "episodic";
        strength = readNumber(data.strength, 1.0);
        keywords = readStringArray(data.keywords);
      }

      if (!memoryContent) {
        console.warn(`  ⚠️ [Memory 跳过] ${filePath}: content 为空`);
        return null;
      }

      return {
        slug,
        mtime,
        data: { content: memoryContent, type, strength, keywords: keywords.join(",") },
      };
    } catch (e: any) {
      console.error(`  ❌ [Memory 解析失败] ${filePath}:`, e.message);
      return null;
    }
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<MemoryData>): Promise<void> {
    const { slug, mtime, data } = record;

    // Memory 以 sourceSlug 作为本地标识进行幂等同步
    const existing = await prisma.memory.findUnique({
      where: { sourceSlug: slug },
    });

    if (existing) {
      await prisma.memory.update({
        where: { id: existing.id },
        data: {
          content: data.content,
          type: data.type,
          strength: data.strength,
          keywords: data.keywords,
          sourceMtime: mtime,
        },
      });
    } else {
      await prisma.memory.create({
        data: {
          content: data.content,
          type: data.type,
          strength: data.strength,
          keywords: data.keywords,
          sourceSlug: slug,
          sourceMtime: mtime,
        },
      });
    }
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[], _contentDir?: string): Promise<number> {
    if (activeSlugs.length === 0) {
      console.warn(`  ⚠️ [Memory] activeSlugs 为空，跳过 cleanup 以防误删。`);
      return 0;
    }
    // Memory 现在以 sourceSlug 为唯一标识，可以安全清理本地已删除的文件
    const allInDb = await prisma.memory.findMany({ select: { id: true, sourceSlug: true } });
    let deleted = 0;

    for (const dbMemory of allInDb) {
      if (dbMemory.sourceSlug && !activeSlugs.includes(dbMemory.sourceSlug)) {
        await prisma.memory.delete({ where: { id: dbMemory.id } });
        console.log(`  🗑️ [Memory 已清理] "${dbMemory.sourceSlug}" (本地文件已被删除)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.memory.findMany({
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
