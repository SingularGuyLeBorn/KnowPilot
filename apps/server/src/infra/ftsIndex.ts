/**
 * SQLite FTS5 全文索引 — L5-M01
 */

import type { PrismaClient } from "@prisma/client";

export interface FtsHit {
  entity: string;
  entityId: string;
  title: string;
  body: string;
  /** FTS5 BM25 rank（通常为负数，越小越好）；无 rank 时省略 */
  rank?: number;
}

let ftsReady = false;

/** 安全截断，避免在 UTF-16 代理对中间切断（会导致 Prisma raw 参数 JSON 失败） */
function safeSlice(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  let s = text.slice(0, maxLen);
  const code = s.charCodeAt(s.length - 1);
  if (code >= 0xd800 && code <= 0xdbff) s = s.slice(0, -1);
  return s;
}

function escapeFtsQuery(query: string): string {
  return query
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" ");
}

export async function ensureFtsTable(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      entity UNINDEXED,
      entity_id UNINDEXED,
      title,
      body,
      tokenize='unicode61'
    );
  `);
  ftsReady = true;
}

/** 全量重建 FTS 索引（db:sync 后调用） */
export async function rebuildFtsIndex(prisma: PrismaClient): Promise<number> {
  await ensureFtsTable(prisma);

  // P1-7：收集所有插入参数后用单事务批量提交，避免逐条 $executeRawUnsafe 阻塞
  const rows: Array<[string, string, string, string]> = [];
  const add = (entity: string, entityId: string, title: string, body: string) => {
    rows.push([entity, entityId, safeSlice(title, 500), safeSlice(body, 8000)]);
  };

  // D5：重建时统一过滤墓碑（软删 post / deleted agent / superseded memory）
  const posts = await prisma.post.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, content: true, slug: true },
  });
  for (const p of posts) add("post", p.id, p.title, `${p.slug}\n${p.content ?? ""}`);

  const agents = await prisma.agent.findMany({
    where: { status: { not: "deleted" } },
    select: { id: true, name: true, description: true, systemPrompt: true },
  });
  for (const a of agents) add("agent", a.id, a.name, `${a.description ?? ""}\n${a.systemPrompt ?? ""}`);

  const skills = await prisma.skill.findMany({ select: { id: true, name: true, description: true, code: true } });
  for (const s of skills) add("skill", s.id, s.name, `${s.description}\n${s.code}`);

  const memories = await prisma.memory.findMany({
    where: { status: { not: "superseded" } },
    select: { id: true, content: true, type: true },
  });
  for (const m of memories) add("memory", m.id, m.type, m.content);

  const tasks = await prisma.task.findMany({ select: { id: true, name: true, cronExpression: true } });
  for (const t of tasks) add("task", t.id, t.name, t.cronExpression ?? "");

  const mcps = await prisma.mcpServer.findMany({ select: { id: true, name: true, command: true } });
  for (const m of mcps) add("mcp", m.id, m.name, m.command);

  const prompts = await prisma.prompt.findMany({
    select: { id: true, name: true, description: true, content: true },
  });
  for (const p of prompts) add("prompt", p.id, p.name, `${p.description ?? ""}\n${p.content ?? ""}`);

  const messages = await prisma.chatMessage.findMany({
    where: { role: { in: ["user", "assistant"] } },
    select: { id: true, content: true, sessionId: true },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });
  for (const msg of messages) add("message", msg.id, safeSlice(msg.content, 80), msg.content);

  // 事务内 DELETE + 批量 INSERT，原子且减少 IO 抖动
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`DELETE FROM search_fts;`),
    ...rows.map(([entity, entityId, title, body]) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO search_fts(entity, entity_id, title, body) VALUES (?, ?, ?, ?)`,
        entity,
        entityId,
        title,
        body,
      ),
    ),
  ]);

  console.log(`  🔍 [FTS] 索引已重建：${rows.length} 条`);
  return rows.length;
}

/** FTS 查询；无匹配或 FTS 不可用时返回空数组。含 BM25 rank（越小越好）。 */
export async function searchFts(prisma: PrismaClient, query: string, limit = 20): Promise<FtsHit[]> {
  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) return [];

  try {
    if (!ftsReady) await ensureFtsTable(prisma);
    const rows = await prisma.$queryRawUnsafe<
      Array<FtsHit & { entity_id?: string; rank?: number }>
    >(
      `SELECT entity, entity_id as entityId, title, body, rank
       FROM search_fts
       WHERE search_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      ftsQuery,
      limit,
    );
    return rows.map((r) => ({
      entity: r.entity,
      entityId: r.entityId ?? r.entity_id ?? "",
      title: r.title,
      body: r.body,
      rank: typeof r.rank === "number" ? r.rank : undefined,
    }));
  } catch {
    return [];
  }
}

/* ─── P11：FTS 增量维护（替代仅靠 db:sync 全量重建） ───
 * 实体 create/update 后 upsertFtsRow，delete 后 deleteFtsRow，
 * 使 CRUD 写入的内容立即可搜（此前要等下次 db:sync 才进索引）。
 * FTS5 无原生 upsert，用 DELETE+INSERT 事务实现原子替换。
 * 失败不应阻塞业务，调用方需 try/catch。
 */
export async function upsertFtsRow(
  prisma: PrismaClient,
  entity: string,
  entityId: string,
  title: string,
  body: string,
): Promise<void> {
  if (!ftsReady) await ensureFtsTable(prisma);
  const t = safeSlice(title, 500);
  const b = safeSlice(body, 8000);
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`DELETE FROM search_fts WHERE entity = ? AND entity_id = ?`, entity, entityId),
    prisma.$executeRawUnsafe(
      `INSERT INTO search_fts(entity, entity_id, title, body) VALUES (?, ?, ?, ?)`,
      entity,
      entityId,
      t,
      b,
    ),
  ]);
}

export async function deleteFtsRow(prisma: PrismaClient, entity: string, entityId: string): Promise<void> {
  if (!ftsReady) await ensureFtsTable(prisma);
  await prisma.$executeRawUnsafe(`DELETE FROM search_fts WHERE entity = ? AND entity_id = ?`, entity, entityId);
}
