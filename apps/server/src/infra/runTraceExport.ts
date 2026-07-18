/**
 * Run / Session 轨迹 JSONL 导出（Harness V 组件骨架）
 *
 * 每行一条 JSON：run 元数据 / message / tool_batch 片段，便于离线评测与 A/B。
 * 叶子模块：仅依赖 Prisma。
 */

import type { PrismaClient } from "@prisma/client";

export type TraceLine =
  | {
      kind: "run";
      runId: string;
      agentId: string | null;
      sessionId: string | null;
      status: string;
      durationMs: number | null;
      createdAt: string;
      output?: unknown;
    }
  | {
      kind: "message";
      messageId: string;
      sessionId: string;
      role: string;
      content: string;
      source: string;
      createdAt: string;
      toolCalls?: unknown;
      toolResults?: unknown;
    };

function line(obj: TraceLine): string {
  return JSON.stringify(obj);
}

/** 导出单次 Run：Run 行 + 关联 session 消息（若有 sessionId） */
export async function exportRunTraceJsonl(
  prisma: PrismaClient,
  runId: string,
): Promise<{ jsonl: string; lineCount: number }> {
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) {
    throw new Error(`Run 不存在: ${runId}`);
  }
  const lines: string[] = [
    line({
      kind: "run",
      runId: run.id,
      agentId: run.agentId,
      sessionId: run.sessionId,
      status: run.status,
      durationMs: run.durationMs,
      createdAt: run.createdAt.toISOString(),
      output: run.output ?? undefined,
    }),
  ];
  if (run.sessionId) {
    const msgs = await prisma.chatMessage.findMany({
      where: { sessionId: run.sessionId },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    for (const m of msgs) {
      lines.push(
        line({
          kind: "message",
          messageId: m.id,
          sessionId: m.sessionId,
          role: m.role,
          content: m.content,
          source: m.source,
          createdAt: m.createdAt.toISOString(),
          toolCalls: m.toolCalls ?? undefined,
          toolResults: m.toolResults ?? undefined,
        }),
      );
    }
  }
  return { jsonl: lines.join("\n") + (lines.length ? "\n" : ""), lineCount: lines.length };
}

/** 导出会话全部消息为 JSONL（不含 Run 行） */
export async function exportSessionTraceJsonl(
  prisma: PrismaClient,
  sessionId: string,
): Promise<{ jsonl: string; lineCount: number }> {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) {
    throw new Error(`会话不存在: ${sessionId}`);
  }
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  const lines = msgs.map((m) =>
    line({
      kind: "message",
      messageId: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      source: m.source,
      createdAt: m.createdAt.toISOString(),
      toolCalls: m.toolCalls ?? undefined,
      toolResults: m.toolResults ?? undefined,
    }),
  );
  return { jsonl: lines.join("\n") + (lines.length ? "\n" : ""), lineCount: lines.length };
}
