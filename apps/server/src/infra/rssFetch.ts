/**
 * RSS / Atom Feed 抓取与去重
 *
 * 借鉴 MetaBlog 信息源设计：
 * - sources 表同时存通用信源和 RSS（KnowPilot 已有 type="rss"）
 * - 抓取条目单独存表去重
 * - 可自动沉淀为 Post 草稿
 */

import type { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

export interface RssItem {
  guid: string;
  link: string;
  title: string;
  description?: string;
  publishedAt?: Date;
}

export interface FetchRssResult {
  success: boolean;
  sourceId: string;
  sourceName: string;
  fetchedCount: number;
  newCount: number;
  draftedCount: number;
  error?: string;
  items: RssItem[];
}

interface RssFetchOptions {
  /** 最多抓取多少条条目（默认 20） */
  maxItems?: number;
  /** 是否把新条目自动转成 Post 草稿 */
  autoDraft?: boolean;
  /** 草稿默认分类 */
  defaultCategory?: string;
  /** 抓取超时（毫秒，默认 15000） */
  timeoutMs?: number;
}

/** 从 XML 中提取 CDATA 或普通文本内容 */
function extractText(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))</${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return undefined;
  return (match[1] ?? match[2] ?? "").trim();
}

/** 从属性中提取值 */
function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, "i");
  return xml.match(regex)?.[1];
}

/** 简单的 HTML 标签剥离 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析 RSS 2.0 或 Atom */
export function parseRssFeed(xml: string, baseUrl: string): RssItem[] {
  const isAtom = xml.includes("<feed") || xml.includes('xmlns="http://www.w3.org/2005/Atom"');
  if (isAtom) return parseAtom(xml, baseUrl);
  return parseRss20(xml, baseUrl);
}

function parseRss20(xml: string, baseUrl: string): RssItem[] {
  const items: RssItem[] = [];
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channel = channelMatch?.[1] ?? xml;

  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(channel)) !== null) {
    const block = m[1];
    const title = extractText(block, "title") || "无标题";
    let link = extractText(block, "link") || "";
    if (!link) link = extractAttr(block, "link", "href") || "";
    const description = extractText(block, "description") || extractText(block, "content:encoded") || "";
    const pubDate = extractText(block, "pubDate");
    const guid = extractText(block, "guid") || link || title;

    if (!link && !guid) continue;
    if (!link) link = baseUrl;

    items.push({
      guid: guid || link,
      link: resolveUrl(link, baseUrl),
      title: stripHtml(title),
      description: stripHtml(description) || undefined,
      publishedAt: pubDate ? new Date(pubDate) : undefined,
    });
  }
  return items;
}

function parseAtom(xml: string, baseUrl: string): RssItem[] {
  const items: RssItem[] = [];
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = extractText(block, "title") || "无标题";
    let link = extractAttr(block, "link", "href") || "";
    if (!link) link = extractText(block, "link") || "";
    const summary = extractText(block, "summary") || extractText(block, "content") || "";
    const updated = extractText(block, "updated") || extractText(block, "published");
    const id = extractText(block, "id") || link || title;

    if (!link && !id) continue;
    if (!link) link = baseUrl;

    items.push({
      guid: id,
      link: resolveUrl(link, baseUrl),
      title: stripHtml(title),
      description: stripHtml(summary) || undefined,
      publishedAt: updated ? new Date(updated) : undefined,
    });
  }
  return items;
}

function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "KnowPilot RSS Fetcher/1.0 (+https://knowpilot.dev)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text || text.length < 50) throw new Error("响应内容过短");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** 稳定的 guid：优先用源内 guid，否则用 link/title 哈希 */
function stableGuid(sourceId: string, item: RssItem): string {
  if (item.guid && item.guid !== item.link && item.guid !== item.title) {
    return `${sourceId}:${item.guid}`;
  }
  const base = item.link || item.title;
  return `${sourceId}:${createHash("sha256").update(base).digest("hex").slice(0, 32)}`;
}

/**
 * 抓取单个 RSS/Atom 源，去重后返回条目。
 * 如果 source.type !== "rss" 仍会尝试抓取（用于 blog 等提供 feed 的源）。
 */
export async function fetchRssSource(
  prisma: PrismaClient,
  sourceId: string,
  options: RssFetchOptions = {},
): Promise<FetchRssResult> {
  const { maxItems = 20, timeoutMs = 15000 } = options;

  const source = await prisma.infoSource.findUnique({ where: { id: sourceId } });
  if (!source) return { success: false, sourceId, sourceName: "", fetchedCount: 0, newCount: 0, draftedCount: 0, error: "信息源不存在", items: [] };
  if (!source.enabled) return { success: false, sourceId, sourceName: source.name, fetchedCount: 0, newCount: 0, draftedCount: 0, error: "信息源已禁用", items: [] };

  await prisma.infoSource.update({
    where: { id: sourceId },
    data: { lastFetchedAt: new Date(), lastFetchStatus: "fetching", lastFetchError: null },
  });

  try {
    const xml = await fetchWithTimeout(source.url, timeoutMs);
    const parsed = parseRssFeed(xml, source.url);
    const items = parsed.slice(0, maxItems);

    // 查询已存在的 guid
    const guids = items.map((i) => stableGuid(sourceId, i));
    const existing = await prisma.infoSourceItem.findMany({
      where: { sourceId, guid: { in: guids } },
      select: { guid: true },
    });
    const existingSet = new Set(existing.map((e) => e.guid));

    const newItems: RssItem[] = [];
    for (const item of items) {
      const guid = stableGuid(sourceId, item);
      if (existingSet.has(guid)) continue;
      newItems.push({ ...item, guid });
      await prisma.infoSourceItem.create({
        data: {
          sourceId,
          guid,
          link: item.link,
          title: item.title,
          description: item.description,
          publishedAt: item.publishedAt,
          status: "fetched",
        },
      });
    }

    await prisma.infoSource.update({
      where: { id: sourceId },
      data: { lastFetchStatus: "success", lastFetchError: null },
    });

    return {
      success: true,
      sourceId,
      sourceName: source.name,
      fetchedCount: items.length,
      newCount: newItems.length,
      draftedCount: 0,
      items: newItems,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.infoSource.update({
      where: { id: sourceId },
      data: { lastFetchStatus: "error", lastFetchError: message },
    });
    return {
      success: false,
      sourceId,
      sourceName: source.name,
      fetchedCount: 0,
      newCount: 0,
      draftedCount: 0,
      error: message,
      items: [],
    };
  }
}

/**
 * 将 InfoSourceItem 转成 Post 草稿。
 * 返回创建的 post id 列表。
 */
export async function draftPostsFromRssItems(
  prisma: PrismaClient,
  sourceId: string,
  itemIds: string[],
  defaultCategory = "信息源",
): Promise<string[]> {
  const source = await prisma.infoSource.findUnique({ where: { id: sourceId } });
  if (!source) return [];

  const items = await prisma.infoSourceItem.findMany({
    where: { id: { in: itemIds }, sourceId, status: "fetched" },
  });

  const createdIds: string[] = [];
  for (const item of items) {
    const title = item.title || "无标题";
    const slugBase = title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "rss-item";
    const slug = `${slugBase}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

    const content = item.description
      ? `> 来源：[${source.name}](${source.url})\n> 原文：[${item.title}](${item.link})\n\n${item.description}`
      : `> 来源：[${source.name}](${source.url})\n> 原文：[${item.title}](${item.link})`;

    const excerpt = item.description ? item.description.slice(0, 200).replace(/\s+/g, " ") : `来自 ${source.name} 的 RSS 条目`;

    try {
      const post = await prisma.post.create({
        data: {
          title,
          slug,
          content,
          excerpt,
          category: defaultCategory,
          tags: ["RSS", source.name].join(","),
          published: false,
        },
      });
      await prisma.infoSourceItem.update({
        where: { id: item.id },
        data: { status: "drafted" },
      });
      createdIds.push(post.id);
    } catch (e) {
      // 通常是 slug 冲突，跳过
      console.warn(`[rssFetch] 创建 Post 草稿失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return createdIds;
}

/**
 * 扫描所有应抓取的信息源并执行抓取。
 * 用于 TaskRunner 的 rss:fetch 动作或心跳/定时调用。
 */
export async function fetchDueRssSources(
  prisma: PrismaClient,
  options: RssFetchOptions = {},
): Promise<FetchRssResult[]> {
  const now = new Date();
  const sources = await prisma.infoSource.findMany({
    where: {
      enabled: true,
      type: "rss",
      fetchInterval: { not: null },
      OR: [
        { lastFetchedAt: null },
        { lastFetchedAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } }, // 兜底：超过 1 小时未抓也抓一次
      ],
    },
  });

  const results: FetchRssResult[] = [];
  for (const source of sources) {
    const intervalMin = source.fetchInterval ?? 60;
    const due = !source.lastFetchedAt || now.getTime() - source.lastFetchedAt.getTime() >= intervalMin * 60 * 1000;
    if (!due) continue;
    results.push(await fetchRssSource(prisma, source.id, options));
  }
  return results;
}
