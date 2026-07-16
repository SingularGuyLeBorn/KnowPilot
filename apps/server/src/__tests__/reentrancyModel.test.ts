/**
 * C-1 可重入性基座 — 负向断言测试
 *
 * 覆盖：
 * 1. inferTaskReentrant 任务级推断（tool 任务按工具声明；llm 任务全体取最严；native: 前缀归一化；未知=false）
 * 2. startAsyncAgentTask 入队物化（retryCount=0 / maxRetries=config 快照 / reentrant=推断值）
 * 3. retryAsyncJob 手动重试：新行 retryCount=0 且不受 config.maxRetries 拦截（旧实现递增超限报错，必红）
 * 4. 迁移默认：直接 prisma.task.create 不写新列 → 默认 retryCount=0 / maxRetries=2 / reentrant=false
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentRuntime from "../infra/agentRuntime.js";
import { createContextInner } from "../trpc/context.js";
import {
  inferTaskReentrant,
  startAsyncAgentTask,
  retryAsyncJob,
} from "../infra/asyncJobManager.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";
import { registerNativeDomains } from "../infra/tools/native/index.js";

const ASYNC_KIND = "async_agent";
/** 测试专属 sessionId 前缀，afterEach 按此前缀清理 Task 行 */
const sessionId = "cltestreentrancy00001";

const MOCK_LOOP_RESULT = {
  content: "后台结果",
  toolCalls: [],
  tokenUsage: { prompt: 1, completion: 2, total: 3 },
  model: "deepseek-chat",
  provider: "deepseek",
  roundsUsed: 1,
};

beforeAll(() => {
  // 灌入全部 native 工具（注册表幂等覆盖），inferTaskReentrant 依赖注册表 reentrant 声明
  registerNativeDomains();
});

beforeEach(() => {
  resetAsyncJobOrchestratorForTests();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.task.deleteMany({ where: { sessionId } });
});

describe("inferTaskReentrant 任务级推断", () => {
  it("纯 LLM 无工具（空数组）= true", () => {
    expect(inferTaskReentrant({ mode: "llm", agentTools: [] })).toBe(true);
  });

  it("全部为 reentrant 工具 = true（含裸名与 native: 前缀归一化）", () => {
    expect(inferTaskReentrant({ mode: "llm", agentTools: ["native:web_search"] })).toBe(true);
    expect(inferTaskReentrant({ mode: "llm", agentTools: ["web_search", "read_file"] })).toBe(true);
  });

  it("含任一非 reentrant 工具 = false（全体取最严）", () => {
    expect(inferTaskReentrant({ mode: "llm", agentTools: ["native:web_search", "native:write_file"] })).toBe(false);
  });

  it("未知工具 / skill:* / mcp:* 查不到注册表 = false（保守）", () => {
    expect(inferTaskReentrant({ mode: "llm", agentTools: ["native:no_such_tool"] })).toBe(false);
    expect(inferTaskReentrant({ mode: "llm", agentTools: ["skill:whatever"] })).toBe(false);
    expect(inferTaskReentrant({ mode: "llm", agentTools: ["mcp:some-server"] })).toBe(false);
  });

  it("tool 任务按其工具声明：web_search = true、write_file = false", () => {
    expect(inferTaskReentrant({ mode: "tool", toolCall: { tool: "web_search", args: { query: "x" } } })).toBe(true);
    expect(inferTaskReentrant({ mode: "tool", toolCall: { tool: "write_file", args: {} } })).toBe(false);
  });

  it("tool 任务未知工具 = false；toolCall 缺失 = false", () => {
    expect(inferTaskReentrant({ mode: "tool", toolCall: { tool: "no_such_tool", args: {} } })).toBe(false);
    expect(inferTaskReentrant({ mode: "tool" })).toBe(false);
  });
});

describe("startAsyncAgentTask 入队物化", () => {
  it("llm 空工具任务：retryCount=0、maxRetries=config 值、reentrant=true", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue(MOCK_LOOP_RESULT);
    const ctx = await createContextInner();
    const started = await startAsyncAgentTask({
      sessionId,
      task: "纯推理任务",
      label: "物化-llm-空工具",
      config: ctx.config,
      services: ctx.services,
      agent: { id: "t", model: "deepseek-chat", systemPrompt: "test", tools: [] },
    });

    const row = await prisma.task.findUnique({ where: { id: started.jobId } });
    expect(row?.retryCount).toBe(0);
    expect(row?.maxRetries).toBe(ctx.config.asyncJobs.maxRetries);
    expect(row?.reentrant).toBe(true);

    await vi.waitFor(
      async () => {
        const r = await prisma.task.findUnique({ where: { id: started.jobId } });
        expect(r?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );
  });

  it("llm 含写工具任务：reentrant=false", async () => {
    vi.spyOn(agentRuntime, "runAgentLoop").mockResolvedValue(MOCK_LOOP_RESULT);
    const ctx = await createContextInner();
    const started = await startAsyncAgentTask({
      sessionId,
      task: "搜索并写文件",
      label: "物化-llm-写工具",
      config: ctx.config,
      services: ctx.services,
      agent: { id: "t", model: "deepseek-chat", systemPrompt: "test", tools: ["native:web_search", "native:write_file"] },
    });

    const row = await prisma.task.findUnique({ where: { id: started.jobId } });
    expect(row?.retryCount).toBe(0);
    expect(row?.reentrant).toBe(false);
  });

  it("tool 任务按 toolCall 物化：wait=true、async_task_cancel=false", async () => {
    const ctx = await createContextInner();
    const reentrantTask = await startAsyncAgentTask({
      sessionId,
      task: "等待 30ms",
      label: "物化-tool-true",
      config: ctx.config,
      services: ctx.services,
      agent: { id: "t", model: "deepseek-chat", systemPrompt: "test", tools: ["native:wait"] },
      mode: "tool",
      toolCall: { tool: "wait", args: { ms: 30 } },
    });
    const rowTrue = await prisma.task.findUnique({ where: { id: reentrantTask.jobId } });
    expect(rowTrue?.retryCount).toBe(0);
    expect(rowTrue?.maxRetries).toBe(ctx.config.asyncJobs.maxRetries);
    expect(rowTrue?.reentrant).toBe(true);

    // async_task_cancel 有副作用（取消任务）→ false；对不存在 jobId 执行无害（返回 cancelled:false）
    const writeTask = await startAsyncAgentTask({
      sessionId,
      task: "取消不存在的任务",
      label: "物化-tool-false",
      config: ctx.config,
      services: ctx.services,
      agent: { id: "t", model: "deepseek-chat", systemPrompt: "test", tools: ["native:async_task_cancel"] },
      mode: "tool",
      toolCall: { tool: "async_task_cancel", args: { jobId: "nonexistent-job-id" } },
    });
    const rowFalse = await prisma.task.findUnique({ where: { id: writeTask.jobId } });
    expect(rowFalse?.retryCount).toBe(0);
    expect(rowFalse?.reentrant).toBe(false);

    await vi.waitFor(
      async () => {
        const a = await prisma.task.findUnique({ where: { id: reentrantTask.jobId } });
        const b = await prisma.task.findUnique({ where: { id: writeTask.jobId } });
        expect(a?.status).toBe("success");
        expect(b?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );
  });
});

describe("retryAsyncJob 手动重试（人工是最后一道闸）", () => {
  it("新行 retryCount=0 且不受 config.maxRetries 拦截（旧实现递增超限报错，必红）", async () => {
    const ctx = await createContextInner();
    // maxRetries=0：旧实现 retryCount 递增到 1 > 0 直接抛「最多只能重试」，新实现手动不设限
    const zeroRetryConfig = {
      ...ctx.config,
      asyncJobs: { ...ctx.config.asyncJobs, maxRetries: 0 },
    };
    const failed = await prisma.task.create({
      data: {
        name: "[async] 手动重试源",
        type: "async_agent",
        status: "failed",
        sessionId,
        input: {
          kind: ASYNC_KIND,
          sessionId,
          task: "等待 30ms",
          taskLabel: "手动重试源",
          agentSnapshot: { id: "t", model: "m", systemPrompt: "", tools: ["native:wait"] },
          sourceType: "async_task_tool",
          toolCall: { tool: "wait", args: { ms: 30 } },
        },
        output: { error: "模拟失败" },
      },
    });

    const retried = await retryAsyncJob(failed.id, zeroRetryConfig, ctx.services);
    expect(retried.status).toBe("running");
    expect(retried.message).toContain("手动重试");

    const row = await prisma.task.findUnique({ where: { id: retried.jobId } });
    expect(row?.retryCount).toBe(0);
    expect(row?.maxRetries).toBe(0);
    expect(row?.reentrant).toBe(true);
    // input 不再携带 retryCount（单一事实源 = Task 列）
    expect((row?.input as Record<string, unknown>).retryCount).toBeUndefined();

    await vi.waitFor(
      async () => {
        const r = await prisma.task.findUnique({ where: { id: retried.jobId } });
        expect(r?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );

    // 连续第二次手动重试同样不被拦截（手动次数不设限）
    await prisma.task.update({ where: { id: retried.jobId }, data: { status: "failed" } });
    const retried2 = await retryAsyncJob(retried.jobId, zeroRetryConfig, ctx.services);
    const row2 = await prisma.task.findUnique({ where: { id: retried2.jobId } });
    expect(row2?.retryCount).toBe(0);
    await vi.waitFor(
      async () => {
        const r = await prisma.task.findUnique({ where: { id: retried2.jobId } });
        expect(r?.status).toBe("success");
      },
      { timeout: 5000, interval: 50 },
    );
  });
});

describe("迁移列默认值", () => {
  it("直接 prisma.task.create 不写新列 → 默认 retryCount=0 / maxRetries=2 / reentrant=false", async () => {
    const task = await prisma.task.create({
      data: { name: "存量行模拟", type: "cron", status: "queued", sessionId },
    });
    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.retryCount).toBe(0);
    expect(row?.maxRetries).toBe(2);
    expect(row?.reentrant).toBe(false);
  });
});
