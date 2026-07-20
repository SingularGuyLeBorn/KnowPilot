/**
 * B5：depth 服务端物化 — 负向断言
 *
 * 旧实现：msg.depth ?? 1 / args.depth，LLM 传 depth:1 可绕过防循环。
 * 新实现：depth = 发送方最近入站 depth+1；LLM 显式传 depth 无效。
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { SWARM_MAX_DEPTH } from "@knowpilot/shared";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { getSwarmBus, resetSwarmBus } from "../infra/swarmBus.js";
import { checkToolPermission } from "../infra/swarmPermissionGuard.js";

type Ctx = Awaited<ReturnType<typeof createContextInner>>;

const RUN_ID = `b5${Date.now().toString(36)}`;

describe("B5 depth 服务端物化", () => {
  beforeEach(() => {
    resetSwarmBus();
  });

  afterEach(async () => {
    resetSwarmBus();
    await prisma.agentMessage.deleteMany({ where: { content: { startsWith: "B5-" } } }).catch(() => {});
    await prisma.agent.deleteMany({ where: { name: { startsWith: `B5-${RUN_ID}` } } }).catch(() => {});
  });

  it("LLM 显式传 depth:1 的深层派生：guard/bus 按服务端物化 depth 拦截（旧实现放行 → 旧实现即红）", async () => {
    const ctx = await createContextInner();
    const a = await ctx.services.agent.create({
      name: `B5-${RUN_ID}-A`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "manager",
    });
    const b = await ctx.services.agent.create({
      name: `B5-${RUN_ID}-B`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "sub",
      parentId: (a.data as { id: string }).id,
    });
    const agentA = (a.data as { id: string }).id;
    const agentB = (b.data as { id: string }).id;

    // 模拟 A 已处于最大深度入站（派生链末端）
    await prisma.agentMessage.create({
      data: {
        fromAgentId: agentB,
        toAgentId: agentA,
        content: "B5-seed",
        messageType: "command",
        source: "sub",
        depth: SWARM_MAX_DEPTH,
        status: "pending",
      },
    });

    // guard 不再信任 args.depth（即使传 1 也不在本层放行/拦截——交 bus）
    expect(
      checkToolPermission(
        "agent_send_message",
        { toAgentId: agentB, content: "B5-bypass", depth: 1 },
        { agentTier: "manager", agentId: agentA, agentWorkspaceId: null, inToolRound: true },
      ),
    ).toBeNull();

    const bus = getSwarmBus(prisma, ctx.services);
    // 调用方若仍塞 depth:1（类型已移除；运行时多传无效）——物化 = MAX+1 → 拒绝
    const sent = await bus.send(
      {
        fromAgentId: agentA,
        toAgentId: agentB,
        content: "B5-bypass",
        messageType: "command",
        source: "manager",
        // @ts-expect-error B5：depth 已移出 AgentMessageInput，运行时也应被忽略
        depth: 1,
      },
      "manager",
      null,
      true,
    );
    expect(sent.success).toBe(false);
    expect(sent.error?.code).toBe("DELEGATION_DEPTH_EXCEEDED");
  });

  it("无入站时 depth=1；有入站时 depth=父+1", async () => {
    const ctx = await createContextInner();
    const a = await ctx.services.agent.create({
      name: `B5-${RUN_ID}-root`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "super",
    });
    const b = await ctx.services.agent.create({
      name: `B5-${RUN_ID}-child`,
      model: "deepseek-chat",
      systemPrompt: "t",
      tools: [],
      tier: "manager",
    });
    const agentA = (a.data as { id: string }).id;
    const agentB = (b.data as { id: string }).id;
    const bus = getSwarmBus(prisma, ctx.services);

    const r1 = await bus.send(
      { fromAgentId: agentA, toAgentId: agentB, content: "B5-first", source: "super" },
      "super",
      null,
      true,
    );
    expect(r1.success).toBe(true);
    const m1 = await prisma.agentMessage.findUnique({ where: { id: r1.messageId! } });
    expect(m1?.depth).toBe(1);

    const r2 = await bus.send(
      { fromAgentId: agentB, toAgentId: agentA, content: "B5-second", messageType: "report", source: "manager" },
      "manager",
      null,
      false,
    );
    expect(r2.success).toBe(true);
    const m2 = await prisma.agentMessage.findUnique({ where: { id: r2.messageId! } });
    expect(m2?.depth).toBe(2);
  });
});
