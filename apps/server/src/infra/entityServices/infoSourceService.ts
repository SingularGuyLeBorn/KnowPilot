/**
 * InfoSource 信息源 Service（FileSync，从 services.ts 拆出的叶子）。
 */

import type {
  CreateInfoSourceInput,
  UpdateInfoSourceInput,
  ListInfoSourcesInput,
} from "@knowpilot/shared";
import { canonicalListTag, formatTagsCsv, tagsFromCsv } from "@knowpilot/shared";
import { FileSyncService } from "../../services.js";
import { invalidateCapabilitiesCache } from "../capabilities.js";

export interface InfoSourceEntity {
  id: string;
  name: string;
  url: string;
  type: string;
  description: string;
  reliability: number;
  language: string;
  tags: string[];
  enabled: boolean;
  fetchInterval: number | null;
  lastFetchedAt: Date | null;
  lastFetchStatus: string | null;
  lastFetchError: string | null;
  sourceSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
}


export class InfoSourceService extends FileSyncService<
  CreateInfoSourceInput,
  UpdateInfoSourceInput,
  ListInfoSourcesInput,
  InfoSourceEntity
> {
  readonly entityName = "infoSource";
  readonly contentDirName = "sources";
  readonly fileExtension = ".json";

  protected get delegate() { return this.prisma.infoSource; }

  protected formatEntity(raw: any): InfoSourceEntity {
    return {
      ...raw,
      tags: tagsFromCsv(raw.tags),
    };
  }

  protected buildListWhere(input: ListInfoSourcesInput): any {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.enabled !== undefined) where.enabled = input.enabled;
    if (input.minReliability !== undefined) where.reliability = { gte: input.minReliability };
    const tag = canonicalListTag(input.tag);
    if (tag) where.tags = { contains: tag };
    if (input.keyword) {
      where.OR = [
        { name: { contains: input.keyword } },
        { url: { contains: input.keyword } },
        { description: { contains: input.keyword } },
        { tags: { contains: input.keyword } },
      ];
    }
    return where;
  }

  private slugifyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `source-${Date.now().toString(36)}`;
  }

  protected buildCreateData(input: CreateInfoSourceInput): any {
    const slug = this.slugifyName(input.name);
    return {
      name: input.name.trim(),
      url: input.url.trim(),
      type: input.type,
      description: input.description ?? "",
      reliability: input.reliability,
      language: input.language,
      tags: formatTagsCsv(input.tags),
      enabled: input.enabled ?? true,
      fetchInterval: input.fetchInterval ?? 60,
      sourceSlug: slug,
    };
  }

  protected buildUpdateData(input: UpdateInfoSourceInput): any {
    const { id: _id, tags, name, url, ...data } = input;
    const updateData: any = { ...data };
    if (name !== undefined) updateData.name = name.trim();
    if (url !== undefined) updateData.url = url.trim();
    if (tags !== undefined) updateData.tags = formatTagsCsv(tags);
    if (input.fetchInterval === null) updateData.fetchInterval = null;
    return updateData;
  }

  protected serializeToFile(entity: InfoSourceEntity): string {
    return `${JSON.stringify(
      {
        name: entity.name,
        url: entity.url,
        type: entity.type,
        description: entity.description,
        reliability: entity.reliability,
        language: entity.language,
        tags: entity.tags,
        enabled: entity.enabled,
        fetchInterval: entity.fetchInterval,
      },
      null,
      2,
    )}\n`;
  }

  protected getFileSlug(entity: InfoSourceEntity): string {
    return entity.sourceSlug || this.slugifyName(entity.name);
  }

  // P10：InfoSource CRUD 后失效 capabilities 缓存（infoSources.enabled 计数）
  protected override async afterCreate(entity: InfoSourceEntity, input: CreateInfoSourceInput): Promise<void> {
    await super.afterCreate(entity, input);
    invalidateCapabilitiesCache();
  }
  protected override async afterUpdate(entity: InfoSourceEntity, existing: any, input: UpdateInfoSourceInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    invalidateCapabilitiesCache();
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    invalidateCapabilitiesCache();
  }

  protected override async validateCreate(input: CreateInfoSourceInput): Promise<void> {
    await this.assertUnique("name", input.name.trim(), "创建");
  }

  protected override async validateUpdate(input: UpdateInfoSourceInput, existing: any): Promise<void> {
    if (input.name && input.name.trim() !== existing.name) {
      await this.assertUnique("name", input.name.trim(), "更新", input.id);
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name, url: existing.url };
  }
}
