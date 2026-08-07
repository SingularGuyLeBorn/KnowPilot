/**
 * 跨实体标签 facets / 按标签浏览（权威读路径，供 search.tagFacets / search.byTag）
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildTagFacets,
  INBOX_NOISE_TAGS,
  parseTags,
  type TagEntityKind,
  type TagFacet,
} from "@knowpilot/shared";

export interface TagBrowseHit {
  entity: TagEntityKind;
  id: string;
  title: string;
  href: string;
  tags: string[];
  excerpt?: string;
}

const ALL_KINDS: TagEntityKind[] = [
  "post",
  "skill",
  "memory",
  "prompt",
  "infoSource",
  "inbox",
];

function csvMatch(tag: string): { contains: string } {
  return { contains: tag };
}

function hrefFor(entity: TagEntityKind, id: string, extra?: { garden?: string; slug?: string }): string {
  switch (entity) {
    case "post":
      return extra?.garden && extra.slug
        ? `/posts/${extra.slug}?garden=${encodeURIComponent(extra.garden)}`
        : `/editor?id=${id}`;
    case "skill":
      return `/skills/edit/${id}`;
    case "memory":
      return `/memories/edit/${id}`;
    case "prompt":
      return `/prompts/edit/${id}`;
    case "infoSource":
      return `/sources`;
    case "inbox":
      return `/inbox`;
    default:
      return "/tags";
  }
}

export async function collectTagFacets(
  prisma: PrismaClient,
  entities?: TagEntityKind[],
  limit = 80,
): Promise<TagFacet[]> {
  const kinds = entities?.length ? entities : ALL_KINDS;
  const batches = await Promise.all(
    kinds.map(async (kind): Promise<Array<{ tags: string | null }>> => {
      switch (kind) {
        case "post":
          return prisma.post.findMany({
            where: { deletedAt: null, tags: { not: "" } },
            select: { tags: true },
            take: 2000,
          });
        case "skill":
          return prisma.skill.findMany({
            where: { tags: { not: "" } },
            select: { tags: true },
            take: 2000,
          });
        case "memory":
          return prisma.memory.findMany({
            where: { tags: { not: "" }, status: "active" },
            select: { tags: true },
            take: 2000,
          });
        case "prompt":
          return prisma.prompt.findMany({
            where: { tags: { not: "" } },
            select: { tags: true },
            take: 2000,
          });
        case "infoSource":
          return prisma.infoSource.findMany({
            where: { tags: { not: "" } },
            select: { tags: true },
            take: 2000,
          });
        case "inbox":
          return prisma.inboxItem.findMany({
            where: { tags: { not: "" } },
            select: { tags: true },
            take: 2000,
          });
        default:
          return [];
      }
    }),
  );

  return buildTagFacets(batches.flat(), { excludeNoise: true, limit });
}

export async function browseByTag(
  prisma: PrismaClient,
  tagRaw: string,
  entities?: TagEntityKind[],
  limit = 40,
): Promise<{ tag: string; hits: TagBrowseHit[] }> {
  const tag = parseTags(tagRaw)[0];
  if (!tag) return { tag: tagRaw.trim(), hits: [] };
  if (INBOX_NOISE_TAGS.has(tag.toLowerCase())) {
    return { tag, hits: [] };
  }

  const kinds = entities?.length ? entities : ALL_KINDS;
  const hits: TagBrowseHit[] = [];
  const per = Math.max(5, Math.ceil(limit / kinds.length) + 2);

  for (const kind of kinds) {
    if (hits.length >= limit) break;
    switch (kind) {
      case "post": {
        const items = await prisma.post.findMany({
          where: { deletedAt: null, tags: csvMatch(tag) },
          select: { id: true, title: true, tags: true, excerpt: true, garden: true, slug: true },
          take: per,
          orderBy: { updatedAt: "desc" },
        });
        for (const p of items) {
          const tags = parseTags(p.tags);
          if (!tags.includes(tag)) continue;
          hits.push({
            entity: "post",
            id: p.id,
            title: p.title,
            href: hrefFor("post", p.id, { garden: p.garden, slug: p.slug }),
            tags,
            excerpt: p.excerpt ?? undefined,
          });
        }
        break;
      }
      case "skill": {
        const items = await prisma.skill.findMany({
          where: { tags: csvMatch(tag) },
          select: { id: true, name: true, tags: true, description: true },
          take: per,
          orderBy: { updatedAt: "desc" },
        });
        for (const s of items) {
          const tags = parseTags(s.tags);
          if (!tags.includes(tag)) continue;
          hits.push({
            entity: "skill",
            id: s.id,
            title: s.name,
            href: hrefFor("skill", s.id),
            tags,
            excerpt: s.description,
          });
        }
        break;
      }
      case "memory": {
        const items = await prisma.memory.findMany({
          where: { tags: csvMatch(tag), status: "active" },
          select: { id: true, content: true, tags: true, type: true },
          take: per,
          orderBy: { updatedAt: "desc" },
        });
        for (const m of items) {
          const tags = parseTags(m.tags);
          if (!tags.includes(tag)) continue;
          hits.push({
            entity: "memory",
            id: m.id,
            title: m.content.slice(0, 80) || `(${m.type})`,
            href: hrefFor("memory", m.id),
            tags,
            excerpt: m.content.slice(0, 160),
          });
        }
        break;
      }
      case "prompt": {
        const items = await prisma.prompt.findMany({
          where: { tags: csvMatch(tag) },
          select: { id: true, name: true, tags: true, description: true },
          take: per,
          orderBy: { updatedAt: "desc" },
        });
        for (const p of items) {
          const tags = parseTags(p.tags);
          if (!tags.includes(tag)) continue;
          hits.push({
            entity: "prompt",
            id: p.id,
            title: p.name,
            href: hrefFor("prompt", p.id),
            tags,
            excerpt: p.description ?? undefined,
          });
        }
        break;
      }
      case "infoSource": {
        const items = await prisma.infoSource.findMany({
          where: { tags: csvMatch(tag) },
          select: { id: true, name: true, tags: true, description: true, url: true },
          take: per,
          orderBy: { updatedAt: "desc" },
        });
        for (const s of items) {
          const tags = parseTags(s.tags);
          if (!tags.includes(tag)) continue;
          hits.push({
            entity: "infoSource",
            id: s.id,
            title: s.name,
            href: hrefFor("infoSource", s.id),
            tags,
            excerpt: s.description || s.url,
          });
        }
        break;
      }
      case "inbox": {
        const items = await prisma.inboxItem.findMany({
          where: { tags: csvMatch(tag) },
          select: { id: true, title: true, tags: true, excerpt: true },
          take: per,
          orderBy: { updatedAt: "desc" },
        });
        for (const i of items) {
          const tags = parseTags(i.tags).filter((t) => !INBOX_NOISE_TAGS.has(t.toLowerCase()));
          if (!parseTags(i.tags).includes(tag)) continue;
          hits.push({
            entity: "inbox",
            id: i.id,
            title: i.title || "Inbox 条目",
            href: hrefFor("inbox", i.id),
            tags,
            excerpt: i.excerpt ?? undefined,
          });
        }
        break;
      }
    }
  }

  hits.sort((a, b) => a.title.localeCompare(b.title, "zh"));
  return { tag, hits: hits.slice(0, limit) };
}
