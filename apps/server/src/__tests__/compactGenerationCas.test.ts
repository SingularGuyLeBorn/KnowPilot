/**
 * A3：autoCompact 单事务 + compactGeneration CAS
 *
 * 负向断言（旧实现红）：
 * - 两个并发 compact 交错 → 落败方 skipped，摘要与边界不分裂
 * - generation 单调递增（不再卡在 2）
 * - 会话 running 时手动 compact 被拒绝
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../db.js";
import {
  persistCompactResult,
  runSessionCompact,
  type CompactResult,
} from "../infra/autoCompact.js";
import { SessionStreamHub, setStreamHub } from "../infra/sessionStreamHub.js";
import { createContextInner } from "../trpc/context.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";
import type { AppConfig } from "../infra/config.js";
import fs from "fs";

function makeCompacted(generation: number, summary: string): CompactResult {
  return {
    compacted: true,
    messages: [],
    summaryText: summary,
    generation,
    messagesSummarized: 10,
    charBefore: 8000,
    charAfter: 1000,
  };
}

describe("A3 compactGeneration CAS", () => {
  let sessionId: string;
  let services: ServiceContainer;
  let config: AppConfig;
  let root: string;

  beforeEach(async () => {
    root = createTempProjectDir();
    config = createTestConfig(root);
    const ctx = await createContextInner();
    services = ctx.services as ServiceContainer;
    const sess = await prisma.chatSession.create({
      data: {
        title: "a3-compact-cas",
        model: "test-model",
        compactGeneration: 0,
      },
    });
    sessionId = sess.id;
  });

  afterEach(async () => {
    setStreamHub(null);
    await prisma.chatMessage.deleteMany({ where: { sessionId } });
    await prisma.chatSession.deleteMany({ where: { id: sessionId } });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("并发 persist：落败方 skipped，摘要与边界代际一致", async () => {
    const a = persistCompactResult(services, sessionId, makeCompacted(1, "摘要-A"), {
      trigger: "auto",
    });
    const b = persistCompactResult(services, sessionId, makeCompacted(1, "摘要-B"), {
      trigger: "manual",
    });
    const [ra, rb] = await Promise.all([a, b]);

    const winners = [ra, rb].filter((r) => !r.skipped);
    const losers = [ra, rb].filter((r) => r.skipped);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const sess = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    expect(sess!.compactGeneration).toBe(1);
    expect(sess!.contextSummary === "摘要-A" || sess!.contextSummary === "摘要-B").toBe(true);

    const boundaries = await prisma.chatMessage.findMany({
      where: { sessionId, source: "system" },
    });
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].content).toContain("v1@");
    // 边界与摘要同源：胜出方的 trigger 标签会出现在边界正文
    const summary = sess!.contextSummary!;
    if (summary === "摘要-A") {
      expect(boundaries[0].content).toContain("已自动压缩");
    } else {
      expect(boundaries[0].content).toContain("已手动压缩");
    }
  });

  it("generation 单调递增，不再解析文本卡在 2", async () => {
    // 摘要无 vN@ marker（旧 nextCompactGeneration 会永远返回 2）
    const r1 = await persistCompactResult(
      services,
      sessionId,
      makeCompacted(1, "纯文本摘要无代数标记"),
      { trigger: "manual" },
    );
    expect(r1.skipped).toBe(false);

    const r2 = await persistCompactResult(
      services,
      sessionId,
      makeCompacted(2, "第二次纯文本摘要"),
      { trigger: "manual" },
    );
    expect(r2.skipped).toBe(false);

    const r3 = await persistCompactResult(
      services,
      sessionId,
      makeCompacted(2, "错误代际应落败"),
      { trigger: "auto" },
    );
    expect(r3.skipped).toBe(true);

    const sess = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    expect(sess!.compactGeneration).toBe(2);
    expect(sess!.contextSummary).toBe("第二次纯文本摘要");
  });

  it("会话 running 时手动 compact 拒绝", async () => {
    const hub = new SessionStreamHub({
      ringSize: 10,
      persist: false,
      eventTtlMs: 1000,
      cleanupIntervalMs: 0,
    });
    setStreamHub(hub);
    await hub.start(sessionId, { message: "hi", sessionId } as never, async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    const result = await runSessionCompact({
      config,
      services,
      sessionId,
      model: "test-model",
      systemPrompt: "sys",
      existingSummary: null,
      trigger: "manual",
    });

    expect(result.compacted).toBe(false);
    expect(result.message).toMatch(/运行中|停止后再/);

    await hub.waitFor(sessionId);
    await hub.dispose();
  });
});
