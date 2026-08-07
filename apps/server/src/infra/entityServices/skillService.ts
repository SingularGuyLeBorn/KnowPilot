/**
 * Skill 技能 Service（FileSync，从 services.ts 拆出的叶子）。
 */

import type {
  CreateSkillInput,
  UpdateSkillInput,
  ListSkillsInput,
} from "@knowpilot/shared";
import { canonicalListTag, formatTagsCsv, tagsForFts, tagsFromCsv } from "@knowpilot/shared";
import { FileSyncService } from "../../services.js";
import { parseSkillKind, skillFileSlug } from "../skillPackage.js";

/** Skill 技能 */
export interface SkillEntity {
  id: string;
  name: string;
  description: string;
  code: string;
  icon: string | null;
  trigger: string | null;
  enabled: boolean;
  tags: string[];
  metaJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function ftsBody(entity: { description: string; code: string; tags: string[] }): string {
  const tagPart = tagsForFts(entity.tags);
  return [entity.description, tagPart, entity.code].filter(Boolean).join("\n");
}

export class SkillService extends FileSyncService<CreateSkillInput, UpdateSkillInput, ListSkillsInput, SkillEntity> {
  readonly entityName = "skill";
  readonly contentDirName = "skills";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.skill; }

  protected formatEntity(raw: any): SkillEntity {
    return {
      ...raw,
      tags: tagsFromCsv(raw.tags),
    };
  }

  protected buildListWhere(input: ListSkillsInput): any {
    const where: any = {};
    if (input.enabled !== undefined) where.enabled = input.enabled;
    const tag = canonicalListTag(input.tag);
    if (tag) where.tags = { contains: tag };
    if (input.keyword) {
      where.OR = [
        { name: { contains: input.keyword } },
        { description: { contains: input.keyword } },
        { tags: { contains: input.keyword } },
      ];
    }
    return where;
  }

  protected buildCreateData(input: CreateSkillInput): any {
    const { tags, ...rest } = input;
    return { ...rest, tags: formatTagsCsv(tags ?? []) };
  }

  protected buildUpdateData(input: UpdateSkillInput): any {
    const { id: _id, tags, ...data } = input;
    const updateData: any = { ...data };
    if (tags !== undefined) updateData.tags = formatTagsCsv(tags);
    return updateData;
  }

  private skillKindOf(entity: SkillEntity): "procedural" | "executable" | "reference" {
    return parseSkillKind(entity.metaJson, "executable");
  }

  protected serializeToFile(entity: SkillEntity): string {
    let meta: Record<string, unknown> = {};
    if (entity.metaJson) {
      try {
        meta = JSON.parse(entity.metaJson);
      } catch {
        meta = {};
      }
    }
    const kind = this.skillKindOf(entity);
    const lines = [
      `name: "${entity.name.replace(/"/g, '\\"')}"`,
      `description: "${entity.description.replace(/"/g, '\\"')}"`,
      `icon: ${entity.icon ? `"${entity.icon}"` : "null"}`,
      `trigger: ${entity.trigger ? `"${entity.trigger}"` : "null"}`,
      `enabled: ${entity.enabled}`,
      `kind: ${kind}`,
    ];
    if (entity.tags?.length) {
      lines.push(`tags:\n${entity.tags.map((t) => `  - "${t.replace(/"/g, '\\"')}"`).join("\n")}`);
    } else {
      lines.push(`tags: []`);
    }
    if (typeof meta.version === "string" && meta.version.trim()) {
      lines.push(`version: "${meta.version.trim()}"`);
    }
    if (typeof meta.source === "string" && meta.source.trim()) {
      lines.push(`source: "${String(meta.source).replace(/"/g, '\\"')}"`);
    }
    if (meta.model) lines.push(`model: "${meta.model}"`);
    if (meta.context) lines.push(`context: ${meta.context}`);
    if (Array.isArray(meta.allowedTools) && meta.allowedTools.length) {
      lines.push(`allowed-tools:\n${(meta.allowedTools as string[]).map((t) => `  - ${t}`).join("\n")}`);
    }
    return `---\n${lines.join("\n")}\n---\n${entity.code}\n`;
  }

  /** procedural → `{name}/SKILL.md`；其余扁平 `{name}.md` */
  protected getFileSlug(entity: SkillEntity): string {
    return skillFileSlug(entity.name, this.skillKindOf(entity));
  }

  // P11：FTS 增量
  protected override async afterCreate(entity: SkillEntity, input: CreateSkillInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("skill", entity.id, entity.name, ftsBody(entity));
    this.eventBus.emit("skill.created", entity);
  }
  protected override async afterUpdate(entity: SkillEntity, existing: any, input: UpdateSkillInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("skill", entity.id, entity.name, ftsBody(entity));
    this.eventBus.emit("skill.updated", entity);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("skill", existing.id);
    this.eventBus.emit("skill.deleted", existing);
  }

  protected override async validateCreate(input: CreateSkillInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }

  protected override async validateUpdate(input: UpdateSkillInput, existing: any): Promise<void> {
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name };
  }
}
