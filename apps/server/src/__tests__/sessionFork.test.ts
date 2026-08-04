import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";

describe("session.fork", () => {
  let caller: any;

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    const ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
  });

  it("从会话 Fork 出新会话并复制消息树", async () => {
    const agent = await caller.agent.create({
      name: `ForkAgent_${Date.now()}`,
      model: "deepseek-chat",
      systemPrompt: "fork test",
      tools: [],
      tier: "sub",
    });
    expect(agent.success).toBe(true);

    const session = await caller.session.openNew({
      agentId: agent.data.id,
      title: "源会话",
    });

    await caller.message.create({
      sessionId: session.id,
      role: "user",
      content: "第一条用户消息",
    });
    const assistant1 = await caller.message.create({
      sessionId: session.id,
      role: "assistant",
      content: "第一条回复",
    });
    await caller.message.create({
      sessionId: session.id,
      role: "user",
      content: "第二条用户消息",
    });
    await caller.message.create({
      sessionId: session.id,
      role: "assistant",
      content: "第二条回复",
    });

    const fork = await caller.session.fork({
      sourceSessionId: session.id,
      title: "分叉会话",
      includeMessages: 10,
    });

    expect(fork.id).not.toBe(session.id);
    expect(fork.title).toBe("分叉会话");
    expect(fork.sourceSessionId).toBe(session.id);
    expect(fork.copiedMessages).toBe(4);

    const newSession = await caller.session.getById({ id: fork.id });
    expect(newSession.agentId).toBe(agent.data.id);
    expect(newSession.model).toBe(session.model);
    expect(newSession.kind).toBe("chat");

    const messages = await caller.message.listForChat({ sessionId: fork.id, limit: 50 });
    expect(messages.items.length).toBe(4);
    expect(messages.items[0].role).toBe("user");
    expect(messages.items[0].content).toBe("第一条用户消息");
    expect(messages.items[1].role).toBe("assistant");
    expect(messages.items[1].content).toBe("第一条回复");
    expect(messages.items[2].role).toBe("user");
    expect(messages.items[3].role).toBe("assistant");

    // 新消息 id 与旧消息不同
    const oldIds = new Set([
      assistant1.data.id,
    ]);
    expect(messages.items.some((m: any) => oldIds.has(m.id))).toBe(false);

    // 清理
    await caller.session.delete({ id: session.id });
    await caller.session.delete({ id: fork.id });
    await caller.agent.delete({ id: agent.data.id });
  });

  it("Fork 时只复制最近的 N 条消息", async () => {
    const agent = await caller.agent.create({
      name: `ForkLimitAgent_${Date.now()}`,
      model: "deepseek-chat",
      systemPrompt: "fork limit test",
      tools: [],
      tier: "sub",
    });
    const session = await caller.session.openNew({
      agentId: agent.data.id,
      title: "Limit 源会话",
    });

    for (let i = 0; i < 5; i++) {
      await caller.message.create({
        sessionId: session.id,
        role: "user",
        content: `msg-${i}`,
      });
    }

    const fork = await caller.session.fork({
      sourceSessionId: session.id,
      includeMessages: 2,
    });
    expect(fork.copiedMessages).toBe(2);

    const messages = await caller.message.listForChat({ sessionId: fork.id, limit: 50 });
    expect(messages.items.length).toBe(2);
    expect(messages.items[0].content).toBe("msg-3");
    expect(messages.items[1].content).toBe("msg-4");

    await caller.session.delete({ id: session.id });
    await caller.session.delete({ id: fork.id });
    await caller.agent.delete({ id: agent.data.id });
  });

  it("Fork 空会话返回 0 条消息", async () => {
    const agent = await caller.agent.create({
      name: `ForkEmptyAgent_${Date.now()}`,
      model: "deepseek-chat",
      systemPrompt: "fork empty test",
      tools: [],
      tier: "sub",
    });
    const session = await caller.session.openNew({
      agentId: agent.data.id,
      title: "空会话",
    });

    const fork = await caller.session.fork({
      sourceSessionId: session.id,
      includeMessages: 10,
    });
    expect(fork.copiedMessages).toBe(0);

    await caller.session.delete({ id: session.id });
    await caller.session.delete({ id: fork.id });
    await caller.agent.delete({ id: agent.data.id });
  });

  it("Fork 不存在的会话报 NOT_FOUND", async () => {
    await expect(
      caller.session.fork({ sourceSessionId: "c00000000000000000000000" }),
    ).rejects.toThrow();
  });
});
