/**
 * Log 系统日志 Service（从 services.ts 拆出的叶子）。
 */

import type { CreateLogInput, UpdateLogInput, ListLogsInput } from "@knowpilot/shared";
import { BaseService } from "../../services.js";

export class LogService extends BaseService<CreateLogInput, UpdateLogInput, ListLogsInput, any> {
  readonly entityName = "log";
  protected get delegate() {
    return this.prisma.log;
  }
  protected formatEntity(raw: any) {
    return raw;
  }
  protected buildListWhere(input: ListLogsInput) {
    const where: any = {};
    if (input.level) where.level = input.level;
    if (input.component) where.component = input.component;
    if (input.keyword) {
      where.OR = [{ message: { contains: input.keyword } }, { event: { contains: input.keyword } }];
    }
    return where;
  }
  protected buildCreateData(input: CreateLogInput) {
    return input;
  }
  protected buildUpdateData(input: UpdateLogInput) {
    const { id: _id, ...data } = input;
    return data;
  }

  async clearAll(): Promise<number> {
    const { count } = await this.prisma.log.deleteMany();
    return count;
  }
}
