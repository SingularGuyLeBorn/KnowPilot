/**
 * AgentCronJob 存储（raw SQL，避免 prisma generate 被运行中 server 锁 DLL 时阻塞开发）。
 * 表结构与 schema.prisma AgentCronJob 对齐。
 */
import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

/** 幂等建表（db push / generate 受阻时仍可运行） */
export async function ensureAgentCronJobTable(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS AgentCronJob (
      id TEXT PRIMARY KEY NOT NULL,
      agentId TEXT NOT NULL,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      prompt TEXT NOT NULL,
      busPath TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      lastRunAt DATETIME,
      lastRunStatus TEXT,
      lastSessionId TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agentId, name)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS AgentCronJob_enabled_idx ON AgentCronJob(enabled)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS AgentCronJob_agentId_enabled_idx ON AgentCronJob(agentId, enabled)`,
  );
}

export type AgentCronJobRow = {
  id: string;
  agentId: string;
  name: string;
  cron: string;
  prompt: string;
  busPath: string | null;
  enabled: boolean;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  lastSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): AgentCronJobRow {
  return {
    id: String(r.id),
    agentId: String(r.agentId),
    name: String(r.name),
    cron: String(r.cron),
    prompt: String(r.prompt),
    busPath: r.busPath == null ? null : String(r.busPath),
    enabled: Boolean(r.enabled),
    lastRunAt: r.lastRunAt ? new Date(String(r.lastRunAt)) : null,
    lastRunStatus: r.lastRunStatus == null ? null : String(r.lastRunStatus),
    lastSessionId: r.lastSessionId == null ? null : String(r.lastSessionId),
    createdAt: new Date(String(r.createdAt)),
    updatedAt: new Date(String(r.updatedAt)),
  };
}

export async function listCronJobs(
  prisma: PrismaClient,
  opts?: { agentId?: string; enabledOnly?: boolean },
): Promise<AgentCronJobRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.agentId) {
    where.push("agentId = ?");
    params.push(opts.agentId);
  }
  if (opts?.enabledOnly) {
    where.push("enabled = 1");
  }
  const sql =
    `SELECT * FROM AgentCronJob` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY updatedAt DESC`;
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
  return rows.map(mapRow);
}

export async function getCronJobById(
  prisma: PrismaClient,
  id: string,
): Promise<AgentCronJobRow | null> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM AgentCronJob WHERE id = ? LIMIT 1`,
    id,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getCronJobByName(
  prisma: PrismaClient,
  agentId: string,
  name: string,
): Promise<AgentCronJobRow | null> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM AgentCronJob WHERE agentId = ? AND name = ? LIMIT 1`,
    agentId,
    name,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function upsertCronJob(
  prisma: PrismaClient,
  input: {
    agentId: string;
    name: string;
    cron: string;
    prompt: string;
    busPath?: string | null;
    enabled?: boolean;
  },
): Promise<AgentCronJobRow> {
  const existing = await getCronJobByName(prisma, input.agentId, input.name);
  const now = new Date().toISOString();
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  const busPath = input.busPath === undefined ? null : input.busPath;
  if (existing) {
    await prisma.$executeRawUnsafe(
      `UPDATE AgentCronJob SET cron = ?, prompt = ?, busPath = ?, enabled = ?, updatedAt = ? WHERE id = ?`,
      input.cron,
      input.prompt,
      busPath,
      enabled ? 1 : 0,
      now,
      existing.id,
    );
    return (await getCronJobById(prisma, existing.id))!;
  }
  const id = cuidLike();
  await prisma.$executeRawUnsafe(
    `INSERT INTO AgentCronJob (id, agentId, name, cron, prompt, busPath, enabled, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.agentId,
    input.name,
    input.cron,
    input.prompt,
    busPath,
    enabled ? 1 : 0,
    now,
    now,
  );
  return (await getCronJobById(prisma, id))!;
}

export async function deleteCronJob(
  prisma: PrismaClient,
  opts: { id?: string; agentId?: string; name?: string },
): Promise<{ deleted: number }> {
  if (opts.id) {
    const n = await prisma.$executeRawUnsafe(`DELETE FROM AgentCronJob WHERE id = ?`, opts.id);
    return { deleted: Number(n) };
  }
  if (opts.agentId && opts.name) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM AgentCronJob WHERE agentId = ? AND name = ?`,
      opts.agentId,
      opts.name,
    );
    return { deleted: Number(n) };
  }
  throw new Error("deleteCronJob 需要 id，或 agentId+name");
}

export async function markCronJobRun(
  prisma: PrismaClient,
  id: string,
  status: "success" | "failed" | "cancelled",
  sessionId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `UPDATE AgentCronJob SET lastRunAt = ?, lastRunStatus = ?, lastSessionId = ?, updatedAt = ? WHERE id = ?`,
    now,
    status,
    sessionId,
    now,
    id,
  );
}
