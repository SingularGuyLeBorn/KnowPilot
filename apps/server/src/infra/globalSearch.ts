/**
 * GlobalSearch — 跨实体关键词搜索（L5-M01，FTS5 + fallback）
 */

import type { PrismaClient } from "@prisma/client";
import type { ServiceContainer } from "./serviceContainer.js";
import { searchFts, type FtsHit } from "./ftsIndex.js";

export type GlobalSearchEntity =
  | "post"
  | "agent"
  | "skill"
  | "memory"
  | "task"
  | "mcp"
  | "message";

export interface GlobalSearchHit {
  entity: GlobalSearchEntity;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  score: number;
}

const ALL_ENTITIES: GlobalSearchEntity[] = [
  "post",
  "agent",
  "skill",
  "memory",
  "task",
  "mcp",
  "message",
];

function includesQuery(text: string | null | undefined, q: string): boolean {
  return (text ?? "").toLowerCase().includes(q);
}

async function hrefForFtsHit(prisma: PrismaClient, hit: FtsHit): Promise<string> {
  switch (hit.entity) {
    case "post": {
      const p = await prisma.post.findUnique({ where: { id: hit.entityId }, select: { slug: true } });
      return p ? `/posts/${encodeURIComponent(p.slug)}` : "/posts";
    }
    case "agent":
      return "/agents";
    case "skill":
      return "/skills";
    case "memory":
      return "/memories";
    case "task":
      return "/tasks";
    case "mcp":
      return "/mcp";
    case "message": {
      const msg = await prisma.chatMessage.findUnique({
        where: { id: hit.entityId },
        select: { sessionId: true },
      });
      return msg ? `/chat?sessionId=${msg.sessionId}` : "/chat";
    }
    default:
      return "/search";
  }
}

async function mapFtsHits(prisma: PrismaClient, rows: FtsHit[], targets: GlobalSearchEntity[]): Promise<GlobalSearchHit[]> {
  const hits: GlobalSearchHit[] = [];
  for (const row of rows) {
    if (!targets.includes(row.entity as GlobalSearchEntity)) continue;
    hits.push({
      entity: row.entity as GlobalSearchEntity,
      id: row.entityId,
      title: row.title,
      subtitle: row.body.slice(0, 120),
      href: await hrefForFtsHit(prisma, row),
      score: 3,
    });
  }
  return hits;
}

/** 并行搜索多个实体；优先 FTS5，无结果时 fallback contains */
export async function runGlobalSearch(
  prisma: PrismaClient,
  services: ServiceContainer,
  query: string,
  entities?: GlobalSearchEntity[],
  limit = 20,
): Promise<{ hits: GlobalSearchHit[]; tookMs: number }> {
  const start = Date.now();
  const q = query.trim().toLowerCase();
  const targets = entities?.length ? entities : ALL_ENTITIES;

  const ftsRows = await searchFts(prisma, query, limit);
  if (ftsRows.length > 0) {
    const hits = await mapFtsHits(prisma, ftsRows, targets);
    if (hits.length > 0) {
      return { hits: hits.slice(0, limit), tookMs: Date.now() - start };
    }
  }

  const hits: GlobalSearchHit[] = [];
  const perEntity = Math.max(5, Math.ceil(limit / targets.length));

  await Promise.all(
    targets.map(async (entity) => {
      switch (entity) {
        case "post": {
          const posts = await services.post.search(query, perEntity);
          for (const p of posts) {
            hits.push({
              entity: "post",
              id: p.id,
              title: p.title,
              subtitle: p.slug,
              href: `/posts/${encodeURIComponent(p.slug)}`,
              score: p.title.toLowerCase().includes(q) ? 2 : 1,
            });
          }
          break;
        }
        case "agent": {
          const list = await prisma.agent.findMany({
            where: {
              OR: [{ name: { contains: query } }, { description: { contains: query } }],
            },
            take: perEntity,
          });
          for (const a of list) {
            hits.push({
              entity: "agent",
              id: a.id,
              title: a.name,
              subtitle: a.description ?? undefined,
              href: "/agents",
              score: includesQuery(a.name, q) ? 2 : 1,
            });
          }
          break;
        }
        case "skill": {
          const list = await prisma.skill.findMany({
            where: {
              OR: [{ name: { contains: query } }, { description: { contains: query } }],
            },
            take: perEntity,
          });
          for (const s of list) {
            hits.push({
              entity: "skill",
              id: s.id,
              title: s.name,
              subtitle: s.description,
              href: "/skills",
              score: includesQuery(s.name, q) ? 2 : 1,
            });
          }
          break;
        }
        case "memory": {
          const list = await prisma.memory.findMany({
            where: { content: { contains: query } },
            take: perEntity,
          });
          for (const m of list) {
            hits.push({
              entity: "memory",
              id: m.id,
              title: m.content.slice(0, 80),
              subtitle: m.type,
              href: "/memories",
              score: 1,
            });
          }
          break;
        }
        case "task": {
          const list = await prisma.task.findMany({
            where: { name: { contains: query } },
            take: perEntity,
          });
          for (const t of list) {
            hits.push({
              entity: "task",
              id: t.id,
              title: t.name,
              subtitle: t.cronExpression ?? t.type,
              href: "/tasks",
              score: 1,
            });
          }
          break;
        }
        case "mcp": {
          const list = await prisma.mcpServer.findMany({
            where: { name: { contains: query } },
            take: perEntity,
          });
          for (const m of list) {
            hits.push({
              entity: "mcp",
              id: m.id,
              title: m.name,
              subtitle: m.command,
              href: "/mcp",
              score: 1,
            });
          }
          break;
        }
        case "message": {
          const list = await prisma.chatMessage.findMany({
            where: { content: { contains: query }, role: { in: ["user", "assistant"] } },
            take: perEntity,
            orderBy: { createdAt: "desc" },
            include: { session: { select: { id: true, title: true } } },
          });
          for (const msg of list) {
            hits.push({
              entity: "message",
              id: msg.id,
              title: msg.content.slice(0, 100),
              subtitle: msg.session?.title ?? msg.sessionId,
              href: `/chat?sessionId=${msg.sessionId}`,
              score: 1,
            });
          }
          break;
        }
      }
    }),
  );

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-CN"));
  return { hits: hits.slice(0, limit), tookMs: Date.now() - start };
}
