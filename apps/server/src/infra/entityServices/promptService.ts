/**
 * Prompt 提示词模板 Service（FileSync，从 services.ts 拆出的叶子）。
 */

import type {
  CreatePromptInput,
  UpdatePromptInput,
  ListPromptsInput,
} from "@knowpilot/shared";
import { canonicalListTag, formatTagsCsv, tagsFromCsv } from "@knowpilot/shared";
import { FileSyncService } from "../../services.js";

export class PromptService extends FileSyncService<
  CreatePromptInput,
  UpdatePromptInput,
  ListPromptsInput,
  any
> {
  readonly entityName = "prompt";
  readonly contentDirName = "prompts";
  readonly fileExtension = ".md";
  protected get delegate() {
    return this.prisma.prompt;
  }

  protected formatEntity(raw: any) {
    return {
      ...raw,
      variables: raw.variables
        ? raw.variables.split(",").filter(Boolean).map((v: string) => v.trim())
        : [],
      tags: tagsFromCsv(raw.tags),
    };
  }

  protected buildListWhere(input: ListPromptsInput) {
    const where: any = {};
    const tag = canonicalListTag(input.tag);
    if (tag) where.tags = { contains: tag };
    if (input.keyword) {
      where.OR = [
        { name: { contains: input.keyword } },
        { description: { contains: input.keyword } },
      ];
    }
    return where;
  }

  protected buildCreateData(input: CreatePromptInput) {
    return {
      name: input.name,
      version: input.version,
      description: input.description,
      variables: input.variables.join(","),
      tags: formatTagsCsv(input.tags),
      content: input.content,
    };
  }

  protected buildUpdateData(input: UpdatePromptInput) {
    const { id: _id, variables, tags, ...data } = input;
    const updateData: any = { ...data };
    if (variables !== undefined) updateData.variables = variables.join(",");
    if (tags !== undefined) updateData.tags = formatTagsCsv(tags);
    return updateData;
  }

  protected serializeToFile(entity: any): string {
    const varsYaml =
      entity.variables?.length > 0
        ? `\nvariables:\n` + entity.variables.map((v: string) => `  - "${v}"`).join("\n")
        : "\nvariables: []";
    const tagsYaml =
      entity.tags?.length > 0
        ? `\ntags:\n` + entity.tags.map((t: string) => `  - "${t}"`).join("\n")
        : "\ntags: []";
    return `---
name: "${entity.name}"
version: "${entity.version}"
description: ${entity.description ? `"${entity.description}"` : "null"}${varsYaml}${tagsYaml}
---
${entity.content}
`;
  }

  protected getFileSlug(entity: any): string {
    return entity.name;
  }

  protected override async afterCreate(entity: any, input: CreatePromptInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts(
      "prompt",
      entity.id,
      entity.name,
      `${entity.description ?? ""}\n${entity.content ?? ""}`,
    );
  }
  protected override async afterUpdate(entity: any, existing: any, input: UpdatePromptInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts(
      "prompt",
      entity.id,
      entity.name,
      `${entity.description ?? ""}\n${entity.content ?? ""}`,
    );
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("prompt", existing.id);
  }

  protected override async validateCreate(input: CreatePromptInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdatePromptInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }
}
