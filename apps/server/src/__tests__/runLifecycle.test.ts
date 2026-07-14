/**
 * W11：Run 活状态 + awaiting_human 挂起/唤醒 + 审批续跑 + interrupted 恢复
 *
 * 覆盖（验收标准）：
 * 1. 审批 pending → run 挂起（phase=awaiting_human，Run 行 running + output.phase 可查）
 *    → approveAndExecute → approval_resolved 事件唤醒 → 同 session 注入续跑消息 → run 正常完成
 * 2. 审批 reject → 注入拒绝消息 → LLM 自行收尾，run 正常结束（success）而非断裂
 * 3. 审批 TTL 过期 → 注入过期消息 → LLM 收尾；审批行由 waiter 截止机制翻转（system-ttl）
 * 4. recoverStaleRuns：遗留 running Run 标 interrupted，success 行不动
 * 5. 活状态快照节流：连续两轮 tool_batch（<5s）只写一次快照；终态 update 携带 toolCallCount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { runReactLoop } from "../infra/loop/reactLoop.js";
import type { ReactLoopInput, LlmTransport } from "../infra/loop/types.js";
import type { LlmMessage, LlmToolCall } from "../infra/llmClient.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";
import { listNativeTools } from "../infra/nativeTools.js";
import { recoverStaleRuns } from "../infra/asyncJobManager.js";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";

function tc(id: string, name: string, args: Record<string, unknown>): LlmToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** 脚本化 transport：按序返回 toolCalls/content，并记录每次 complete 收到的 messages */
function recordingTransport(steps: Array<{ toolCalls?: LlmToolCall[]; content?: string }>) {
  const calls: LlmMessage[][] = [];
  let i = 0;
  const transport: LlmTransport = {
    async complete({ messages }) {
      calls.push([...messages]);
      const step = steps[Math.min(i++, steps.length - 1)];
      return {
        content: step.content ?? "",
        toolCalls: step.toolCalls ?? [],
        model: "test-model",
        provider: "test",
      };
    },
  };
  return { transport, calls };
}

function stubServices() {
  const runCreate = vi.fn(async (_input: Record<string, unknown>) => ({
    success: true,
    data: { id: "run-stub" },
  }));
  const runUpdate = vi.fn(async (_input: Record<string, unknown>) => ({
    success: true,
    data: { id: "run-stub" },
  }));
  const services = { run: { create: runCreate, update: runUpdate } } as unknown as ServiceContainer;
  return { services, runCreate, runUpdate };
}

describe("W11 Run 活状态 + awaiting_human", () => {
  let root: string;
  const prevDestructive = process.env.AGENT_DESTRUCTIVE_APPROVAL;
  const prevRequire = process.env.REQUIRE_APPROVAL;
  const prevTtl = process.env.APPROVAL_PENDING_TTL_MS;

  beforeEach(() => {
    root = createTempProjectDir();
    listNativeTools(); // 确保 native 工具已注册（其他测试文件可能清空过 registry）
    process.env.AGENT_DESTRUCTIVE_APPROVAL = "true";
    process.env.REQUIRE_APPROVAL = "true";
    delete process.env.APPROVAL_PENDING_TTL_MS;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (prevDestructive === undefined) delete process.env.AGENT_DESTRUCTIVE_APPROVAL;
    else process.env.AGENT_DESTRUCTIVE_APPROVAL = prevDestructive;
    if (prevRequire === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = prevRequire;
    if (prevTtl === undefined) delete process.env.APPROVAL_PENDING_TTL_MS;
    else process.env.APPROVAL_PENDING_TTL_MS = prevTtl;
  });

  /** 真实 services + agent/session/memory 的一套审批挂起场景；返回挂起中的 loop 与探测钩子 */
  async function setupPendingApprovalScenario(opts?: { secondContent?: string }) {
    const ctx = await createContextInner();
    const services = ctx.services as ServiceContainer;
    const caller = appRouter.createCaller(ctx);

    const stamp = Date.now();
    const mem = await services.memory.create({ content: `w11-mem-${stamp}`, type: "note", strength: 0.5, keywords: [] });
    const memoryId = (mem.data as { id: string }).id;
    const agent = await services.agent.create({
      name: `w11-agent-${stamp}`,
      description: "w11 test",
      model: "test-model",
      systemPrompt: "",
      tools: ["native:memory_delete"],
    } as Parameters<typeof services.agent.create>[0]);
    const agentId = (agent.data as { id: string }).id;
    const sess = await services.session.create({
      title: "w11 session",
      model: "test-model",
      agentId,
    } as Parameters<typeof services.session.create>[0]);
    const sessionId = (sess.data as { id: string }).id;

    const phases: string[] = [];
    let awaitingResolve!: () => void;
    const awaitingReached = new Promise<void>((r) => (awaitingResolve = r));

    const { transport, calls } = recordingTransport([
      { toolCalls: [tc("c1", "memory_delete", { id: memoryId })] },
      { content: opts?.secondContent ?? "收尾完成" },
    ]);

    const input: ReactLoopInput = {
      config: createTestConfig(root),
      services,
      agent: { model: "test-model", systemPrompt: "", tools: ["native:memory_delete"] },
      messages: [{ role: "user", content: "删掉那条记忆" }],
      invokeTrpc: async () => ({}),
      transport,
      sessionId,
      agentMeta: { id: agentId, model: "test-model", systemPrompt: "", tools: ["native:memory_delete"], tier: "manager" },
      runOrigin: "user",
      hooks: {
        onPhase: (to, from) => {
          phases.push(`${from}->${to}`);
        },
        // 挂起同步点：onProgress 在「phase=awaiting_human 强制快照落库」之后触发，
        // 此刻读 Run 行必见 awaiting_human（onPhase 是转移瞬间同步触发，不能用作落库同步点）
        onProgress: (message) => {
          if (message.includes("等待人工审批")) awaitingResolve();
        },
      },
    };

    const loopPromise = runReactLoop(input);
    // 避免挂起期间未 await 造成的 unhandled rejection
    loopPromise.catch(() => {});
    return { ctx, services, caller, memoryId, agentId, sessionId, phases, awaitingReached, loopPromise, calls };
  }

  it("审批 pending → 挂起（phase=awaiting_human）→ approve → 同 session 续跑完成", async () => {
    const s = await setupPendingApprovalScenario();

    // run 挂起点（若 loop 未挂起就结束，race 立刻报错而非干等）
    await Promise.race([
      s.awaitingReached,
      s.loopPromise.then(
        () => {
          throw new Error("loop 未进入 awaiting_human 就结束了");
        },
        (e) => {
          throw e;
        },
      ),
    ]);

    // 挂起态可查：Run 行 status=running 且 output.phase=awaiting_human
    const runningRun = await s.ctx.prisma.run.findFirst({
      where: { status: "running" },
      orderBy: { createdAt: "desc" },
    });
    expect(runningRun).toBeTruthy();
    expect((runningRun!.output as { phase: string }).phase).toBe("awaiting_human");
    expect(s.phases).toContain("tool_batch->awaiting_human");
    // 审批前操作未执行
    expect(await s.services.memory.getById(s.memoryId)).toBeTruthy();

    // 人工批准并执行 → approval_resolved 显式事件唤醒
    const pendings = await s.services.approval.list({ page: 1, pageSize: 20, status: "pending" });
    const record = pendings.items.find(
      (i: { toolName: string; args: { id?: string } }) => i.toolName === "memory_delete" && i.args?.id === s.memoryId,
    );
    expect(record).toBeDefined();
    const executed = await s.caller.approval.approveAndExecute({ id: record!.id });
    expect(executed.success).toBe(true);

    const result = await s.loopPromise;
    expect(result.content).toBe("收尾完成");
    expect(result.runId).toBeDefined();
    // 合法转移链：awaiting_human → llm → done
    expect(s.phases).toContain("awaiting_human->llm");
    expect(s.phases[s.phases.length - 1]).toBe("llm->done");

    // 操作已由审批流程真实执行
    await expect(s.services.memory.getById(s.memoryId)).rejects.toThrow();

    // Run 终态：success + output.phase=done
    const finalRun = await s.ctx.prisma.run.findUnique({ where: { id: result.runId! } });
    expect(finalRun!.status).toBe("success");
    expect((finalRun!.output as { phase: string }).phase).toBe("done");

    // 第二轮 LLM 收到续跑注入消息（含执行结果）
    const second = s.calls[1];
    const resumeMsg = second.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("人工审批已通过"),
    );
    expect(resumeMsg).toBeDefined();

    // 同 session 注入落库（前端 message_upserted 路径）
    const msgs = await s.services.message.list({ sessionId: s.sessionId, page: 1, pageSize: 50 });
    expect(
      msgs.items.some(
        (m: { role: string; content: string }) => m.role === "user" && m.content.includes("人工审批已通过"),
      ),
    ).toBe(true);
  });

  it("审批 reject → LLM 收到拒绝信息并收尾，run 正常结束", async () => {
    const s = await setupPendingApprovalScenario({ secondContent: "好的，操作已取消" });
    await s.awaitingReached;

    const pendings = await s.services.approval.list({ page: 1, pageSize: 20, status: "pending" });
    const record = pendings.items.find(
      (i: { toolName: string; args: { id?: string } }) => i.toolName === "memory_delete" && i.args?.id === s.memoryId,
    );
    expect(record).toBeDefined();
    const rejected = await s.caller.approval.update({ id: record!.id, status: "rejected" });
    expect(rejected.success).toBe(true);

    const result = await s.loopPromise;
    expect(result.content).toBe("好的，操作已取消");
    expect(s.phases).toContain("awaiting_human->llm");

    // 拒绝不执行操作
    expect(await s.services.memory.getById(s.memoryId)).toBeTruthy();

    // 第二轮收到拒绝注入
    const second = s.calls[1];
    const rejectMsg = second.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("人工审批被拒绝"),
    );
    expect(rejectMsg).toBeDefined();

    // run 正常结束而非断裂
    const finalRun = await s.ctx.prisma.run.findUnique({ where: { id: result.runId! } });
    expect(finalRun!.status).toBe("success");

    await s.services.memory.delete(s.memoryId).catch(() => undefined);
  });

  it("审批 TTL 过期 → 注入过期消息收尾，审批行被 waiter 截止机制翻转", async () => {
    process.env.APPROVAL_PENDING_TTL_MS = "200";
    const s = await setupPendingApprovalScenario({ secondContent: "审批过期，已告知用户" });
    await s.awaitingReached;

    const pendings = await s.services.approval.list({ page: 1, pageSize: 20, status: "pending" });
    const record = pendings.items.find(
      (i: { toolName: string; args: { id?: string } }) => i.toolName === "memory_delete" && i.args?.id === s.memoryId,
    );
    expect(record).toBeDefined();

    // 不人工决策：waiter 的 TTL 截止机制（与 expireStaleApprovals 同规则）到期翻转并唤醒
    const result = await s.loopPromise;
    expect(result.content).toBe("审批过期，已告知用户");

    // 审批行被翻转为 rejected（system-ttl）
    const approvalRow = await s.ctx.prisma.approval.findUnique({ where: { id: record!.id } });
    expect(approvalRow!.status).toBe("rejected");
    expect(approvalRow!.decidedBy).toBe("system-ttl");

    // 第二轮收到过期注入
    const second = s.calls[1];
    const expiredMsg = second.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("已过期"),
    );
    expect(expiredMsg).toBeDefined();

    const finalRun = await s.ctx.prisma.run.findUnique({ where: { id: result.runId! } });
    expect(finalRun!.status).toBe("success");

    await s.services.memory.delete(s.memoryId).catch(() => undefined);
  });

  it("recoverStaleRuns：遗留 running Run 标 interrupted，success 行不动", async () => {
    const ctx = await createContextInner();
    const staleA = await ctx.prisma.run.create({ data: { status: "running", input: { t: "a" } } });
    const staleB = await ctx.prisma.run.create({ data: { status: "running", input: { t: "b" } } });
    const okRun = await ctx.prisma.run.create({ data: { status: "success", input: { t: "c" } } });

    try {
      const n = await recoverStaleRuns();
      expect(n).toBeGreaterThanOrEqual(2);
      expect((await ctx.prisma.run.findUnique({ where: { id: staleA.id } }))!.status).toBe("interrupted");
      expect((await ctx.prisma.run.findUnique({ where: { id: staleB.id } }))!.status).toBe("interrupted");
      expect((await ctx.prisma.run.findUnique({ where: { id: okRun.id } }))!.status).toBe("success");
    } finally {
      await ctx.prisma.run.deleteMany({ where: { id: { in: [staleA.id, staleB.id, okRun.id] } } });
    }
  });

  it("活状态快照节流：连续两轮 tool_batch 只写一次快照，终态 update 携带 toolCallCount", async () => {
    const { services, runCreate, runUpdate } = stubServices();
    const { transport } = recordingTransport([
      { toolCalls: [tc("c1", "write_file", { path: "a.txt", content: "1" })] },
      { toolCalls: [tc("c2", "write_file", { path: "b.txt", content: "2" })] },
      { content: "done" },
    ]);

    const input: ReactLoopInput = {
      config: createTestConfig(root),
      services,
      agent: { model: "test-model", systemPrompt: "", tools: ["native:write_file"] },
      messages: [{ role: "user", content: "go" }],
      invokeTrpc: async () => ({}),
      transport,
      runOrigin: "user",
    };
    const result = await runReactLoop(input);

    expect(result.content).toBe("done");
    // 入口落 running 行
    expect(runCreate).toHaveBeenCalledTimes(1);
    expect((runCreate.mock.calls[0][0] as { status: string }).status).toBe("running");

    // 快照：两轮 tool_batch 在 5s 节流窗内 → 只写第一轮（phase=tool_batch, roundsUsed=1, executedToolsCount=1）
    const snapshots = runUpdate.mock.calls
      .map((c) => c[0] as unknown as { status?: string; output?: Record<string, unknown> })
      .filter((u) => u.status === undefined);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].output).toMatchObject({ phase: "tool_batch", roundsUsed: 1, executedToolsCount: 1 });

    // 终态 success：output.phase=done + toolCallCount=2
    const terminal = runUpdate.mock.calls
      .map((c) => c[0] as unknown as { status?: string; output?: Record<string, unknown>; toolCallCount?: number })
      .filter((u) => u.status === "success");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].output).toMatchObject({ phase: "done", roundsUsed: 3, executedToolsCount: 2 });
    expect(terminal[0].toolCallCount).toBe(2);
  });
});
