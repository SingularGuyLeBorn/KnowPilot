/**
 * TaskScheduler — 基于 node-cron 的后台任务调度器
 */

import cron, { type ScheduledTask } from "node-cron";
import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
// 重叠互斥收进 TaskService.run → claimTaskRun，本调度器不再 check-then-act

export class TaskScheduler {
  private jobs = new Map<string, ScheduledTask>();
  private started = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly services: ServiceContainer,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const tasks = await this.prisma.task.findMany({
      where: { type: "cron", cronExpression: { not: null } },
    });

    let registered = 0;
    for (const task of tasks) {
      if (!task.cronExpression || !cron.validate(task.cronExpression)) {
        console.warn(`  ⚠️ [TaskScheduler] 跳过无效 cron: ${task.name} (${task.cronExpression})`);
        continue;
      }

      const job = cron.schedule(task.cronExpression, () => {
        void this.runScheduled(task.id, task.name);
      });
      this.jobs.set(task.id, job);
      registered++;
      console.log(`  ⏰ [TaskScheduler] 已注册 "${task.name}" → ${task.cronExpression}`);
    }

    console.log(`  ⏰ [TaskScheduler] 启动完成，共 ${registered} 个定时任务`);
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
    this.started = false;
    console.log("  ⏰ [TaskScheduler] 已停止");
  }

  private async runScheduled(taskId: string, taskName: string): Promise<void> {
    // 重叠互斥单点 = TaskService.run → claimTaskRun（禁止本层再 check-then-act）
    try {
      console.log(`  ⏰ [TaskScheduler] 触发执行: ${taskName}`);
      const result = await this.services.task.run(taskId);
      if (!result.success && result.error?.code === "TASK_ALREADY_RUNNING") {
        console.warn(`  ⏰ [TaskScheduler] 任务 "${taskName}" 正在运行，跳过本次触发`);
      }
    } catch (err: unknown) {
      console.error(
        `  ❌ [TaskScheduler] 任务 "${taskName}" 执行失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

let _scheduler: TaskScheduler | null = null;
let _schedulerPrisma: PrismaClient | null = null;

export function getTaskScheduler(prisma: PrismaClient, services: ServiceContainer): TaskScheduler {
  // 测试隔离：prisma 不匹配时重建
  if (_scheduler && _schedulerPrisma !== prisma) {
    _scheduler.stop();
    _scheduler = null;
    _schedulerPrisma = null;
  }
  if (!_scheduler) {
    _scheduler = new TaskScheduler(prisma, services);
    _schedulerPrisma = prisma;
  }
  return _scheduler;
}

export function resetTaskSchedulerForTests(): void {
  if (_scheduler) _scheduler.stop();
  _scheduler = null;
  _schedulerPrisma = null;
}
