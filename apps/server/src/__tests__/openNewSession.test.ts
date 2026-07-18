/**
 * openNewSession：「新对话」三态 — already_here / switched / created
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { openNewSession } from "../infra/openNewSession.js";

describe("openNewSession", () => {
  let agentId: string;

  beforeEach(async () => {
    await prisma.chatMessage.deleteMany();
    await prisma.chatSession.deleteMany();
    await prisma.agent.deleteMany({ where: { name: { startsWith: "E2E-OpenNew-" } } });
    const agent = await prisma.agent.create({
      data: {
        name: `E2E-OpenNew-${Date.now()}`,
        model: "deepseek-v4-flash",
        systemPrompt: "t",
        tools: "",
        tier: "sub",
        status: "active",
      },
    });
    agentId = agent.id;
  });

  it("无空会话时 created", async () => {
    const res = await openNewSession(prisma, {
      agentId,
      focusedSessionId: null,
      title: "新对话",
      model: "deepseek-v4-flash",
    });
    expect(res.action).toBe("created");
    expect(res.session.isMainSession).toBe(false);
    const msgCount = await prisma.chatMessage.count({ where: { sessionId: res.session.id } });
    expect(msgCount).toBe(0);
  });

  it("已有空会话且焦点不在其上 → switched", async () => {
    const empty = await prisma.chatSession.create({
      data: {
        title: "空会话",
        model: "deepseek-v4-flash",
        agentId,
        kind: "chat",
        status: "active",
      },
    });
    const busy = await prisma.chatSession.create({
      data: {
        title: "有消息",
        model: "deepseek-v4-flash",
        agentId,
        kind: "chat",
        status: "active",
      },
    });
    await prisma.chatMessage.create({
      data: { sessionId: busy.id, role: "user", content: "hi" },
    });

    const res = await openNewSession(prisma, {
      agentId,
      focusedSessionId: busy.id,
      title: "新对话",
      model: "deepseek-v4-flash",
    });
    expect(res.action).toBe("switched");
    expect(res.session.id).toBe(empty.id);
  });

  it("已有空会话且焦点在其上 → already_here", async () => {
    const empty = await prisma.chatSession.create({
      data: {
        title: "空会话",
        model: "deepseek-v4-flash",
        agentId,
        kind: "chat",
        status: "active",
      },
    });
    const res = await openNewSession(prisma, {
      agentId,
      focusedSessionId: empty.id,
      title: "新对话",
      model: "deepseek-v4-flash",
    });
    expect(res.action).toBe("already_here");
    expect(res.session.id).toBe(empty.id);
    const count = await prisma.chatSession.count({ where: { agentId } });
    expect(count).toBe(1);
  });

  it("有消息的会话不算空；会新建", async () => {
    const busy = await prisma.chatSession.create({
      data: {
        title: "有消息",
        model: "deepseek-v4-flash",
        agentId,
        kind: "chat",
        status: "active",
      },
    });
    await prisma.chatMessage.create({
      data: { sessionId: busy.id, role: "user", content: "hi" },
    });
    const res = await openNewSession(prisma, {
      agentId,
      focusedSessionId: busy.id,
      title: "新对话",
      model: "deepseek-v4-flash",
    });
    expect(res.action).toBe("created");
    expect(res.session.id).not.toBe(busy.id);
  });
});
