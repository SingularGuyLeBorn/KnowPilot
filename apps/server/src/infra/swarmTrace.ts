/**
 * Swarm 协作轨迹导出（JSONL）——评估 V 组件底座。
 * 导出 session / message / run / agentMessage / task 元信息，默认不含消息正文（防泄漏）。
 */
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";

export type SwarmTraceExportOpts = {
  sessionId: string;
  /** 是否包含 ChatMessage.content（默认 false） */
  includeContent?: boolean;
  /** 输出相对 projectRoot 的路径；默认 data/traces/{sessionId}-{ts}.jsonl */
  outRelPath?: string;
};

export type SwarmTraceExportResult = {
  path: string;
  relPath: string;
  lines: number;
  sessionId: string;
  includeContent: boolean;
};

function safeJsonLine(obj: unknown): string {
  return JSON.stringify(obj);
}

export async function exportSwarmTraceJsonl(
  prisma: PrismaClient,
  config: AppConfig,
  opts: SwarmTraceExportOpts,
): Promise<SwarmTraceExportResult> {
  const sessionId = opts.sessionId.trim();
  if (!sessionId) throw new Error("sessionId 必填");
  const includeContent = opts.includeContent === true;

  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`会话不存在: ${sessionId}`);

  const [messages, runs, queueItems, childSessions, tasks] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: includeContent
        ? { id: true, role: true, content: true, createdAt: true, toolResults: true }
        : { id: true, role: true, createdAt: true, toolResults: true },
    }),
    prisma.run.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        agentId: true,
        createdAt: true,
        updatedAt: true,
        durationMs: true,
        toolCallCount: true,
        tokenUsage: true,
        output: true,
      },
    }),
    prisma.sessionQueueItem.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        createdAt: true,
        claimedAt: true,
        agentMessageId: true,
      },
    }),
    prisma.chatSession.findMany({
      where: { parentSessionId: sessionId },
      select: {
        id: true,
        title: true,
        status: true,
        agentId: true,
        kind: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.task.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        type: true,
        createdAt: true,
        updatedAt: true,
        delivered: true,
        deliveredAt: true,
      },
    }),
  ]);

  const agentIds = [
    ...new Set(
      [session.agentId, ...childSessions.map((s) => s.agentId)].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  ];
  const agentMessages =
    agentIds.length > 0
      ? await prisma.agentMessage.findMany({
          where: {
            OR: [{ fromAgentId: { in: agentIds } }, { toAgentId: { in: agentIds } }],
          },
          orderBy: { createdAt: "asc" },
          take: 500,
          select: includeContent
            ? {
                id: true,
                fromAgentId: true,
                toAgentId: true,
                status: true,
                taskRef: true,
                createdAt: true,
                deliveredAt: true,
                content: true,
              }
            : {
                id: true,
                fromAgentId: true,
                toAgentId: true,
                status: true,
                taskRef: true,
                createdAt: true,
                deliveredAt: true,
              },
        })
      : [];

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relPath =
    opts.outRelPath?.replace(/\\/g, "/") ||
    path.posix.join("data", "traces", `${sessionId.slice(0, 8)}-${stamp}.jsonl`);
  const absPath = path.isAbsolute(relPath)
    ? relPath
    : path.join(config.projectRoot, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  const lines: string[] = [];
  lines.push(
    safeJsonLine({
      type: "meta",
      exportedAt: new Date().toISOString(),
      sessionId,
      includeContent,
      schemaVersion: 1,
    }),
  );
  lines.push(
    safeJsonLine({
      type: "session",
      id: session.id,
      agentId: session.agentId,
      title: session.title,
      status: session.status,
      kind: session.kind,
      parentSessionId: session.parentSessionId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }),
  );
  for (const m of messages) {
    const tr = (m as { toolResults?: unknown }).toolResults;
    let toolMeta: unknown = undefined;
    if (tr) {
      try {
        const parsed = typeof tr === "string" ? JSON.parse(tr) : tr;
        toolMeta = {
          hasToolResults: true,
          keys:
            parsed && typeof parsed === "object" ? Object.keys(parsed as object).slice(0, 20) : [],
        };
      } catch {
        toolMeta = { hasToolResults: true };
      }
    }
    const content = includeContent ? String((m as { content?: string }).content ?? "") : undefined;
    lines.push(
      safeJsonLine({
        type: "message",
        id: m.id,
        role: m.role,
        createdAt: m.createdAt,
        contentChars: content?.length,
        content,
        toolMeta,
      }),
    );
  }
  for (const r of runs) {
    lines.push(safeJsonLine({ type: "run", run: r }));
  }
  for (const q of queueItems) {
    lines.push(safeJsonLine({ type: "queue_item", item: q }));
  }
  for (const c of childSessions) {
    lines.push(safeJsonLine({ type: "child_session", session: c }));
  }
  for (const t of tasks) {
    lines.push(safeJsonLine({ type: "task", task: t }));
  }
  for (const am of agentMessages) {
    const content = includeContent
      ? String((am as { content?: string }).content ?? "")
      : undefined;
    lines.push(
      safeJsonLine({
        type: "agent_message",
        id: am.id,
        fromAgentId: am.fromAgentId,
        toAgentId: am.toAgentId,
        status: am.status,
        taskRef: am.taskRef,
        createdAt: am.createdAt,
        deliveredAt: am.deliveredAt,
        contentChars: content?.length,
        content,
      }),
    );
  }

  fs.writeFileSync(absPath, `${lines.join("\n")}\n`, "utf-8");
  return {
    path: absPath,
    relPath: path.relative(config.projectRoot, absPath).replace(/\\/g, "/"),
    lines: lines.length,
    sessionId,
    includeContent,
  };
}
