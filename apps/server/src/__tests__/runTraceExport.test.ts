import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";
import { exportRunTraceJsonl, exportSessionTraceJsonl } from "../infra/runTraceExport.js";

describe("runTraceExport", () => {
  let sessionId: string;
  let runId: string;

  beforeAll(async () => {
    const session = await prisma.chatSession.create({
      data: { title: "轨迹导出测", model: "deepseek-v4-flash", kind: "chat", status: "active" },
    });
    sessionId = session.id;
    await prisma.chatMessage.create({
      data: { sessionId, role: "user", content: "hello trace" },
    });
    const run = await prisma.run.create({
      data: {
        sessionId,
        status: "success",
        durationMs: 12,
        output: { phase: "done" },
      },
    });
    runId = run.id;
  });

  afterAll(async () => {
    await prisma.run.deleteMany({ where: { id: runId } }).catch(() => undefined);
    await prisma.chatMessage.deleteMany({ where: { sessionId } }).catch(() => undefined);
    await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => undefined);
  });

  it("exportRunTraceJsonl 含 run + message 行", async () => {
    const { jsonl, lineCount } = await exportRunTraceJsonl(prisma, runId);
    expect(lineCount).toBeGreaterThanOrEqual(2);
    const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].kind).toBe("run");
    expect(lines[0].runId).toBe(runId);
    expect(lines.some((l) => l.kind === "message" && l.content.includes("hello"))).toBe(true);
  });

  it("exportSessionTraceJsonl 仅消息", async () => {
    const { lineCount } = await exportSessionTraceJsonl(prisma, sessionId);
    expect(lineCount).toBeGreaterThanOrEqual(1);
  });
});
