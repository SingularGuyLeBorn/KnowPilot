/**
 * session_search / session_message_get：压缩后按需召回本会话原文
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createNativeCtx, createTempProjectDir } from "./helpers/toolTestFixtures.js";

const RUN = `sess-search-${Date.now()}`;

describe("session_search / session_message_get", () => {
  let sessionId: string;
  let projectRoot: string;
  let oldMsgId: string;
  let newMsgId: string;
  const boundary = new Date("2026-07-20T12:00:00.000Z");

  beforeAll(async () => {
    projectRoot = createTempProjectDir();
    const session = await prisma.chatSession.create({
      data: {
        title: `${RUN}-sess`,
        model: "deepseek-v4-flash",
        contextSummary: "摘要：谈过知乎收藏夹同步，细节省略。",
        contextCompactedAt: boundary,
        compactGeneration: 1,
      },
    });
    sessionId = session.id;

    const oldMsg = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "user",
        content: "请记住密钥代号 ALPHA-7749，用于知乎收藏夹同步验收。",
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
      },
    });
    oldMsgId = oldMsg.id;

    const newMsg = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: "好的，压缩后继续聊别的话题。",
        createdAt: new Date("2026-07-20T13:00:00.000Z"),
      },
    });
    newMsgId = newMsg.id;
  });

  afterAll(async () => {
    await prisma.chatMessage.deleteMany({ where: { sessionId } }).catch(() => undefined);
    await prisma.chatSession.delete({ where: { id: sessionId } }).catch(() => undefined);
    const fs = await import("fs");
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function ctx() {
    return {
      ...createNativeCtx(projectRoot, { prisma }),
      sessionId,
      prisma,
    };
  }

  it("无 sessionId 失败", async () => {
    await expect(
      executeNativeTool("session_search", { keyword: "ALPHA" }, {
        ...createNativeCtx(projectRoot, { prisma }),
        prisma,
      }),
    ).rejects.toThrow(/sessionId/);
  });

  it("session_search 命中压缩外原文且 inLlmContext=false", async () => {
    const result = (await executeNativeTool(
      "session_search",
      { keyword: "ALPHA-7749", onlyOutsidePrompt: true },
      ctx(),
    )) as {
      items: Array<{ id: string; inLlmContext: boolean; excerpt: string }>;
      hasCompactSummary: boolean;
    };

    expect(result.hasCompactSummary).toBe(true);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.some((i) => i.id === oldMsgId && i.inLlmContext === false)).toBe(true);
    expect(result.items[0]?.excerpt).toMatch(/ALPHA-7749/);
  });

  it("session_message_get(messageId) 拉回压缩前全文片段", async () => {
    const result = (await executeNativeTool(
      "session_message_get",
      { messageId: oldMsgId },
      ctx(),
    )) as {
      item: { id: string; inLlmContext: boolean; content: string };
    };

    expect(result.item.id).toBe(oldMsgId);
    expect(result.item.inLlmContext).toBe(false);
    expect(result.item.content).toContain("ALPHA-7749");
  });

  it("session_message_get(beforeCompact) 只返回边界前消息", async () => {
    const result = (await executeNativeTool(
      "session_message_get",
      { beforeCompact: true, limit: 10 },
      ctx(),
    )) as {
      items: Array<{ id: string; inLlmContext: boolean }>;
    };

    expect(result.items.every((i) => i.inLlmContext === false)).toBe(true);
    expect(result.items.some((i) => i.id === oldMsgId)).toBe(true);
    expect(result.items.some((i) => i.id === newMsgId)).toBe(false);
  });

  it("拒绝跨会话 messageId", async () => {
    const other = await prisma.chatSession.create({
      data: { title: `${RUN}-other`, model: "deepseek-v4-flash" },
    });
    const foreign = await prisma.chatMessage.create({
      data: {
        sessionId: other.id,
        role: "user",
        content: "外来消息 ALPHA-7749",
      },
    });

    await expect(
      executeNativeTool("session_message_get", { messageId: foreign.id }, ctx()),
    ).rejects.toThrow(/不存在或不属于本会话/);

    await prisma.chatMessage.delete({ where: { id: foreign.id } }).catch(() => undefined);
    await prisma.chatSession.delete({ where: { id: other.id } }).catch(() => undefined);
  });
});
