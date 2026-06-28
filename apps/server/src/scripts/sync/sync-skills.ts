/**
 * Skill 同步器
 *
 * 文件格式：content/skills/{slug}.md
 * frontmatter: name, description, icon, trigger, enabled
 * 正文：code
 */

import { PrismaClient } from "@prisma/client";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, readBoolean, getFileMtime } from "./utils.js";

interface SkillData {
  name: string;
  description: string;
  code: string;
  icon: string | null;
  trigger: string | null;
  enabled: boolean;
}

export const skillSyncer: Syncer<SkillData> = {
  entityName: "Skill",
  contentDirName: "skills",
  extensions: [".md"],

  async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<SkillData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".md"]);
    const records: SyncRecord<SkillData>[] = [];

    for (const filePath of filePaths) {
      try {
        const slug = filePathToSlug(contentDir, filePath);
        const mtime = getFileMtime(filePath);
        const { data, content } = parseMarkdownFile(filePath);

        const name = typeof data.name === "string" ? data.name : slug;
        const description = typeof data.description === "string" ? data.description : "";
        const code = content.trim();
        const icon = typeof data.icon === "string" ? data.icon : null;
        const trigger = typeof data.trigger === "string" ? data.trigger : null;
        const enabled = readBoolean(data.enabled, true);

        records.push({
          slug,
          mtime,
          data: { name, description, code, icon, trigger, enabled },
        });
      } catch (e: any) {
        console.error(`  ❌ [Skill 解析失败] ${filePath}:`, e.message);
      }
    }

    return records;
  },

  async upsert(prisma: PrismaClient, record: SyncRecord<SkillData>): Promise<void> {
    const { slug, mtime, data } = record;

    await prisma.skill.upsert({
      where: { name: data.name },
      update: {
        description: data.description,
        code: data.code,
        icon: data.icon,
        trigger: data.trigger,
        enabled: data.enabled,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
      create: {
        name: data.name,
        description: data.description,
        code: data.code,
        icon: data.icon,
        trigger: data.trigger,
        enabled: data.enabled,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[]): Promise<number> {
    const allInDb = await prisma.skill.findMany({ select: { id: true, sourceSlug: true } });
    let deleted = 0;

    for (const dbSkill of allInDb) {
      if (dbSkill.sourceSlug && !activeSlugs.includes(dbSkill.sourceSlug)) {
        await prisma.skill.delete({ where: { id: dbSkill.id } });
        console.log(`  🗑️ [Skill 已清理] "${dbSkill.sourceSlug}" (本地文件已被删除)`);
        deleted++;
      }
    }

    return deleted;
  },

  async getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>> {
    const rows = await prisma.skill.findMany({
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
