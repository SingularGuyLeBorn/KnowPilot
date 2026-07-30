/**
 * Memory 长期语义记忆 Service（FileSync，从 services.ts 拆出的叶子）。
 */

import { dump } from "js-yaml";
import type {
  CreateMemoryInput,
  UpdateMemoryInput,
  ListMemoriesInput,
} from "@knowpilot/shared";
import { FileSyncService } from "../../services.js";

/** Memory 长期语义记忆 */
export interface MemoryEntity {
  id: string;
  content: string;
  type: string;
  strength: number;
  keywords: string[];
  scope: string;
  agentId?: string | null;
  status?: string;
  attribution?: string | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  lastAccessedAt?: Date | null;
  accessCount?: number;
  supersededBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class MemoryService extends FileSyncService<CreateMemoryInput, UpdateMemoryInput, ListMemoriesInput, MemoryEntity> {
  readonly entityName = "memory";
  readonly contentDirName = "memories";
  readonly fileExtension = ".md";

  protected get delegate() { return this.prisma.memory; }

  protected formatEntity(raw: any): MemoryEntity {
    return {
      ...raw,
      keywords: raw.keywords ? raw.keywords.split(",").filter(Boolean).map((k: string) => k.trim()) : [],
    };
  }

  protected buildListWhere(input: ListMemoriesInput): any {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.scope) where.scope = input.scope;
    if (input.status) where.status = input.status;
    else where.status = { not: "superseded" }; // 默认只看 active
    if (input.keyword) {
      where.OR = [{ content: { contains: input.keyword } }, { keywords: { contains: input.keyword } }];
    }
    return where;
  }

  protected buildCreateData(input: CreateMemoryInput): any {
    const data: any = {
      content: input.content,
      type: input.type,
      strength: input.strength,
      keywords: input.keywords.join(","),
      scope: input.scope?.trim() || "global",
      status: "active",
    };
    const extra = input as any;
    if (extra.agentId) data.agentId = extra.agentId;
    if (extra.contentHash) data.contentHash = extra.contentHash;
    if (input.attribution) data.attribution = input.attribution;
    if (input.validFrom !== undefined) data.validFrom = input.validFrom;
    if (input.validTo !== undefined) data.validTo = input.validTo;
    return data;
  }

  protected buildUpdateData(input: UpdateMemoryInput): any {
    const { id: _id, keywords, ...data } = input;
    const updateData: any = { ...data };
    if (keywords !== undefined) updateData.keywords = keywords.join(",");
    return updateData;
  }

  protected serializeToFile(entity: MemoryEntity): string {
    const frontmatter = dump(
      {
        content: entity.content,
        type: entity.type,
        strength: entity.strength,
        keywords: entity.keywords,
        ...(entity.scope && entity.scope !== "global" ? { scope: entity.scope } : {}),
      },
      { lineWidth: -1, noRefs: true },
    );
    return `---\n${frontmatter}---\n\n${entity.content}\n`;
  }

  protected getFileSlug(entity: MemoryEntity): string { return entity.id; }

  /** D8：MemoryRepository supersede 事务外文件先行 / 失败补偿 */
  writeContentFile(entity: MemoryEntity): void {
    this.writeFile(entity);
  }

  /** D8：事务失败时补偿删文件 */
  deleteContentFile(entity: MemoryEntity): void {
    try {
      this.deleteFile(entity);
    } catch (e) {
      console.warn(`[MemoryService] 补偿删文件失败 id=${entity.id}:`, e instanceof Error ? e.message : e);
    }
  }

  /** D8：事务成功后补 FTS / sourceMeta */
  async finalizeContentProjection(entity: MemoryEntity): Promise<void> {
    await this.syncFileMetaToDb(entity);
    await this.syncFts("memory", entity.id, entity.type, entity.content);
  }

  // P11：FTS 增量
  protected override async afterCreate(entity: MemoryEntity, input: CreateMemoryInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("memory", entity.id, entity.type, entity.content);
  }
  protected override async afterUpdate(entity: MemoryEntity, existing: any, input: UpdateMemoryInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("memory", entity.id, entity.type, entity.content);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("memory", existing.id);
  }
}
