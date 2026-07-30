/**
 * Run 执行记录 Service（从 services.ts 拆出的叶子）。
 */

import type { CreateRunInput, UpdateRunInput, ListRunsInput } from "@knowpilot/shared";
import { BaseService } from "../../services.js";

export class RunService extends BaseService<CreateRunInput, UpdateRunInput, ListRunsInput, any> {
  readonly entityName = "run";
  protected get delegate() {
    return this.prisma.run;
  }
  protected formatEntity(raw: any) {
    return raw;
  }
  protected buildListWhere(input: ListRunsInput) {
    const where: any = {};
    if (input.agentId) where.agentId = input.agentId;
    if (input.sessionId) where.sessionId = input.sessionId;
    if (input.status) where.status = input.status;
    return where;
  }
  protected buildCreateData(input: CreateRunInput) {
    return input;
  }
  protected buildUpdateData(input: UpdateRunInput) {
    const { id: _id, ...data } = input;
    return data;
  }
  // Runs 列表保留 output（phase/blockedScopes）；input/toolCalls/error 裁剪
  protected override getListSelect(): any {
    return {
      id: true,
      agentId: true,
      sessionId: true,
      status: true,
      durationMs: true,
      toolCallCount: true,
      tokenUsage: true,
      output: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}
