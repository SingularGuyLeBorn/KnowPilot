/**
 * SQLite FTS5 全文索引 — L5-M01
 */

import type { PrismaClient } from "@prisma/client";

export interface FtsHit {
  entity: string;
  entityId: string;
  title: string;
  body: string;
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
  await prisma.$executeRawUnsafe(`DELETE FROM search_fts;`);

  let count = 0;
  const insert = async (entity: string, entityId: string, title: string, body: string) => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO search_fts(entity, entity_id, title, body) VALUES (?, ?, ?, ?)`,
      entity,
      entityId,
      safeSlice(title, 500),
      safeSlice(body, 8000),
    );
    count++;
  };

  const posts = await prisma.post.findMany({ select: { id: true, title: true, content: true, slug: true } });
  for (const p of posts) {
    await insert("post", p.id, p.title, `${p.slug}\n${p.content ?? ""}`);
  }

  const agents = await prisma.agent.findMany({ select: { id: true, name: true, description: true, systemPrompt: true } });
  for (const a of agents) {
    await insert("agent", a.id, a.name, `${a.description ?? ""}\n${a.systemPrompt ?? ""}`);
  }

  const skills = await prisma.skill.findMany({ select: { id: true, name: true, description: true, code: true } });
  for (const s of skills) {
    await insert("skill", s.id, s.name, `${s.description}\n${s.code}`);
  }

  const memories = await prisma.memory.findMany({ select: { id: true, content: true, type: true } });
  for (const m of memories) {
    await insert("memory", m.id, m.type, m.content);
  }

  const tasks = await prisma.task.findMany({ select: { id: true, name: true, cronExpression: true } });
  for (const t of tasks) {
    await insert("task", t.id, t.name, t.cronExpression ?? "");
  }

  const mcps = await prisma.mcpServer.findMany({ select: { id: true, name: true, command: true } });
  for (const m of mcps) {
    await insert("mcp", m.id, m.name, m.command);
  }

  const messages = await prisma.chatMessage.findMany({
    where: { role: { in: ["user", "assistant"] } },
    select: { id: true, content: true, sessionId: true },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });
  for (const msg of messages) {
    await insert("message", msg.id, safeSlice(msg.content, 80), msg.content);
  }

  console.log(`  🔍 [FTS] 索引已重建：${count} 条`);
  return count;
}

/** FTS 查询；无匹配或 FTS 不可用时返回空数组 */
export async function searchFts(prisma: PrismaClient, query: string, limit = 20): Promise<FtsHit[]> {
  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) return [];

  try {
    if (!ftsReady) await ensureFtsTable(prisma);
    const rows = await prisma.$queryRawUnsafe<Array<FtsHit & { entity_id?: string }>>(
      `SELECT entity, entity_id as entityId, title, body
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
    }));
  } catch {
    return [];
  }
}
