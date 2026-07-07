/**
 * Prompt 同步器
 *
 * 文件格式：content/prompts/{slug}.md
 * frontmatter: name, version, description, variables, tags
 * 正文：content
 */

import { PrismaClient } from "@prisma/client";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, readStringArray, getFileMtime } from "./utils.js";

interface PromptData {
  name: string;
  version: string;
  description: string | null;
  variables: string;
  tags: string;
  content: string;
}

export const promptSyncer: Syncer<PromptData> = {
  entityName: "Prompt",
  contentDirName: "prompts",
  extensions: [".md"],

  async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<PromptData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".md"]);
    const records: SyncRecord<PromptData>[] = [];

    for (const filePath of filePaths) {
      try {
        const slug = filePathToSlug(contentDir, filePath);
        const mtime = getFileMtime(filePath);
        const { data, content } = parseMarkdownFile(filePath);

        const name = typeof data.name === "string" ? data.name : slug;
        const version = typeof data.version === "string" ? data.version : "1.0.0";
        const description = typeof data.description === "string" ? data.description : null;
        const variables = readStringArray(data.variables).join(",");
        const tags = readStringArray(data.tags).join(",");

        records.push({
          slug,
          mtime,
          data: { name, version, description, variables, tags, content: content.trim() },
        });
      } catch (e: any) {
        console.error(`  ❌ [Prompt 解析失败] ${filePath}:`, e.message);
      }
    }

    return records;
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<PromptData>): Promise<void> {
    const { slug, mtime, data } = record;

    await prisma.prompt.upsert({
      where: { name: data.name },
      update: {
        version: data.version,
        description: data.description,
        variables: data.variables,
        tags: data.tags,
        content: data.content,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
      create: {
        name: data.name,
        version: data.version,
        description: data.description,
        variables: data.variables,
        tags: data.tags,
        content: data.content,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[], _contentDir?: string): Promise<number> {
    if (activeSlugs.length === 0) {
      console.warn(`  ⚠️ [Prompt] activeSlugs 为空，跳过 cleanup 以防误删。`);
      return 0;
    }
    const allInDb = await prisma.prompt.findMany({ select: { id: true, sourceSlug: true } });
    let deleted = 0;

    for (const dbPrompt of allInDb) {
      if (dbPrompt.sourceSlug && !activeSlugs.includes(dbPrompt.sourceSlug)) {
        await prisma.prompt.delete({ where: { id: dbPrompt.id } });
        console.log(`  🗑️ [Prompt 已清理] "${dbPrompt.sourceSlug}" (本地文件已被删除)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.prompt.findMany({
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
