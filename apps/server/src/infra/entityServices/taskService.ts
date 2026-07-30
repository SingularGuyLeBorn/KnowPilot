/**
 * Task 后台任务 Service（从 services.ts 拆出的叶子）。
 */

import type {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
  OperationResult,
} from "@knowpilot/shared";
import { BaseService } from "../../services.js";
import { failure } from "../../trpc/result.js";
import { claimTaskRun } from "../taskClaim.js";

export class TaskService extends BaseService<CreateTaskInput, UpdateTaskInput, ListTasksInput, any> {
  readonly entityName = "task";
  protected get delegate() { return this.prisma.task; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListTasksInput) {
    const where: any = {};
    if (input.status) where.status = input.status;
    if (input.keyword) where.name = { contains: input.keyword };
    // R7：按会话过滤，供 listSessionAsyncJobs 在 DB 层精准查询
    if (input.sessionId) where.sessionId = input.sessionId;
    return where;
  }
  protected buildCreateData(input: CreateTaskInput) { return input; }
  protected buildUpdateData(input: UpdateTaskInput) { const { id: _id, ...data } = input; return data; }

  protected override async afterCreate(entity: any, input: CreateTaskInput): Promise<void> {
    await super.afterCreate(entity, input);
    if (entity?.type === "cron" && entity.cronExpression) {
      const { tryGetTaskScheduler } = await import("../taskScheduler.js");
      await tryGetTaskScheduler()?.upsertCronJob(entity.id);
    }
  }

  protected override async afterUpdate(entity: any, existing: any, input: UpdateTaskInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    const { tryGetTaskScheduler } = await import("../taskScheduler.js");
    const scheduler = tryGetTaskScheduler();
    if (scheduler) {
      if (entity?.type === "cron" && entity.cronExpression) {
        await scheduler.upsertCronJob(entity.id);
      } else {
        scheduler.removeCronJob(entity.id);
      }
    }
    if (input.status !== undefined && input.status !== existing?.status) {
      const { notifyAllMainSessionsUi } = await import("../uiStateNotify.js");
      await notifyAllMainSessionsUi(this.prisma, {
        type: "task_updated",
        taskId: entity.id,
        status: entity.status,
      });
    }
  }

  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    const { tryGetTaskScheduler } = await import("../taskScheduler.js");
    tryGetTaskScheduler()?.removeCronJob(existing.id);
  }

  /** 立即执行任务（db:sync 等）；认领单点 = claimTaskRun，落选如实返回「正在运行」 */
  async run(id: string): Promise<OperationResult<any>> {
    let task: { id: string; name: string; type: string; input?: unknown };
    try {
      task = (await this.getById(id)) as { id: string; name: string; type: string; input?: unknown };
    } catch {
      return failure({
        code: "TASK_NOT_FOUND",
        message: `执行任务失败：id 为 "${id}" 的任务不存在。`,
        details: { id },
        field: "id",
        retryable: false,
        operation: "run",
        entity: this.entityName,
        durationMs: 0,
      });
    }

    const claimed = await claimTaskRun(this.prisma, id);
    if (!claimed) {
      return failure({
        code: "TASK_ALREADY_RUNNING",
        message: `任务「${task.name}」正在运行，请等待完成后再触发。`,
        details: { id },
        suggestion: "同一任务同时只允许一个执行体；稍后重试或先取消当前运行。",
        retryable: true,
        operation: "run",
        entity: this.entityName,
        durationMs: 0,
      });
    }

    try {
      const { executeTaskJob } = await import("../taskRunner.js");
      const output = await executeTaskJob(this.prisma, task);
      return this.update({ id, status: "success", output });
    } catch (err: unknown) {
      return this.update({
        id,
        status: "failed",
        output: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
