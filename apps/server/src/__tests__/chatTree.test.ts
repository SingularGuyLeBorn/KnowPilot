/**
 * W1 会话树 — 负向断言集成测试
 *
 * 覆盖：回填成链、写入点 parentId/activeLeafId、活跃路径、switchBranch、
 * branch_summary 复用/生成、branch_summary 不进 LLM 上下文。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../db.js";
import { createContextInner } from "../trpc/context.js";
import { appRouter } from "../router.js";
import {
  appendChatMessage,
  backfillChatTree,
  resolveActivePath,
  BRANCH_SUMMARY_KIND,
  BRANCH_SUMMARY_MARKER,
} from "../infra/chatTree.js";
import { buildLlmMessagesFromHistory } from "../infra/chatHistory.js";
import * as llmClient from "../infra/llmClient.js";

const RUN = `w1t${Date.now().toString(36)}`;

async function cleanup(sessionIds: string[]) {
  await prisma.chatMessage.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
  await prisma.chatSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
}

describe("W1 会话树 chatTree", () => {
  const sessionIds: string[] = [];

  afterEach(async () => {
    await cleanup(sessionIds.splice(0));
    vi.restoreAllMocks();
  });

  it("回填脚本：存量线性消息正确成链、activeLeaf 正确", async () => {
    const session = await prisma.chatSession.create({
      data: { title: `W1-backfill-${RUN}`, model: "deepseek-v4-flash" },
    });
    sessionIds.push(session.id);
    const a = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: "A" },
    });
    const b = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "assistant", content: "B" },
    });
    const c = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: "C" },
    });

    const result = await backfillChatTree(prisma);
    expect(result.sessions).toBeGreaterThanOrEqual(1);

    const msgs = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    expect(msgs[0]!.parentId).toBeNull();
    expect(msgs[1]!.parentId).toBe(a.id);
    expect(msgs[2]!.parentId).toBe(b.id);
    const refreshed = await prisma.chatSession.findUnique({ where: { id: session.id } });
    expect(refreshed?.activeLeafId).toBe(c.id);
  });

  it("写入点：连续发消息 parentId 链正确、activeLeafId 推进", async () => {
    const ctx = await createContextInner();
    const session = await ctx.services.session.create({
      title: `W1-write-${RUN}`,
      model: "deepseek-v4-flash",
    } as any);
    const sid = (session.data as { id: string }).id;
    sessionIds.push(sid);

    const m1 = await ctx.services.message.create({
      sessionId: sid,
      role: "user",
      content: "hello",
    });
    expect(m1.data?.parentId ?? null).toBeNull();
    expect((await prisma.chatSession.findUnique({ where: { id: sid } }))?.activeLeafId).toBe(m1.data!.id);

    const m2 = await ctx.services.message.create({
      sessionId: sid,
      role: "assistant",
      content: "hi",
    });
    expect(m2.data?.parentId).toBe(m1.data!.id);
    expect((await prisma.chatSession.findUnique({ where: { id: sid } }))?.activeLeafId).toBe(m2.data!.id);
  });

  it("并发两路写入：同事务推进不断链", async () => {
    const session = await prisma.chatSession.create({
      data: { title: `W1-race-${RUN}`, model: "deepseek-v4-flash" },
    });
    sessionIds.push(session.id);

    const [r1, r2] = await Promise.all([
      appendChatMessage(prisma, { sessionId: session.id, role: "user", content: "race-1" }),
      appendChatMessage(prisma, { sessionId: session.id, role: "user", content: "race-2" }),
    ]);

    const leaf = (await prisma.chatSession.findUnique({ where: { id: session.id } }))?.activeLeafId;
    expect([r1.id, r2.id]).toContain(leaf);

    const all = await prisma.chatMessage.findMany({ where: { sessionId: session.id } });
    const path = resolveActivePath(all, leaf);
    // 活跃路径应是一条合法链（长度 ≥ 1），且叶为 activeLeafId
    expect(path[path.length - 1]?.id).toBe(leaf);
    expect(path.length).toBeGreaterThanOrEqual(1);
    // 两条消息都存在；后写者挂在先写者上（或反过来，取决于序列化顺序）
    const byId = new Map(all.map((m) => [m.id, m]));
    const other = leaf === r1.id ? r2 : r1;
    const otherParent = byId.get(other.id)?.parentId;
    expect(otherParent === null || otherParent === r1.id || otherParent === r2.id).toBe(true);
  });

  it("活跃路径：分叉后 listForLlmContext / buildSessionHistory 只含活跃分支", async () => {
    const ctx = await createContextInner();
    const session = await ctx.services.session.create({
      title: `W1-path-${RUN}`,
      model: "deepseek-v4-flash",
    } as any);
    const sid = (session.data as { id: string }).id;
    sessionIds.push(sid);

    const u1 = await ctx.services.message.create({ sessionId: sid, role: "user", content: "root-q" });
    const a1 = await ctx.services.message.create({ sessionId: sid, role: "assistant", content: "root-a" });
    // 分叉：从 u1 再长一条旁路
    await prisma.chatSession.update({ where: { id: sid }, data: { activeLeafId: u1.data!.id } });
    const fork = await ctx.services.message.create({
      sessionId: sid,
      role: "assistant",
      content: "fork-a",
    });
    expect(fork.data?.parentId).toBe(u1.data!.id);

    // 切回主分支叶 a1
    await prisma.chatSession.update({ where: { id: sid }, data: { activeLeafId: a1.data!.id } });
    const llmPath = await ctx.services.message.listForLlmContext({ sessionId: sid });
    const contents = llmPath.map((m) => m.content);
    expect(contents).toContain("root-q");
    expect(contents).toContain("root-a");
    expect(contents).not.toContain("fork-a");
  });

  it("switchBranch：幂等 / 越权拒绝 / 摘要生成与复用；branch_summary 不进 LLM", async () => {
    vi.spyOn(llmClient, "chatCompletion").mockResolvedValue({
      content: "旁路摘要测试",
      model: "mock",
      usage: { prompt: 1, completion: 1, total: 2 },
    } as any);

    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const session = await ctx.services.session.create({
      title: `W1-switch-${RUN}`,
      model: "deepseek-v4-flash",
    } as any);
    const sid = (session.data as { id: string }).id;
    sessionIds.push(sid);

    const u1 = await ctx.services.message.create({ sessionId: sid, role: "user", content: "Q1" });
    const a1 = await ctx.services.message.create({ sessionId: sid, role: "assistant", content: "A1" });
    await prisma.chatSession.update({ where: { id: sid }, data: { activeLeafId: u1.data!.id } });
    const a2 = await ctx.services.message.create({ sessionId: sid, role: "assistant", content: "A2-fork" });

    // 切到 a1：放弃 a2 旁路 → 应生成 summary
    const sw1 = await caller.session.switchBranch({ sessionId: sid, messageId: a1.data!.id });
    expect(sw1.switched).toBe(true);
    expect(sw1.summaryGenerated).toBe(true);

    const summaries = await prisma.chatMessage.findMany({
      where: { sessionId: sid, kind: BRANCH_SUMMARY_KIND },
    });
    expect(summaries.length).toBe(1);
    expect(summaries[0]!.content).toContain(BRANCH_SUMMARY_MARKER);

    // 切到 a2 再切回 a1：放弃 tip 仍为 a2 → 复用已有 summary（不新增）
    await caller.session.switchBranch({ sessionId: sid, messageId: a2.data!.id });
    const beforeReuse = await prisma.chatMessage.count({
      where: { sessionId: sid, kind: BRANCH_SUMMARY_KIND },
    });
    const sw2 = await caller.session.switchBranch({ sessionId: sid, messageId: a1.data!.id });
    expect(sw2.summaryReused).toBe(true);
    expect(sw2.summaryGenerated).toBe(false);
    const afterReuse = await prisma.chatMessage.count({
      where: { sessionId: sid, kind: BRANCH_SUMMARY_KIND },
    });
    expect(afterReuse).toBe(beforeReuse);

    // 幂等
    const noop = await caller.session.switchBranch({ sessionId: sid, messageId: a1.data!.id });
    expect(noop.switched).toBe(false);

    // 越权
    const other = await prisma.chatSession.create({
      data: { title: `W1-other-${RUN}`, model: "deepseek-v4-flash" },
    });
    sessionIds.push(other.id);
    const foreign = await prisma.chatMessage.create({
      data: { sessionId: other.id, role: "user", content: "x" },
    });
    await expect(
      caller.session.switchBranch({ sessionId: sid, messageId: foreign.id }),
    ).rejects.toThrow(/不属于该会话/);

    // branch_summary 不进 LLM
    const llmMsgs = buildLlmMessagesFromHistory("sys", [
      { role: "user", content: "Q" },
      {
        role: "system",
        content: `${BRANCH_SUMMARY_MARKER}\n秘密旁路`,
        kind: BRANCH_SUMMARY_KIND,
      },
      { role: "assistant", content: "A" },
    ]);
    const joined = JSON.stringify(llmMsgs);
    expect(joined).not.toContain("秘密旁路");
    expect(joined).not.toContain(BRANCH_SUMMARY_MARKER);
  });

  it("setLabel 书签 CRUD", async () => {
    const ctx = await createContextInner();
    const caller = appRouter.createCaller(ctx);
    const session = await ctx.services.session.create({
      title: `W1-label-${RUN}`,
      model: "deepseek-v4-flash",
    } as any);
    const sid = (session.data as { id: string }).id;
    sessionIds.push(sid);
    const msg = await ctx.services.message.create({
      sessionId: sid,
      role: "user",
      content: "bookmark me",
    });
    const labeled = await caller.message.setLabel({ messageId: msg.data!.id, label: "重要" });
    expect(labeled.label).toBe("重要");
    const cleared = await caller.message.setLabel({ messageId: msg.data!.id, label: null });
    expect(cleared.label).toBeNull();
  });
});
