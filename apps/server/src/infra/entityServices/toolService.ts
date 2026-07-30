/**
 * Tool 工具注册表 Service（从 services.ts 拆出的叶子）。
 */

import type { CreateToolInput, UpdateToolInput, ListToolsInput } from "@knowpilot/shared";
import { BaseService } from "../../services.js";

export class ToolService extends BaseService<CreateToolInput, UpdateToolInput, ListToolsInput, any> {
  readonly entityName = "tool";
  protected get delegate() {
    return this.prisma.tool;
  }
  protected formatEntity(raw: any) {
    return raw;
  }
  protected buildListWhere(input: ListToolsInput) {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.enabled !== undefined) where.enabled = input.enabled;
    if (input.keyword) {
      where.OR = [{ name: { contains: input.keyword } }, { description: { contains: input.keyword } }];
    }
    return where;
  }
  protected buildCreateData(input: CreateToolInput) {
    return input;
  }
  protected buildUpdateData(input: UpdateToolInput) {
    const { id: _id, ...data } = input;
    return data;
  }

  protected override async validateCreate(input: CreateToolInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdateToolInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }
}
