/**
 * Skill 同步器
 *
 * - procedural: content/skills/{name}/SKILL.md（+ references/templates/scripts）
 * - executable: content/skills/{slug}.md
 * - reference: design-references/ 等
 */

import path from "path";
import { PrismaClient } from "@prisma/client";
import { Syncer, SyncRecord } from "./types.js";
import { getFilesRecursive, parseMarkdownFile, filePathToSlug, readBoolean, getFileMtime } from "./utils.js";
import {
  inferKindFromScanPath,
  shouldSkipSkillScanPath,
  skillFileSlug,
  type SkillKind,
} from "../../infra/skillPackage.js";

export interface SkillMeta {
  model?: string;
  context?: "inline" | "fork";
  allowedTools?: string[];
  kind?: SkillKind;
  version?: string;
  package?: boolean;
}

interface SkillData {
  name: string;
  description: string;
  code: string;
  icon: string | null;
  trigger: string | null;
  enabled: boolean;
  metaJson: string | null;
}

function readStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) {
    return value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

function parseSkillFrontmatter(
  data: Record<string, unknown>,
  filePath: string,
  contentDir: string,
): SkillMeta {
  const rel = path.relative(contentDir, filePath).replace(/\\/g, "/");
  const kind = inferKindFromScanPath(rel, typeof data.kind === "string" ? data.kind : undefined);

  const context =
    data.context === "fork" || data.context === "inline" ? (data.context as SkillMeta["context"]) : undefined;

  const version =
    typeof data.version === "string" && data.version.trim()
      ? data.version.trim()
      : typeof data.version === "number"
        ? String(data.version)
        : "1.0.0";

  return {
    model: typeof data.model === "string" ? data.model : undefined,
    context,
    allowedTools: readStringArray(data["allowed-tools"] ?? data.allowedTools),
    kind,
    version,
    package: kind === "procedural",
  };
}

function normalizeTrigger(data: Record<string, unknown>, name: string): string | null {
  if (typeof data.trigger === "string" && data.trigger.trim()) return data.trigger.trim();
  if (name.startsWith("/")) return name;
  return `/${name}`;
}

export const skillSyncer: Syncer<SkillData> = {
  entityName: "Skill",
  contentDirName: "skills",
  extensions: [".md"],

  async scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<SkillData>[]> {
    const filePaths = getFilesRecursive(contentDir, [".md"]);
    const records: SyncRecord<SkillData>[] = [];
    for (const filePath of filePaths) {
      const rel = path.relative(contentDir, filePath).replace(/\\/g, "/");
      if (shouldSkipSkillScanPath(rel)) continue;
      const r = await this.scanFile!(filePath, contentDir);
      if (r) records.push(r);
    }
    return records;
  },

  async scanFile(filePath: string, contentDir: string): Promise<SyncRecord<SkillData> | null> {
    try {
      const rel = path.relative(contentDir, filePath).replace(/\\/g, "/");
      if (shouldSkipSkillScanPath(rel)) return null;

      const mtime = getFileMtime(filePath);
      const { data, content } = parseMarkdownFile(filePath);
      const fm = data as Record<string, unknown>;
      const meta = parseSkillFrontmatter(fm, filePath, contentDir);

      const baseName =
        path.basename(filePath) === "SKILL.md"
          ? path.basename(path.dirname(filePath))
          : filePathToSlug(contentDir, filePath);

      const name = typeof fm.name === "string" ? fm.name : baseName;
      const description = typeof fm.description === "string" ? fm.description : "";
      const code = content.trim();
      const icon = typeof fm.icon === "string" ? fm.icon : "Wand2";
      const trigger = normalizeTrigger(fm, name);
      let enabled = readBoolean(fm.enabled, true);
      if (meta.kind === "reference") enabled = readBoolean(fm.enabled, false);
      if (fm.archived === true) enabled = false;

      const slug = skillFileSlug(name, meta.kind ?? "executable");

      return {
        slug,
        mtime,
        data: {
          name,
          description,
          code,
          icon,
          trigger,
          enabled,
          metaJson: JSON.stringify({ ...meta, trigger }),
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ❌ [Skill 解析失败] ${filePath}:`, msg);
      return null;
    }
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
        metaJson: data.metaJson,
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
        metaJson: data.metaJson,
        sourceSlug: slug,
        sourceMtime: mtime,
      },
    });
  },

  async deleteBySlug(prisma: PrismaClient, slug: string): Promise<number> {
    const r = await prisma.skill.deleteMany({ where: { sourceSlug: slug } });
    return r.count;
  },

  async cleanup(prisma: PrismaClient, activeSlugs: string[], _contentDir?: string): Promise<number> {
    if (activeSlugs.length === 0) {
      console.warn(`  ⚠️ [Skill] activeSlugs 为空，跳过 cleanup 以防误删。`);
      return 0;
    }
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

export function parseSkillMetaJson(metaJson?: string | null): SkillMeta & { trigger?: string } {
  if (!metaJson) return {};
  try {
    return JSON.parse(metaJson) as SkillMeta & { trigger?: string };
  } catch {
    return {};
  }
}
