/**
 * 僵尸任务启动恢复 — 服务重启一律不自动续跑（用户明确要求，reentrancy 基座已整体撤销）。
 *
 * recoverStaleAsyncJobs 统一标 failed「服务重启，任务中断」：
 * - 不再按 reentrant/maxRetries 分叉续跑；reentrant/maxRetries/retryCount 三列已从 schema 删除。
 * - runAgentLoop 不被调用（零重建执行体）。
 *
 * 覆盖：
 * - T1 僵尸任务：统一标 failed、runAgentLoop 零调用
 * - T2 幂等：已 failed 的僵尸二次恢复 count=0，终态稳定
 * - T3 手动 retryAsyncJob 仍可重试（人工最后一道闸）
 * - T4 恢复风暴：50 个僵尸全部标 failed，不入池、零并发
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
async function mkZombie(opts: { sessionId: string; label: string; mode?: "llm" | "tool" }) {
  const mode = opts.mode ?? "llm";
  return prisma.task.create({
    data: {
      name: `[async] ${opts.label}`,
      type: "async_agent",
      status: "running",
      sessionId: opts.sessionId,
      startedAt: new Date(),
      input: {
        kind: ASYNC_KIND,
        sessionId: opts.sessionId,
        task: opts.label,
        taskLabel: opts.label,
        agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: mode === "tool" ? ["native:wait"] : [] },
        sourceType: mode === "tool" ? "async_task_tool" : "async_task_llm",
        toolCall: mode === "tool" ? { tool: "wait", args: { ms: 30 } } : undefined,
        deliverToQueue: false,
      },
    },
  });
}

beforeAll(() => {
  registerNativeDomains();
});

beforeEach(() => {
  resetAsyncJobOrchestratorForTests();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.task.deleteMany({ where: { sessionId: { startsWith: SID } } });
});

describe("僵尸任务启动恢复（服务重启不自动续跑）", () => {
  it("T1 僵尸任务：统一标 failed、runAgentLoop 零调用", async () => {
    const loopSpy = vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue(MOCK_LOOP_RESULT);
    const ctx = await createContextInner();
    const zombie = await mkZombie({ sessionId: `${SID}-t1`, label: "T1 僵尸" });

    const result = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(result.failed).toBe(1);

    const row = await prisma.task.findUnique({ where: { id: zombie.id } });
    expect(row?.status).toBe("failed");
    expect((row?.output as { error?: string })?.error).toContain("服务重启，任务中断");
    expect(loopSpy).not.toHaveBeenCalled();
  });

  it("T2 幂等：已 failed 的僵尸二次恢复 count=0，终态稳定", async () => {
    const ctx = await createContextInner();
    const zombie = await mkZombie({ sessionId: `${SID}-t2`, label: "T2 幂等" });

    const r1 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r1.failed).toBe(1);
    const r2 = await recoverStaleAsyncJobs(ctx.config, ctx.services);
    expect(r2.failed).toBe(0);

    const row = await prisma.task.findUnique({ where: { id: zombie.id } });
    expect(row?.status).toBe("failed");
  });

  it("T3 手动 retryAsyncJob 仍可重试（人工最后一道闸）", async () => {
    const ctx = await createContextInner();
    const exhausted = await prisma.task.create({
      data: {
        name: "[async] T3 耗尽",
        type: "async_agent",
        status: "failed",
        sessionId: `${SID}-t3`,
        input: {
          kind: ASYNC_KIND,
          sessionId: `${SID}-t3`,
          task: "等待 30ms",
          taskLabel: "T3 耗尽",
          agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: ["native:wait"] },
          sourceType: "async_task_tool",
          toolCall: { tool: "wait", args: { ms: 30 } },
          deliverToQueue: false,
        },
        output: { error: "服务重启，任务中断" },
      },
    });

    const retried = await retryAsyncJob(exhausted.id, ctx.config, ctx.services);
    await vi.waitFor(
      async () => {
        const r = await prisma.task.findUnique({ where: { id: retried.jobId } });
        expect(r?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );
  });

  it(
    "T4 恢复风暴：50 个僵尸全部标 failed，不入池、零并发",
    async () => {
      const loopSpy = vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue(MOCK_LOOP_RESULT);
      const ctx = await createContextInner();
      const narrow = createTestConfig(ctx.config.projectRoot, {
        ...ctx.config,
        asyncJobs: { ...ctx.config.asyncJobs, maxConcurrent: 3, maxPerSession: 100, maxQueued: 100 },
      });
      getAsyncJobOrchestrator(narrow);

      const COUNT = 50;
      const ids: string[] = [];
      for (let i = 0; i < COUNT; i++) {
        const t = await mkZombie({ sessionId: `${SID}-t4-${i}`, mode: "tool", label: `T4-${i}` });
        ids.push(t.id);
      }

      const r = await recoverStaleAsyncJobs(narrow, ctx.services);
      expect(r.failed).toBe(COUNT);

      const rows = await prisma.task.findMany({ where: { id: { in: ids } }, select: { status: true } });
      expect(rows).toHaveLength(COUNT);
      expect(rows.every((x) => x.status === "failed")).toBe(true);
      expect(loopSpy).not.toHaveBeenCalled();
    },
    60_000,
  );
});
