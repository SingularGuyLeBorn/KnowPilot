/**
 * C7 原子认领 — 负向断言
 *
 * 旧实现：TaskService.run / TriggerEngine.executeTask 无条件 update status=running，
 * TaskScheduler 先 findUnique 再 run（check-then-act）→ 并发双入口可叠跑。
 * 新实现：claimTaskRun 条件写单点；落选如实「正在运行」。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { claimTaskRun } from "../infra/taskClaim.js";
import * as taskRunner from "../infra/taskRunner.js";

const PREFIX = `c7claim-${Date.now().toString(36)}`;

async function mkTask(name: string, status = "idle") {
  return prisma.task.create({
    data: {
      name: `${PREFIX}-${name}`,
      type: "oneshot",
      status,
      input: { action: "noop" },
    },
  });
}

describe("C7 claimTaskRun 原子认领", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.task.deleteMany({ where: { name: { startsWith: PREFIX } } });
  });

  it("并发双认领同一任务 → 恰一个 claimed", async () => {
    const task = await mkTask("parallel");
    const [a, b] = await Promise.all([claimTaskRun(prisma, task.id), claimTaskRun(prisma, task.id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.status).toBe("running");
  });

  it("TaskService.run 并发双跑同一任务只有一个执行体", async () => {
    const task = await mkTask("svc-run", "idle");
    let concurrent = 0;
    let peak = 0;
    const spy = vi.spyOn(taskRunner, "executeTaskJob").mockImplementation(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 80));
      concurrent--;
      return { action: "noop", ok: true };
    });

    const ctx = await createContextInner();
    const [r1, r2] = await Promise.all([
      ctx.services.task.run(task.id),
      ctx.services.task.run(task.id),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
    const successes = [r1, r2].filter((r) => r.success);
    const rejected = [r1, r2].filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error?.code).toBe("TASK_ALREADY_RUNNING");
    expect(rejected[0]?.error?.message).toMatch(/正在运行/);
  });

  it("模拟 TriggerEngine 与 TaskService 并发认领 → 只有一个执行体", async () => {
    const task = await mkTask("trigger-race", "idle");
    let calls = 0;
    vi.spyOn(taskRunner, "executeTaskJob").mockImplementation(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 80));
      return { action: "noop", ok: true };
    });

    const ctx = await createContextInner();

    // TriggerEngine.executeTask 与 TaskService.run 共用 claimTaskRun
    const triggerPromise = (async () => {
      const claimed = await claimTaskRun(prisma, task.id);
      if (!claimed) return { claimed: false as const };
      await taskRunner.executeTaskJob(prisma, {
        id: task.id,
        name: task.name,
        type: task.type,
        input: task.input,
      });
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "success", output: { ok: true } },
      });
      return { claimed: true as const };
    })();

    const servicePromise = ctx.services.task.run(task.id);

    const [trig, svc] = await Promise.all([triggerPromise, servicePromise]);
    const claimedCount = (trig.claimed ? 1 : 0) + (svc.success ? 1 : 0);
    expect(claimedCount).toBe(1);
    expect(calls).toBe(1);
  });
});

describe("C7 TaskScheduler 经 TaskService.run 共用认领", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.task.deleteMany({ where: { name: { startsWith: PREFIX } } });
  });

  it("cron 入口不再 check-then-act：running 时 run 落选不二次执行", async () => {
    const task = await mkTask("cron-skip", "running");
    const spy = vi.spyOn(taskRunner, "executeTaskJob");
    const ctx = await createContextInner();
    const result = await ctx.services.task.run(task.id);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TASK_ALREADY_RUNNING");
    expect(spy).not.toHaveBeenCalled();
  });
});
