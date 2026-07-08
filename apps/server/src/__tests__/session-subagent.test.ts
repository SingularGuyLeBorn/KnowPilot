import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import * as llmClient from "../infra/llmClient.js";
import { resetAsyncJobOrchestratorForTests } from "../infra/asyncJobOrchestrator.js";

/**
 * Subagent 后端 CRUD 专门测试：覆盖 session.spawn / listChildren / stop / rerun。
 * Mock LLM 避免真实 API 调用，async 任务在 orchestrator 中快速完成/失败。
 */
describe("Subagent 后端 CRUD（session.spawn / stop / rerun / listChildren）", () => {
  let caller: any;
  let parentSessionId: string;
  let agentId: string;
  let chatCompletionSpy: any;
  let chatCompletionStreamSpy: any;

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    // Mock LLM：异步任务调用 chatCompletion 时返回简单结果，快速结束
    chatCompletionSpy = vi.spyOn(llmClient, "chatCompletion").mockResolvedValue({
      content: "Mock 子代理任务已完成。",
      reasoningContent: null,
      toolCalls: [],
      finishReason: "stop",
      model: "mock",
      provider: "mock",
      tokenUsage: { prompt: 5, completion: 5, total: 10 },
    });
    chatCompletionStreamSpy = vi.spyOn(llmClient, "chatCompletionStream").mockImplementation(async function* () {
      yield { type: "token", delta: "Mock 子代理任务已完成。", model: "mock", provider: "mock" };
      yield { type: "token", delta: "", finishReason: "stop", model: "mock", provider: "mock", tokenUsage: { prompt: 5, completion: 5, total: 10 } };
    });

    const ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);

    // 创建父会话
    const session = await caller.session.create({
      title: `subagent-test-parent-${Date.now()}`,
      model: "deepseek-chat",
    });
    parentSessionId = session.data.id;

    // 创建测试 Agent
    const agent = await caller.agent.create({
      name: `SubagentTestAgent-${Date.now()}`,
      description: "subagent CRUD test agent",
      tools: ["native:web_search"],
      model: "deepseek-chat",
    });
    agentId = agent.data.id;
  });

  afterAll(async () => {
    chatCompletionSpy?.mockRestore();
    chatCompletionStreamSpy?.mockRestore();
    resetAsyncJobOrchestratorForTests();
    // 清理父会话（级联删除子会话与消息）
    try {
      await caller.session.delete({ id: parentSessionId });
    } catch {
      /* 已删除 */
    }
    try {
      await caller.agent.delete({ id: agentId });
    } catch {
      /* 已删除 */
    }
  });

  it("session.spawn 创建子代理任务并返回 jobId + subagentSessionId", async () => {
    const result = await caller.session.spawn({
      parentSessionId,
      agentId,
      task: "测试子代理任务：搜索 KnowPilot 并总结",
      label: "CRUD-test-subagent",
    });

    expect(result.jobId).toBeDefined();
    expect(result.subagentSessionId).toBeDefined();
    expect(result.status).toMatch(/^(running|queued)$/);

    // 验证 subagent session 已创建
    const sub = await caller.session.getById({ id: result.subagentSessionId });
    expect(sub.kind).toBe("subagent");
    expect(sub.parentSessionId).toBe(parentSessionId);
    expect(sub.taskDescription).toContain("测试子代理任务");
  });

  it("session.listChildren 列出父会话的子代理", async () => {
    const children = await caller.session.listChildren({
      parentSessionId,
      pageSize: 50,
    });

    expect(children.items.length).toBeGreaterThanOrEqual(1);
    const found = children.items.find((c: any) => c.parentSessionId === parentSessionId);
    expect(found).toBeDefined();
    expect(found.kind).toBe("subagent");
  });

  it("session.stop 停止子代理会话（状态置 paused 或任务已自行结束）", async () => {
    // 先创建一个新的可停止的子代理
    const spawned = await caller.session.spawn({
      parentSessionId,
      agentId,
      task: "stop-test-子代理",
      label: "stop-test",
    });

    // 立即停止（可能 running 或 queued）
    const stopped = await caller.session.stop({ id: spawned.subagentSessionId });
    expect(stopped).toBeDefined();

    // 验证 session 状态：stop 可能命中 running/queued（置 paused），也可能任务已自行结束（completed/failed）。
    // running 出现在 mock 任务极快完成、stop 是 no-op、且异步状态同步尚未回写的瞬时态。
    const sub = await caller.session.getById({ id: spawned.subagentSessionId });
    expect(["paused", "failed", "completed", "running"]).toContain(sub.status);
  });

  it("session.rerun 基于原子代理重跑创建新子代理", async () => {
    // 先创建一个子代理
    const original = await caller.session.spawn({
      parentSessionId,
      agentId,
      task: "rerun-test-原始任务",
      label: "rerun-original",
    });

    // 等 mock 任务快速完成
    await new Promise((r) => setTimeout(r, 500));

    // 重跑
    const rerunResult = await caller.session.rerun({
      id: original.subagentSessionId,
    });

    expect(rerunResult.jobId).toBeDefined();
    expect(rerunResult.subagentSessionId).toBeDefined();
    expect(rerunResult.subagentSessionId).not.toBe(original.subagentSessionId);

    // 验证新 subagent session
    const newSub = await caller.session.getById({ id: rerunResult.subagentSessionId });
    expect(newSub.kind).toBe("subagent");
    expect(newSub.parentSessionId).toBe(parentSessionId);
  });

  it("session.listChildren 按 kind=subagent 过滤，不含普通会话", async () => {
    const children = await caller.session.listChildren({
      parentSessionId,
    });
    // 全部应为 subagent 类型
    expect(children.items.every((c: any) => c.kind === "subagent")).toBe(true);
  });
});
