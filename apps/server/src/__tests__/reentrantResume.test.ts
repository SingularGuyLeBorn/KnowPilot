/**
 * C-2 僵尸任务自动续跑 — 负向断言测试
 *
 * recoverStaleAsyncJobs 同函数内两态分叉（不新造恢复管线）：
 * - reentrant=true 且 retryCount<maxRetries → retryCount+1 先落库（crash-loop 防护即账本）
 *   + 状态重置 queued + 从 input 重建执行体入 v8 全局池；
 * - 否则维持 R-2 语义标 failed，error 两态文案。
 *
 * 覆盖：
 * - T1 reentrant 僵尸自动续跑跑完、retryCount=1、Task success（旧实现 failed 躺尸必红）
 * - T2 crash-loop：必抛错执行体重跑到 maxRetries 上限后标 failed「需人工介入」不再入池
 * - T3 reentrant=false 僵尸零误伤：failed「服务重启，任务中断」、retryCount 不变
 * - T4 简版：手动 retryAsyncJob 清零（自动计数不堵人工）
 * - T5 恢复风暴：50 个 reentrant 僵尸全部入池，峰值 running ≤ maxGlobal（无新限流层）
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { createContextInner } from "../trpc/context.js";
import { recoverStaleAsyncJobs, retryAsyncJob } from "../infra/asyncJobManager.js";
import { getAsyncJobOrchestrator, resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { registerNativeDomains } from "../infra/tools/native/index.js";
import { createTestConfig } from "./helpers/toolTestFixtures.js";

const ASYNC_KIND = "async_agent";
/** 测试专属 sessionId 前缀，afterEach 按此前缀清理 Task 行 */
const SID = "cltestreentrantresume";

const MOCK_LOOP_RESULT = {
  content: "续跑完成",
  toolCalls: [],
  tokenUsage: { prompt: 1, completion: 2, total: 3 },
  model: "deepseek-chat",
  provider: "deepseek",
  roundsUsed: 1,
};

/** 构造僵尸 Task（status=running 遗留，模拟进程死亡瞬间） */
async function mkZombie(opts: {
  sessionId: string;
  reentrant: boolean;
  label: string;
  retryCount?: number;
  maxRetries?: number;
  mode?: "llm" | "tool";
}) {
  const mode = opts.mode ?? "llm";
  return prisma.task.create({
    data: {
      name: `[async] ${opts.label}`,
      type: "async_agent",
      status: "running",
      sessionId: opts.sessionId,
      startedAt: new Date(),
      retryCount: opts.retryCount ?? 0,
      maxRetries: opts.maxRetries ?? 2,
      reentrant: opts.reentrant,
      input: {
        kind: ASYNC_KIND,
        sessionId: opts.sessionId,
        task: opts.label,
        taskLabel: opts.label,
        agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: mode === "tool" ? ["native:wait"] : [] },
        sourceType: mode === "tool" ? "async_task_tool" : "async_task_llm",
        toolCall: mode === "tool" ? { tool: "wait", args: { ms: 30 } } : undefined,
        // 测试不走投递/自动消费（会话不存在，避免无关 FK 噪音）
        deliverToQueue: false,
      },
    },
  });
}

async function waitTaskStatus(jobId: string, status: string, timeoutMs = 5000) {
  await vi.waitFor(
    async () => {
      const row = await prisma.task.findUnique({ where: { id: jobId } });
      expect(row?.status).toBe(status);
    },
    { timeout: timeoutMs, interval: 50 },
  );
}

beforeAll(() => {
  // tool 模式执行体（wait）依赖注册表
  registerNativeDomains();
});

beforeEach(() => {
  resetAsyncJobOrchestratorForTests();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.task.deleteMany({ where: { sessionId: { startsWith: SID } } });
});

describe("C-2 僵尸任务自动续跑", () => {
  it("T1 reentrant 僵尸：自动续跑跑完、retryCount=1、Task success", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue(MOCK_LOOP_RESULT);
    const ctx = await createContextInner();
    const zombie = await mkZombie({ sessionId: `${SID}-t1`, reentrant: true, label: "T1 僵尸续跑" });

    const result = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(result.resumed).toBeGreaterThanOrEqual(1);

    // crash-loop 账本：retryCount 0→1 已落库（旧实现无分叉直接 failed 躺尸 → 必红）
    const claimed = await prisma.task.findUnique({ where: { id: zombie.id } });
    expect(claimed?.retryCount).toBe(1);
    expect(claimed?.status).not.toBe("failed");

    await waitTaskStatus(zombie.id, "success");
    const done = await prisma.task.findUnique({ where: { id: zombie.id } });
    expect(done?.retryCount).toBe(1);
    expect((done?.output as { asyncResult?: string })?.asyncResult).toBe("续跑完成");
  });

  it("T2 crash-loop：重跑到 maxRetries 上限后标 failed「需人工介入」不再入池", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockRejectedValue(new Error("执行体必败"));
    const ctx = await createContextInner();
    const zombie = await mkZombie({ sessionId: `${SID}-t2`, reentrant: true, maxRetries: 2, label: "T2 必败" });

    // 第 1 轮恢复：续跑 → retryCount=1 → 执行抛错 → failed
    const r1 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r1.resumed).toBe(1);
    await waitTaskStatus(zombie.id, "failed");
    expect((await prisma.task.findUnique({ where: { id: zombie.id } }))?.retryCount).toBe(1);

    // 模拟再次崩溃（遗留 running 僵尸）→ 第 2 轮恢复：续跑 → retryCount=2 → failed
    await prisma.task.update({ where: { id: zombie.id }, data: { status: "running", finishedAt: null } });
    const r2 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r2.resumed).toBe(1);
    await waitTaskStatus(zombie.id, "failed");
    expect((await prisma.task.findUnique({ where: { id: zombie.id } }))?.retryCount).toBe(2);

    // 第三次崩溃 → retryCount(2) >= maxRetries(2)：不再入池，标 failed「需人工介入」
    await prisma.task.update({ where: { id: zombie.id }, data: { status: "running", finishedAt: null } });
    const r3 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r3.resumed).toBe(0);
    expect(r3.failed).toBe(1);
    const row3 = await prisma.task.findUnique({ where: { id: zombie.id } });
    expect(row3?.status).toBe("failed");
    expect(row3?.retryCount).toBe(2);
    expect((row3?.output as { error?: string })?.error).toContain("已达自动重试上限（2 次），需人工介入");

    // 多调几次恢复：终态稳定，不再入池（runAgentLoop 调用次数停留在 2 次真实执行）
    const r4 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r4.resumed).toBe(0);
    expect(r4.failed).toBe(0);
    expect(agentRuntime.runAgentLoop).toHaveBeenCalledTimes(2);
    expect((await prisma.task.findUnique({ where: { id: zombie.id } }))?.retryCount).toBe(2);
  });

  it("T3 reentrant=false 僵尸零误伤：failed「服务重启，任务中断」、retryCount 不变", async () => {
    const loopSpy = vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue(MOCK_LOOP_RESULT);
    const ctx = await createContextInner();
    const zombie = await mkZombie({ sessionId: `${SID}-t3`, reentrant: false, label: "T3 不可重入" });

    const r = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r.resumed).toBe(0);
    expect(r.failed).toBe(1);

    const row = await prisma.task.findUnique({ where: { id: zombie.id } });
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(0);
    expect((row?.output as { error?: string })?.error).toContain("服务重启，任务中断");
    // 未重建执行体（零误伤）
    expect(loopSpy).not.toHaveBeenCalled();
  });

  it("T4 简版：自动计数耗尽后手动 retryAsyncJob 仍清零重来", async () => {
    const ctx = await createContextInner();
    const exhausted = await prisma.task.create({
      data: {
        name: "[async] T4 耗尽",
        type: "async_agent",
        status: "failed",
        sessionId: `${SID}-t4`,
        retryCount: 2,
        maxRetries: 2,
        reentrant: true,
        input: {
          kind: ASYNC_KIND,
          sessionId: `${SID}-t4`,
          task: "等待 30ms",
          taskLabel: "T4 耗尽",
          agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: ["native:wait"] },
          sourceType: "async_task_tool",
          toolCall: { tool: "wait", args: { ms: 30 } },
          deliverToQueue: false,
        },
        output: { error: "已达自动重试上限（2 次），需人工介入" },
      },
    });

    const retried = await retryAsyncJob(exhausted.id, ctx.config, ctx.services);
    const row = await prisma.task.findUnique({ where: { id: retried.jobId } });
    // 人工是最后一道闸：自动计数清零重来（C-1 语义回归保护）
    expect(row?.retryCount).toBe(0);
    expect(row?.reentrant).toBe(true);
    await waitTaskStatus(retried.jobId, "success");
  });

  it(
    "T5 恢复风暴：50 个 reentrant 僵尸全部入池，峰值 running ≤ maxGlobal（无新限流层）",
    async () => {
      const ctx = await createContextInner();
      const narrow = createTestConfig(ctx.config.projectRoot, {
        ...ctx.config,
        asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 3, maxPerSession: 100, maxQueued: 100 },
      });
      // beforeEach 已 reset：首次 get 绑定 narrow 配置（与恢复内部 getAsyncJobOrchestrator 同实例）
      const orch = getAsyncJobOrchestrator(narrow);

      const COUNT = 50;
      const ids: string[] = [];
      for (let i = 0; i < COUNT; i++) {
        const t = await mkZombie({ sessionId: `${SID}-t5-${i}`, reentrant: true, mode: "tool", label: `T5-${i}` });
        ids.push(t.id);
      }

      // 峰值采样：事件 + 定时双通道（同 globalTaskPool.test.ts 手法；不变量：任一时刻 ≤ maxGlobal）
      let peak = 0;
      const sample = () => {
        peak = Math.max(peak, orch.getStats().runningGlobal);
      };
      const offSample = orch.onAny(sample);
      const sampler = setInterval(sample, 5);

      try {
        const r = await recoverStaleAsyncJobs(narrow, ctx.services);
        expect(r.resumed).toBe(COUNT);
        expect(r.failed).toBe(0);

        // 全部跑完（30ms wait × 50 / 3 并发，留足余量）
        await vi.waitFor(
          async () => {
            const rows = await prisma.task.findMany({ where: { id: { in: ids } }, select: { status: true } });
            expect(rows).toHaveLength(COUNT);
            expect(rows.every((x) => x.status === "success")).toBe(true);
          },
          { timeout: 30_000, interval: 100 },
        );

        // 每个僵尸恰被自动续跑一次（计数落库幂等）
        const rows = await prisma.task.findMany({ where: { id: { in: ids } }, select: { retryCount: true } });
        expect(rows.every((x) => x.retryCount === 1)).toBe(true);

        // 调度/背压全交 v8 池：峰值未越 maxGlobal，且确实打满过（制造了真实并发压力）
        expect(peak).toBeLessThanOrEqual(3);
        expect(peak).toBe(3);
      } finally {
        clearInterval(sampler);
        offSample();
      }
    },
    60_000,
  );
});
