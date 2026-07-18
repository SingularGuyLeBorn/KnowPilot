/**
 * C-3 会话手动恢复闭环（paused → running 续跑）— 集成测试（负向断言）
 *
 * 覆盖 v10 C-3（session.resume → SessionService.resume）：
 * - T6：paused 会话（预置 user+assistant 扁平链）resume → 真实 chatAgentStream（MOCK_LLM）
 *       推进到终态；已有 assistant 消息不重复生成、注入的系统消息（role:user, source:system）
 *       在链上、终态归位 active（chat 会话 done 口径）。
 * - T7：并发 double-resume → 条件写互斥只有一个真正起流（spy 仅调 1 次、系统消息仅 1 条），
 *       落选方幂等返回不报错；流结束后状态归位唯一。
 * - T8：非 paused（active/failed/archived）→ BAD_REQUEST 且状态不被改动；
 *       已 running → 幂等成功、不重复起流。
 *
 * 负向断言（旧实现下必红的断言逐条标注；旧实现 = 无 resume procedure / 无条件写互斥）：
 * - 旧实现无 resume procedure：三用例调用即抛「未知 procedure」，全部必红；
 * - 变异「去掉条件写 where status:"paused"」：T7 两次调用都起流，spy=2、系统消息=2，必红；
 * - 旧实现无终态归位：T6 终态停 running 永不归 active，必红。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { prisma } from "../db.js";
import * as agentStream from "../infra/agentStream.js";
import {
  __resetAskUserGateForTests,
  createAskUserPending,
} from "../infra/askUserGate.js";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import { setStreamHub, getStreamHub, SessionStreamHub } from "../infra/sessionStreamHub.js";
import type { AppConfig } from "../infra/config.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `c3${Date.now().toString(36)}`;

async function createAgent(ctx: Ctx, label: string): Promise<string> {
  const agent = await ctx.services.agent.create({
    name: `C3-${label}-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    model: "deepseek-chat",
    systemPrompt: "test",
    tools: [],
    tier: "manager",
  } as any);
  return (agent.data as { id: string }).id;
}

/** 造指定状态的会话（status 绕过 service 白名单直写 DB，模拟 R-2 标 paused 后的尸体会话） */
async function createSessionWithStatus(ctx: Ctx, agentId: string, status: string): Promise<string> {
  const session = await ctx.services.session.create({
    title: `C3 会话 ${status}`,
    model: "deepseek-chat",
    agentId,
  } as any);
  const id = (session.data as { id: string }).id;
  await prisma.chatSession.update({ where: { id }, data: { status } });
  return id;
}

async function cleanup(ids: { agentIds: string[]; sessionIds: string[] }) {
  await prisma.chatMessage.deleteMany({ where: { sessionId: { in: ids.sessionIds } } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { id: { in: ids.sessionIds } } }).catch(() => {});
  await prisma.agent.deleteMany({ where: { id: { in: ids.agentIds } } }).catch(() => {});
}

describe("C-3 会话手动恢复（session.resume）", () => {
  beforeEach(() => {
    setStreamHub(new SessionStreamHub({ ringSize: 100, persist: false, eventTtlMs: 1000, cleanupIntervalMs: 0 }));
  });

  afterEach(() => {
    setStreamHub(null);
    vi.restoreAllMocks();
    __resetAskUserGateForTests();
    delete process.env.MOCK_LLM;
  });

  it("T6 paused 会话 resume → 流推进到终态：已有 assistant 不重复、系统消息上链、终态归位 active", async () => {
    process.env.MOCK_LLM = "true";
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const agentId = await createAgent(ctx, "T6");
    const sessionId = await createSessionWithStatus(ctx, agentId, "paused");
    // 预置扁平消息链（user + assistant），模拟重启前未完成的 ReAct 轮现场
    await prisma.chatMessage.create({ data: { sessionId, role: "user", content: "历史问题：请记住数字 42" } });
    await prisma.chatMessage.create({ data: { sessionId, role: "assistant", content: "历史回答：已记住 42。" } });

    try {
      // 旧实现无 resume procedure：本调用直接抛错，全部断言必红
      const res = await caller.session.resume({ id: sessionId });
      expect(res).toMatchObject({ status: "running", resumed: true, streamStarted: true });
      // 恢复权生效：状态已到 running
      expect((await prisma.chatSession.findUnique({ where: { id: sessionId } }))?.status).toBe("running");

      // 等续跑流推进到终态（真实 chatAgentStream + MOCK_LLM 走完整 ReAct）
      await getStreamHub()!.waitFor(sessionId);

      const messages = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
      });
      // 注入的系统消息在链上（role:user, source:system），且仅一条（旧实现无注入，必红）
      const sysMsgs = messages.filter((m) => m.role === "user" && m.source === "system");
      expect(sysMsgs.length).toBe(1);
      expect(sysMsgs[0].content).toContain("服务已重启");

      // 已有 assistant 消息不重复生成：预置回答仍在且内容未变；assistant 总数只 +1（续跑新答）
      const assistants = messages.filter((m) => m.role === "assistant");
      expect(assistants.filter((m) => m.content === "历史回答：已记住 42。").length).toBe(1);
      expect(assistants.length).toBe(2);
      expect(assistants[1].content).toContain("Mock LLM");

      // 链序（容忍同毫秒）：系统消息不早于预置历史，新 assistant 不早于系统消息
      const seededAt = messages.find((m) => m.content === "历史回答：已记住 42。")!.createdAt.getTime();
      const sysAt = sysMsgs[0].createdAt.getTime();
      const newAssistantAt = assistants[1].createdAt.getTime();
      expect(sysAt).toBeGreaterThanOrEqual(seededAt);
      expect(newAssistantAt).toBeGreaterThanOrEqual(sysAt);

      // 终态归位：chat 会话 done → active（旧实现无归位，状态停 running 必红）
      expect((await prisma.chatSession.findUnique({ where: { id: sessionId } }))?.status).toBe("active");
    } finally {
      await cleanup({ agentIds: [agentId], sessionIds: [sessionId] });
    }
  }, 20_000);

  it("T7 并发 double-resume：条件写互斥只有一个起流，落选方幂等不报错", async () => {
    // spy 模拟真实 chatAgentStream 行为（写系统 user 消息 → 延迟 200ms 模拟在途流 → 写 assistant → done）。
    // 延迟保证落选方重读状态时流必未完成（running），断言无时序侥幸。
    const chatSpy = vi.spyOn(agentStream, "chatAgentStream").mockImplementation(async (s, _c, input, _inv, emit) => {
      await s.message.create({
        sessionId: input.sessionId!,
        role: "user",
        content: input.message,
        source: input.source ?? "user",
      } as any);
      await new Promise((r) => setTimeout(r, 200));
      await s.message.create({
        sessionId: input.sessionId!,
        role: "assistant",
        content: "T7 续跑回答",
        source: "system",
      } as any);
      emit({
        type: "done",
        sessionId: input.sessionId!,
        agentId: "t7-spy",
        content: "T7 续跑回答",
        toolCalls: [],
        model: "m",
        provider: "p",
        roundsUsed: 1,
      });
    });

    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const agentId = await createAgent(ctx, "T7");
    const sessionId = await createSessionWithStatus(ctx, agentId, "paused");

    try {
      const [r1, r2] = await Promise.all([
        caller.session.resume({ id: sessionId }),
        caller.session.resume({ id: sessionId }),
      ]);

      // 互斥：只有一个真正起流（变异「去掉条件写 where status:"paused"」→ spy=2，本断言必红）
      expect(chatSpy).toHaveBeenCalledTimes(1);
      // 一个获得恢复权并起流，另一个幂等返回（不报错、不起流）
      const results = [r1, r2];
      const winners = results.filter((r) => r.resumed === true && r.streamStarted === true);
      const idempotentLosers = results.filter(
        (r) => r.resumed === false && r.streamStarted === false && r.status === "running",
      );
      expect(winners.length).toBe(1);
      expect(idempotentLosers.length).toBe(1);

      // 等唯一续跑流结束
      await getStreamHub()!.waitFor(sessionId);

      // 系统消息只注入一条、assistant 只新增一条（双起流则各两条，必红）
      const messages = await prisma.chatMessage.findMany({ where: { sessionId } });
      expect(messages.filter((m) => m.role === "user" && m.source === "system").length).toBe(1);
      expect(messages.filter((m) => m.role === "assistant").length).toBe(1);

      // 流结束后状态归位唯一（chat 会话 → active）
      expect((await prisma.chatSession.findUnique({ where: { id: sessionId } }))?.status).toBe("active");
    } finally {
      await cleanup({ agentIds: [agentId], sessionIds: [sessionId] });
    }
  }, 20_000);

  it("T8 非 paused 拒绝：active/failed/archived → BAD_REQUEST；已 running → 幂等不起流", async () => {
    const chatSpy = vi.spyOn(agentStream, "chatAgentStream");
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const agentId = await createAgent(ctx, "T8");
    const sActive = await createSessionWithStatus(ctx, agentId, "active");
    const sFailed = await createSessionWithStatus(ctx, agentId, "failed");
    const sArchived = await createSessionWithStatus(ctx, agentId, "archived");
    const sRunning = await createSessionWithStatus(ctx, agentId, "running");

    try {
      for (const [id, status] of [
        [sActive, "active"],
        [sFailed, "failed"],
        [sArchived, "archived"],
      ] as const) {
        // 旧实现无 resume 时 reject 原因不同（无 procedure），code!==BAD_REQUEST 断言必红
        const err = await caller.session.resume({ id }).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeTruthy();
        expect((err as { code?: string }).code).toBe("BAD_REQUEST");
        expect(String((err as Error).message)).toContain(status);
        // 状态未被改动（拒绝不写库）
        expect((await prisma.chatSession.findUnique({ where: { id } }))?.status).toBe(status);
      }

      // 已 running → 幂等成功，不重复起流（旧实现无此幂等口径，必红）
      const res = await caller.session.resume({ id: sRunning });
      expect(res).toMatchObject({ status: "running", resumed: false, streamStarted: false });
      expect(chatSpy).not.toHaveBeenCalled();
      expect((await prisma.chatSession.findUnique({ where: { id: sRunning } }))?.status).toBe("running");
    } finally {
      await cleanup({ agentIds: [agentId], sessionIds: [sActive, sFailed, sArchived, sRunning] });
    }
  }, 20_000);

  it("T9 重复 resume 不重复注入 source:system 续跑提示消息（S1 修复负向回归）", async () => {
    process.env.MOCK_LLM = "true";
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const agentId = await createAgent(ctx, "T9");
    const sessionId = await createSessionWithStatus(ctx, agentId, "paused");

    try {
      // 第一次恢复：注入系统提示消息，流完成后状态 active
      await caller.session.resume({ id: sessionId });
      await getStreamHub()!.waitFor(sessionId);
      expect((await prisma.chatSession.findUnique({ where: { id: sessionId } }))?.status).toBe("active");
      const msgs1 = await prisma.chatMessage.findMany({
        where: { sessionId, role: "user", source: "system" },
        orderBy: { createdAt: "asc" },
      });
      expect(msgs1).toHaveLength(1);

      // 模拟服务恢复流中途失败/中断：会话再次回到 paused（如 chatAgentStream 抛出 error 事件时 resume 会归位 paused）
      await prisma.chatSession.update({ where: { id: sessionId }, data: { status: "paused" } });

      // 第二次恢复：不应再注入一条同内容系统消息
      await caller.session.resume({ id: sessionId });
      await getStreamHub()!.waitFor(sessionId);
      expect((await prisma.chatSession.findUnique({ where: { id: sessionId } }))?.status).toBe("active");
      const msgs2 = await prisma.chatMessage.findMany({
        where: { sessionId, role: "user", source: "system" },
        orderBy: { createdAt: "asc" },
      });
      // 负向断言：旧实现（无 system 源去重）会重复注入，本条必红
      expect(msgs2).toHaveLength(1);
    } finally {
      await cleanup({ agentIds: [agentId], sessionIds: [sessionId] });
    }
  }, 20_000);

  it("T9 paused + ask_user pending → resume 注入勿重复提问文案（含 askId）", async () => {
    process.env.MOCK_LLM = "true";
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const agentId = await createAgent(ctx, "T9");
    const sessionId = await createSessionWithStatus(ctx, agentId, "paused");
    const pending = await createAskUserPending({
      sessionId,
      question: "恢复后还要再问一遍吗？",
      channel: "ui",
      config: ctx.config as AppConfig,
    });

    try {
      const res = await caller.session.resume({ id: sessionId });
      expect(res).toMatchObject({ resumed: true, streamStarted: true });
      await getStreamHub()!.waitFor(sessionId);

      const sysMsgs = await prisma.chatMessage.findMany({
        where: { sessionId, role: "user", source: "system" },
      });
      expect(sysMsgs.length).toBeGreaterThanOrEqual(1);
      const content = sysMsgs.map((m) => m.content).join("\n");
      expect(content).toContain("勿重复调用 ask_user");
      expect(content).toContain(pending.askId);
      expect(content).toContain("恢复后还要再问一遍吗");
      // 默认「请继续完成未完成的任务」在有 pending 时不应单独作为全文
      expect(content).not.toBe("（服务已重启，请继续完成未完成的任务）");
    } finally {
      await prisma.askUserRequest.deleteMany({ where: { sessionId } }).catch(() => {});
      await cleanup({ agentIds: [agentId], sessionIds: [sessionId] });
    }
  }, 20_000);

  it("T11 paused + 队首 superior → resume 挂 drain、不起「继续任务」并行流", async () => {
    process.env.MOCK_LLM = "true";
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const agentId = await createAgent(ctx, "T11");
    const sessionId = await createSessionWithStatus(ctx, agentId, "paused");
    // 主会话标记：superior drain → prepareAgentRun 按 agent 主会话找会话
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { isMainSession: true, kind: "subagent", status: "paused" },
    });

    const streamSpy = vi.spyOn(agentStream, "chatAgentStream");

    await ctx.services.sessionQueueItem.create({
      sessionId,
      kind: "superior",
      content: "上级催办：请继续处理任务 Alpha",
      source: agentId,
      sourceName: "manager",
    });

    try {
      const res = await caller.session.resume({ id: sessionId });
      expect(res).toMatchObject({
        resumed: true,
        streamStarted: false,
        superiorDrainQueued: true,
      });

      // 负向：旧实现会立刻 chatAgentStream 注入「继续任务」
      expect(streamSpy).not.toHaveBeenCalled();

      const sysMsgs = await prisma.chatMessage.findMany({
        where: { sessionId, role: "user", source: "system" },
      });
      expect(sysMsgs.some((m) => m.content.includes("请继续完成未完成的任务"))).toBe(false);

      // drain 链应在空闲时消费 superior（MOCK_LLM）
      await getStreamHub()!.waitFor(sessionId).catch(() => {});
      // 给 drain 一点时间；若池拒入仍可能残留，但至少不得并行起 resume 流
      for (let i = 0; i < 30; i++) {
        const left = await ctx.services.sessionQueueItem.listBySession(sessionId);
        if (left.length === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      streamSpy.mockRestore();
      await prisma.sessionQueueItem.deleteMany({ where: { sessionId } }).catch(() => {});
      await cleanup({ agentIds: [agentId], sessionIds: [sessionId] });
    }
  }, 30_000);

  it("T10 paused + 队首孤儿 ask_user 答复 → resume 优先消费并以 user 源起流", async () => {
    process.env.MOCK_LLM = "true";
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const agentId = await createAgent(ctx, "T10");
    const sessionId = await createSessionWithStatus(ctx, agentId, "paused");
    const orphanContent =
      "【用户答复 ask_user】\n选择：用 deepseek-v4-flash\n（请基于此答复继续，勿再调用 ask_user 问同一问题。）";

    await ctx.services.sessionQueueItem.create({
      sessionId,
      kind: "user",
      content: orphanContent,
      source: "ask_user",
      sourceName: "用户答复",
    });

    try {
      const before = await ctx.services.sessionQueueItem.listBySession(sessionId);
      expect(before).toHaveLength(1);

      const res = await caller.session.resume({ id: sessionId });
      expect(res).toMatchObject({ resumed: true, streamStarted: true });
      await getStreamHub()!.waitFor(sessionId);

      // 队首已消费
      expect(await ctx.services.sessionQueueItem.listBySession(sessionId)).toHaveLength(0);

      const userMsgs = await prisma.chatMessage.findMany({
        where: { sessionId, role: "user" },
        orderBy: { createdAt: "asc" },
      });
      const joined = userMsgs.map((m) => m.content).join("\n");
      expect(joined).toContain("用 deepseek-v4-flash");
      // 负向：旧实现忽略队列，只会注入「服务已重启，请继续…」
      expect(joined).not.toContain("请继续完成未完成的任务");
      // 孤儿答复按 user 源上链（非 system 恢复去重路径）
      expect(userMsgs.some((m) => m.source === "user" && m.content.includes("deepseek-v4-flash"))).toBe(
        true,
      );
    } finally {
      await prisma.sessionQueueItem.deleteMany({ where: { sessionId } }).catch(() => {});
      await cleanup({ agentIds: [agentId], sessionIds: [sessionId] });
    }
  }, 20_000);
});
