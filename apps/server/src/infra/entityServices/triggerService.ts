/**
 * Trigger 触发器 Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateTriggerInput,
  UpdateTriggerInput,
  ListTriggersInput,
} from "@knowpilot/shared";
import { BaseService } from "../../services.js";

export class TriggerService extends BaseService<
  CreateTriggerInput,
  UpdateTriggerInput,
  ListTriggersInput,
  any
> {
  readonly entityName = "trigger";
  protected get delegate() {
    return this.prisma.trigger;
  }
  protected formatEntity(raw: any) {
    return raw;
  }
  protected buildListWhere(input: ListTriggersInput) {
    const where: any = {};
    if (input.keyword) where.name = { contains: input.keyword };
    return where;
  }
  protected buildCreateData(input: CreateTriggerInput) {
    return input;
  }
  protected buildUpdateData(input: UpdateTriggerInput) {
    const { id: _id, ...data } = input;
    return data;
  }

  protected override async validateCreate(input: CreateTriggerInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdateTriggerInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }
}
