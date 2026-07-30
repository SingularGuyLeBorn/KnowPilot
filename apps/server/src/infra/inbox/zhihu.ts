/**
 * 知乎 Inbox 同步
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import { loadCookies, type CookieJarEntry } from "../cookieJar.js";
import { getPlatformStorageStatePath } from "../metablog/auth/platformLogin.js";
import { launchPlaywrightBrowser } from "../metablog/playwrightChrome.js";
import { parsePlatformUrl } from "../metablog/index.js";
import {
  resolveZhihuAccessSecret,
  zhihuFavlistContents,
  zhihuUserFavlists,
} from "../zhihuOpenApi.js";
import {
  ensureInboxDirs,
  throwIfInboxSyncAborted,
  upsertInboxItem,
  captureInboxUrl,
  shouldStopIncrementalKnownStreak,
  InboxSyncProgressTracker,
  cookiesToHeader,
  type InboxSyncProgressFn,
  type InboxSyncProgressChild,
  type InboxSyncResult,
  type ZhihuSyncMode,
  type ZhihuCollectionMeta,
} from "./shared.js";

const ZHIHU_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function extractZhihuCollectionId(collectionUrl: string): string | null {
  const m = collectionUrl.match(/\/collections?\/(\d+)/i);
  return m?.[1] ?? null;
}

/**
 * 知乎开放平台收藏夹翻页：不盲信 IsEnd；缺 NextOffset 时用已扫条数续翻。
 * 避免「我的收藏」只拉一页（~20 条）就停、全量远少于 Totals。
 */
export function resolveZhihuFavlistNextOffset(opts: {
  currentOffset: number | string;
  nextOffset: string | number | undefined | null;
  isEnd: boolean | undefined;
  pageItemCount: number;
  scanned: number;
  remoteCount?: number;
}): { done: boolean; offset: number | string } {
  const { currentOffset, nextOffset, pageItemCount, scanned, remoteCount } = opts;
  const ended = opts.isEnd === true;
  if (pageItemCount <= 0) return { done: true, offset: currentOffset };

  const hasMoreByTotal = remoteCount != null && scanned < remoteCount;
  const nextStr =
    nextOffset === undefined || nextOffset === null ? "" : String(nextOffset);
  const nextUsable = nextStr !== "" && nextStr !== String(currentOffset);

  if (nextUsable) {
    // API 声称结束但 Totals 明显未扫完 → 仍跟 NextOffset 续翻
    if (ended && !hasMoreByTotal) {
      return { done: true, offset: currentOffset };
    }
    return { done: false, offset: nextOffset as string | number };
  }

  if (hasMoreByTotal) {
    const fallback =
      typeof currentOffset === "number" ? currentOffset + pageItemCount : scanned;
    if (String(fallback) === String(currentOffset)) {
      return { done: true, offset: currentOffset };
    }
    return { done: false, offset: fallback };
  }

  if (ended) return { done: true, offset: currentOffset };
  // 无 Totals、无 NextOffset、未宣称结束：用条数偏移再试一页
  const fallback =
    typeof currentOffset === "number" ? currentOffset + pageItemCount : scanned;
  if (String(fallback) !== String(currentOffset)) {
    return { done: false, offset: fallback };
  }
  return { done: true, offset: currentOffset };
}

/** 解析知乎 favlists / collections 列表 API */
export function parseZhihuFavlistsJson(json: unknown): ZhihuCollectionMeta[] {
  const root = json as {
    data?: Array<{
      id?: number | string;
      title?: string;
      url?: string;
      answer_count?: number;
      item_count?: number;
      follower_count?: number;
    }>;
  };
  const out: ZhihuCollectionMeta[] = [];
  for (const row of root?.data ?? []) {
    const id = String(row.id ?? "");
    if (!/^\d+$/.test(id)) continue;
    const title = String(row.title || `收藏夹 ${id}`).slice(0, 200);
    const url =
      row.url && String(row.url).startsWith("http")
        ? String(row.url)
        : `https://www.zhihu.com/collection/${id}`;
    const itemCount =
      typeof row.answer_count === "number"
        ? row.answer_count
        : typeof row.item_count === "number"
          ? row.item_count
          : undefined;
    out.push({ id, title, url, itemCount });
  }
  return out;
}

type ZhihuListItem = { title: string; url: string; excerpt?: string; author?: string };

/** 解析知乎 collection items API */
export function parseZhihuCollectionItemsJson(json: unknown): {
  items: ZhihuListItem[];
  isEnd: boolean;
} {
  const data = json as {
    data?: Array<{
      content?: {
        type?: string;
        title?: string;
        question?: { title?: string; id?: number };
        id?: number | string;
        url?: string;
        excerpt?: string;
        author?: { name?: string };
      };
    }>;
    paging?: { is_end?: boolean };
  };
  const items: ZhihuListItem[] = [];
  for (const row of data.data ?? []) {
    const c = row.content;
    if (!c) continue;
    let title = c.title || c.question?.title || "知乎收藏";
    let url = c.url || "";
    if (!url && c.type === "answer" && c.question?.id && c.id) {
      url = `https://www.zhihu.com/question/${c.question.id}/answer/${c.id}`;
    } else if (!url && c.type === "article" && c.id) {
      url = `https://zhuanlan.zhihu.com/p/${c.id}`;
    }
    if (!url) continue;
    if (!url.startsWith("http")) url = `https://www.zhihu.com${url}`;
    items.push({
      title: String(title).slice(0, 200),
      url,
      excerpt: c.excerpt ? String(c.excerpt).slice(0, 280) : undefined,
      author: c.author?.name,
    });
  }
  return { items, isEnd: Boolean(data.paging?.is_end) };
}

async function zhihuFetchJson(
  apiUrl: string,
  cookies: CookieJarEntry[],
  referer: string,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(apiUrl, {
    headers: {
      Cookie: cookiesToHeader(cookies),
      "User-Agent": ZHIHU_UA,
      Referer: referer,
      Accept: "application/json",
    },
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * 发现当前登录用户的全部收藏夹。
 * 优先 /api/v4/me → favlists；失败再 Playwright 打开个人页 collections Tab。
 */
export async function listZhihuMyCollections(opts?: {
  maxCollections?: number;
}): Promise<{ collections: ZhihuCollectionMeta[]; errors: string[]; urlToken?: string }> {
  const maxCollections = opts?.maxCollections ?? 50;
  const errors: string[] = [];
  const cookies = loadCookies("zhihu");
  const storageState = getPlatformStorageStatePath("zhihu");
  if (!cookies.length && !storageState) {
    return {
      collections: [],
      errors: ["知乎未登录。请先在 Chat 调用 platform_login(platform=zhihu) 扫码登录。"],
    };
  }

  let urlToken: string | undefined;
  const byId = new Map<string, ZhihuCollectionMeta>();

  if (cookies.length) {
    try {
      const me = await zhihuFetchJson("https://www.zhihu.com/api/v4/me", cookies, "https://www.zhihu.com/");
      if (me.ok && me.json && typeof me.json === "object") {
        const token = (me.json as { url_token?: string }).url_token;
        if (token) urlToken = String(token);
      } else if (!me.ok) {
        errors.push(`知乎 /me API ${me.status}`.slice(0, 200));
      }
    } catch (err) {
      errors.push(`知乎 /me 失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (urlToken) {
      let offset = 0;
      const limit = 20;
      for (let page = 0; page < 40 && byId.size < maxCollections; page++) {
        const apiUrl =
          `https://www.zhihu.com/api/v4/members/${encodeURIComponent(urlToken)}/favlists` +
          `?offset=${offset}&limit=${limit}&include=data%5B*%5D.updated_time%2Canswer_count%2Cfollower_count%2Ccreator%2Cdescription%2Cis_following%2Cis_public%2Ccreated_time`;
        try {
          const res = await zhihuFetchJson(
            apiUrl,
            cookies,
            `https://www.zhihu.com/people/${urlToken}/collections`,
          );
          if (!res.ok) {
            errors.push(`知乎 favlists API ${res.status}`.slice(0, 200));
            break;
          }
          const batch = parseZhihuFavlistsJson(res.json);
          if (!batch.length) break;
          for (const c of batch) {
            if (byId.size >= maxCollections) break;
            byId.set(c.id, c);
          }
          const paging = (res.json as { paging?: { is_end?: boolean } })?.paging;
          if (paging?.is_end) break;
          offset += limit;
        } catch (err) {
          errors.push(`favlists 失败: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }
    }
  }

  if (byId.size === 0) {
    try {
      const { chromium } = await import("playwright");
      // headless:true 必须放在 isZhihu 旁：launch 里 ...rest 会覆盖 isZhihu 默认的可见窗
      const browser = await launchPlaywrightBrowser(chromium, { isZhihu: true, headless: true });
      try {
        const context = await browser.newContext({
          ...(storageState ? { storageState } : {}),
          userAgent: ZHIHU_UA,
          viewport: { width: 1280, height: 900 },
        });
        if (!storageState && cookies.length) {
          await context.addCookies(
            cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain.startsWith(".") ? c.domain : c.domain,
              path: c.path || "/",
            })),
          );
        }
        const page = await context.newPage();
        await page.goto("https://www.zhihu.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
        await new Promise((r) => setTimeout(r, 1500));

        if (!urlToken) {
          const href = await page.evaluate(() => {
            const a =
              document.querySelector<HTMLAnchorElement>('a[href*="/people/"]') ||
              document.querySelector<HTMLAnchorElement>('a[href*="/org/"]');
            return a?.href || null;
          });
          const m = href?.match(/\/(?:people|org)\/([^/?#]+)/);
          if (m?.[1]) urlToken = decodeURIComponent(m[1]);
        }

        if (urlToken) {
          for (let pageNum = 1; pageNum <= 20 && byId.size < maxCollections; pageNum++) {
            const listUrl =
              pageNum === 1
                ? `https://www.zhihu.com/people/${urlToken}/collections`
                : `https://www.zhihu.com/people/${urlToken}/collections?page=${pageNum}`;
            await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
            await new Promise((r) => setTimeout(r, 2000));
            for (let i = 0; i < 2; i++) {
              await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
              await new Promise((r) => setTimeout(r, 1200));
            }
            const found = await page.evaluate(() => {
              const results: Array<{ id: string; title: string; href: string }> = [];
              document.querySelectorAll<HTMLAnchorElement>('a[href*="/collection/"]').forEach((a) => {
                const href = a.href;
                if (href.includes("/collections")) return;
                const id = href.match(/\/collection\/(\d+)/)?.[1];
                if (!id) return;
                const title = (a.textContent || "").trim();
                if (!title || title.length < 1) return;
                results.push({ id, title, href });
              });
              return results;
            });
            let newCount = 0;
            for (const c of found) {
              if (byId.has(c.id) || byId.size >= maxCollections) continue;
              byId.set(c.id, {
                id: c.id,
                title: c.title.slice(0, 200),
                url: c.href.split("?")[0]!,
              });
              newCount += 1;
            }
            if (newCount === 0 || found.length < 3) break;
          }
        } else {
          errors.push("未能解析知乎 url_token，请确认登录态有效。");
        }
        await context.close();
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (err) {
      errors.push(`Playwright 发现收藏夹失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (byId.size === 0 && !errors.length) {
    errors.push("未发现任何收藏夹。请确认账号下已有收藏夹。");
  }

  return {
    collections: Array.from(byId.values()).slice(0, maxCollections),
    errors,
    urlToken,
  };
}

async function countLocalZhihuCollectionItems(
  prisma: PrismaClient,
  collectionId: string,
): Promise<number> {
  return prisma.inboxItem.count({
    where: {
      source: "zhihu",
      OR: [
        { metadata: { contains: `"collectionId":"${collectionId}"` } },
        { metadata: { contains: `"collectionId": ${collectionId}` } },
        { externalId: { startsWith: `zhcol:${collectionId}:` } },
      ],
    },
  });
}

async function fetchZhihuCollectionItemsList(
  collection: ZhihuCollectionMeta,
  cookies: CookieJarEntry[],
  maxItems: number,
): Promise<{ items: ZhihuListItem[]; errors: string[] }> {
  const list: ZhihuListItem[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  if (cookies.length) {
    try {
      let offset = 0;
      const limit = 20;
      while (list.length < maxItems) {
        const apiUrl = `https://www.zhihu.com/api/v4/collections/${collection.id}/items?offset=${offset}&limit=${limit}`;
        const res = await zhihuFetchJson(apiUrl, cookies, collection.url);
        if (!res.ok) {
          errors.push(
            `收藏夹「${collection.title}」API ${res.status}: ${res.text}`.slice(0, 300),
          );
          break;
        }
        const parsed = parseZhihuCollectionItemsJson(res.json);
        if (!parsed.items.length) break;
        for (const item of parsed.items) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          list.push(item);
          if (list.length >= maxItems) break;
        }
        if (parsed.isEnd) break;
        offset += limit;
      }
    } catch (err) {
      errors.push(
        `收藏夹「${collection.title}」API 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (list.length === 0) {
    try {
      const parsed = await parsePlatformUrl({
        url: collection.url,
        timeout: 60000,
        method: "playwright",
        platform: "ZhihuCollection",
        embedOcr: false,
      });
      const md = String(parsed.content ?? "");
      const blockRe = /## (.+)\n(?:- 作者: (.+)\n)?- 链接: (.+)\n(?:- 摘要: (.+)\n)?/g;
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(md)) !== null && list.length < maxItems) {
        const url = m[3].trim();
        if (seen.has(url)) continue;
        seen.add(url);
        list.push({
          title: m[1].trim(),
          author: m[2]?.trim(),
          url,
          excerpt: m[4]?.trim(),
        });
      }
      if (list.length === 0) {
        errors.push(`收藏夹「${collection.title}」解析为空：请确认已登录且可访问。`);
      }
    } catch (err) {
      errors.push(
        `收藏夹「${collection.title}」Playwright 降级失败: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { items: list, errors };
}

/**
 * 同步单个收藏夹：分页拉取 + upsert；incremental 时连续 10 条已落盘则提前停。
 * externalId 仍用文章 URL（与历史一致），metadata 带 collectionId 便于计数。
 */
export async function syncOneZhihuCollection(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    collection: ZhihuCollectionMeta;
    mode?: ZhihuSyncMode;
    maxItems?: number;
    fetchContent?: boolean;
    maxChars?: number;
    /** 跨收藏夹共享的进度计数器 */
    progress?: InboxSyncProgressTracker;
    shouldAbort?: () => boolean;
  },
): Promise<{
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  items: Array<{ id: string; title: string; url?: string | null; created: boolean }>;
  stoppedEarly: boolean;
  remoteCount?: number;
  localCount: number;
  approxNew?: number;
}> {
  const mode: ZhihuSyncMode = opts.mode ?? "incremental";
  const maxItems = opts.maxItems ?? 5000;
  const cookies = loadCookies("zhihu");
  const pageSize = 20;
  const progress = opts.progress;
  const shouldAbort = opts.shouldAbort;

  const localCountBefore = await countLocalZhihuCollectionItems(prisma, opts.collection.id);
  const remoteCount = opts.collection.itemCount;
  const approxNew =
    typeof remoteCount === "number" ? Math.max(0, remoteCount - localCountBefore) : undefined;

  if (typeof remoteCount === "number" && remoteCount > 0) {
    progress?.addTotal(Math.min(remoteCount, maxItems));
  }

  const resultItems: Array<{ id: string; title: string; url?: string | null; created: boolean }> =
    [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let scanned = 0;
  let stoppedEarly = false;

  const upsertItem = async (item: ZhihuListItem): Promise<boolean> => {
    scanned += 1;
    if (typeof remoteCount !== "number") progress?.addTotal(1);
    try {
      if (opts.fetchContent) {
        const captured = await captureInboxUrl(prisma, config, {
          url: item.url,
          source: "zhihu",
          fetchContent: true,
          maxChars: opts.maxChars,
        });
        await prisma.inboxItem.update({
          where: { id: captured.id },
          data: {
            tags: "zhihu,collection",
            metadata: JSON.stringify({
              collectionUrl: opts.collection.url,
              collectionId: opts.collection.id,
              collectionTitle: opts.collection.title,
              author: item.author,
            }),
          },
        });
        if (captured.created) created += 1;
        else updated += 1;
        resultItems.push(captured);
        progress?.success();
        return captured.created;
      }
      const upserted = await upsertInboxItem(prisma, {
        source: "zhihu",
        externalId: item.url,
        title: item.title,
        url: item.url,
        excerpt: item.excerpt ?? null,
        tags: ["zhihu", "collection"],
        metadata: {
          collectionUrl: opts.collection.url,
          collectionId: opts.collection.id,
          collectionTitle: opts.collection.title,
          author: item.author,
        },
      });
      if (upserted.created) created += 1;
      else updated += 1;
      resultItems.push(upserted);
      progress?.success();
      return upserted.created;
    } catch (err) {
      skipped += 1;
      errors.push(`${item.url}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  let apiOk = false;
  let streakKnown = 0;
  if (cookies.length) {
    try {
      let offset = 0;
      while (scanned < maxItems) {
        throwIfInboxSyncAborted(shouldAbort);
        const apiUrl = `https://www.zhihu.com/api/v4/collections/${opts.collection.id}/items?offset=${offset}&limit=${pageSize}`;
        const res = await zhihuFetchJson(apiUrl, cookies, opts.collection.url);
        if (!res.ok) {
          errors.push(
            `收藏夹「${opts.collection.title}」API ${res.status}: ${res.text}`.slice(0, 300),
          );
          break;
        }
        apiOk = true;
        const parsed = parseZhihuCollectionItemsJson(res.json);
        if (!parsed.items.length) break;

        for (const item of parsed.items) {
          if (seen.has(item.url) || scanned >= maxItems) continue;
          seen.add(item.url);
          const isNew = await upsertItem(item);
          if (isNew) streakKnown = 0;
          else streakKnown += 1;
          if (mode === "incremental" && shouldStopIncrementalKnownStreak(streakKnown)) {
            stoppedEarly = true;
            break;
          }
        }
        if (stoppedEarly) break;
        if (parsed.isEnd) break;
        offset += pageSize;
      }
    } catch (err) {
      errors.push(
        `收藏夹「${opts.collection.title}」API 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!apiOk && resultItems.length === 0) {
    const fetched = await fetchZhihuCollectionItemsList(opts.collection, cookies, maxItems);
    errors.push(...fetched.errors);
    for (const item of fetched.items) {
      if (seen.has(item.url) || scanned >= maxItems) continue;
      seen.add(item.url);
      const isNew = await upsertItem(item);
      if (isNew) streakKnown = 0;
      else streakKnown += 1;
      if (mode === "incremental" && shouldStopIncrementalKnownStreak(streakKnown)) {
        stoppedEarly = true;
        break;
      }
    }
  }

  return {
    scanned,
    created,
    updated,
    skipped,
    errors,
    items: resultItems,
    stoppedEarly,
    remoteCount,
    localCount: localCountBefore,
    approxNew,
  };
}

/**
 * 经知乎开放平台同步单个收藏夹（Access Secret，无 cookie）。
 */
async function syncOneZhihuCollectionOpenApi(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    secret: string;
    collection: ZhihuCollectionMeta;
    mode: ZhihuSyncMode;
    maxItems: number;
    /** 入库上限；列表仍可扫到 maxItems */
    maxUpsert?: number;
    fetchContent?: boolean;
    maxChars?: number;
    progress?: InboxSyncProgressTracker;
    shouldAbort?: () => boolean;
  },
): Promise<{
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  items: Array<{ id: string; title: string; url?: string | null; created: boolean }>;
  stoppedEarly: boolean;
  remoteCount?: number;
  localCount: number;
  approxNew?: number;
}> {
  const pageSize = 50;
  const urlToken = Number(opts.collection.id);
  const localCountBefore = await countLocalZhihuCollectionItems(prisma, opts.collection.id);
  const progress = opts.progress;
  const shouldAbort = opts.shouldAbort;
  const resultItems: Array<{ id: string; title: string; url?: string | null; created: boolean }> =
    [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let scanned = 0;
  let stoppedEarly = false;
  let streakKnown = 0;
  let remoteCount: number | undefined;
  let totalHinted = false;
  let offset: number | string = 0;
  let pageGuard = 0;
  const maxPages = Math.ceil(opts.maxItems / 10) + 5;

  while (scanned < opts.maxItems && pageGuard < maxPages) {
    throwIfInboxSyncAborted(shouldAbort);
    pageGuard += 1;
    const page = await zhihuFavlistContents(opts.secret, {
      favlistUrlToken: urlToken,
      offset,
      limit: pageSize,
    });
    if (!page.ok) {
      errors.push(
        `开放平台收藏夹「${opts.collection.title}」失败 Code=${page.code}: ${page.message}`,
      );
      break;
    }
    if (typeof page.data.Paging?.Totals === "number") {
      remoteCount = page.data.Paging.Totals;
      if (!totalHinted) {
        progress?.addTotal(Math.min(remoteCount, opts.maxItems));
        totalHinted = true;
      }
    }
    const items = page.data.Items ?? [];
    if (!items.length) break;

    let pageItemCount = 0;
    for (const row of items) {
      if (scanned >= opts.maxItems) break;
      const url = String(row.Url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      pageItemCount += 1;
      scanned += 1;
      if (!totalHinted) progress?.addTotal(1);
      // 试跑：列表继续扫，入库满 maxUpsert 后不再写
      if (opts.maxUpsert != null && created + updated >= opts.maxUpsert) {
        continue;
      }
      try {
        const title = String(row.Title || url).slice(0, 200);
        const excerpt = row.Summary ? String(row.Summary).slice(0, 500) : null;
        let isNew = false;
        if (opts.fetchContent) {
          const captured = await captureInboxUrl(prisma, config, {
            url,
            source: "zhihu",
            fetchContent: true,
            maxChars: opts.maxChars,
          });
          await prisma.inboxItem.update({
            where: { id: captured.id },
            data: {
              tags: "zhihu,collection,openapi",
              metadata: JSON.stringify({
                collectionUrl: opts.collection.url,
                collectionId: opts.collection.id,
                collectionTitle: opts.collection.title,
                contentType: row.ContentType,
                via: "zhihu_openapi",
              }),
            },
          });
          isNew = captured.created;
          if (captured.created) created += 1;
          else updated += 1;
          resultItems.push(captured);
          progress?.success();
        } else {
          const upserted = await upsertInboxItem(prisma, {
            source: "zhihu",
            externalId: url,
            title,
            url,
            excerpt,
            tags: ["zhihu", "collection", "openapi"],
            metadata: {
              collectionUrl: opts.collection.url,
              collectionId: opts.collection.id,
              collectionTitle: opts.collection.title,
              contentType: row.ContentType,
              via: "zhihu_openapi",
            },
          });
          isNew = upserted.created;
          if (upserted.created) created += 1;
          else updated += 1;
          resultItems.push(upserted);
          progress?.success();
        }
        if (isNew) streakKnown = 0;
        else streakKnown += 1;
        if (opts.mode === "incremental" && shouldStopIncrementalKnownStreak(streakKnown)) {
          stoppedEarly = true;
          break;
        }
      } catch (err) {
        skipped += 1;
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (stoppedEarly) break;
    const next = resolveZhihuFavlistNextOffset({
      currentOffset: offset,
      nextOffset: page.data.Paging?.NextOffset,
      isEnd: page.data.Paging?.IsEnd,
      pageItemCount,
      scanned,
      remoteCount,
    });
    if (next.done) break;
    offset = next.offset;
  }

  return {
    scanned,
    created,
    updated,
    skipped,
    errors,
    items: resultItems,
    stoppedEarly,
    remoteCount,
    localCount: localCountBefore,
    approxNew:
      typeof remoteCount === "number" ? Math.max(0, remoteCount - localCountBefore) : undefined,
  };
}

/**
 * 知乎收藏同步：
 * - 有 ZHIHU_ACCESS_SECRET → 优先官方开放平台 favlists（无需 platform_login）
 * - 否则回退 cookie / storageState + 站内 API
 * - mode=full 拉到护栏/末尾；mode=incremental（默认）连续 10 条已落盘即停
 */
export async function syncZhihuCollection(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    collectionUrl?: string;
    mode?: ZhihuSyncMode;
    maxCollections?: number;
    maxItemsPerCollection?: number;
    maxItems?: number;
    maxUpsert?: number;
    fetchContent?: boolean;
    maxChars?: number;
    onProgress?: InboxSyncProgressFn;
    /** 全量/增量均可中途停止 */
    shouldAbort?: () => boolean;
  },
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const mode: ZhihuSyncMode = opts.mode ?? "incremental";
  const perCollection =
    opts.maxItems ?? opts.maxItemsPerCollection ?? (opts.collectionUrl ? 50 : 5000);
  const maxCollections = opts.maxCollections ?? 50;
  const progress = new InboxSyncProgressTracker(opts.onProgress);
  const shouldAbort = opts.shouldAbort;
  let upsertBudget =
    opts.maxUpsert != null && opts.maxUpsert > 0 ? opts.maxUpsert : undefined;

  const openApiSecret = await resolveZhihuAccessSecret(prisma);
  if (openApiSecret) {
    const errors: string[] = [];
    const collections: ZhihuCollectionMeta[] = [];
    progress.setMessage("正在拉取收藏夹列表…");
    throwIfInboxSyncAborted(shouldAbort);

    if (opts.collectionUrl?.trim()) {
      const id = extractZhihuCollectionId(opts.collectionUrl);
      if (!id) {
        return {
          scanned: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: [`无法从 URL 解析收藏夹 id: ${opts.collectionUrl}`],
          items: [],
          mode,
        };
      }
      collections.push({
        id,
        title: `收藏夹 ${id}`,
        url: opts.collectionUrl.trim(),
      });
    } else {
      const listed = await zhihuUserFavlists(openApiSecret, maxCollections);
      if (!listed.ok) {
        errors.push(`开放平台 favlists 失败 Code=${listed.code}: ${listed.message}`);
      } else {
        for (const row of listed.data.Items ?? []) {
          collections.push({
            id: String(row.UrlToken),
            title: row.Title || `收藏夹 ${row.UrlToken}`,
            url: row.Url || `https://www.zhihu.com/collection/${row.UrlToken}`,
          });
        }
      }
    }

    const result: InboxSyncResult = {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors,
      items: [],
      mode,
      collectionsDiscovered: collections.length,
      collectionsSynced: 0,
      byCollection: [],
    };
    if (!collections.length) {
      if (!result.errors.length) result.errors.push("开放平台未返回可同步收藏夹。");
      return result;
    }

    const children: InboxSyncProgressChild[] = collections.map((c) => ({
      id: c.id,
      label: c.title,
      total: 0,
      done: 0,
      status: "pending",
    }));
    progress.setMessage(`共 ${collections.length} 个收藏夹`);
    progress.setChildren(children);

    for (const collection of collections) {
      throwIfInboxSyncAborted(shouldAbort);
      if (upsertBudget != null && upsertBudget <= 0) break;
      const child = children.find((c) => c.id === collection.id)!;
      child.status = "running";
      child.message = "拉取中…";
      progress.setMessage(`知乎 · ${collection.title}`);
      progress.setChildren(children);
      const childTracker = new InboxSyncProgressTracker((p) => {
        child.total = p.total;
        child.done = p.done;
        if (p.message) child.message = p.message;
        progress.total = children.reduce((n, c) => n + c.total, 0);
        progress.done = children.reduce((n, c) => n + c.done, 0);
        progress.message = `知乎 · ${collection.title}`;
        progress.setChildren(children);
      });
      const one = await syncOneZhihuCollectionOpenApi(prisma, config, {
        secret: openApiSecret,
        collection,
        mode,
        maxItems: perCollection,
        maxUpsert: upsertBudget,
        fetchContent: opts.fetchContent,
        maxChars: opts.maxChars,
        progress: childTracker,
        shouldAbort,
      });
      result.scanned += one.scanned;
      result.created += one.created;
      result.updated += one.updated;
      if (upsertBudget != null) {
        upsertBudget = Math.max(0, upsertBudget - one.created - one.updated);
      }
      result.skipped += one.skipped;
      result.errors.push(...one.errors);
      result.items.push(...one.items);
      result.collectionsSynced = (result.collectionsSynced ?? 0) + 1;
      result.byCollection!.push({
        id: collection.id,
        title: collection.title,
        scanned: one.scanned,
        created: one.created,
        updated: one.updated,
        remoteCount: one.remoteCount,
        localCount: one.localCount,
        approxNew: one.approxNew,
        stoppedEarly: one.stoppedEarly,
      });
      child.total = Math.max(child.total, one.remoteCount ?? one.scanned, child.done);
      child.done = Math.max(child.done, one.created + one.updated);
      child.status = one.errors.length > 0 && child.done <= 0 ? "error" : "done";
      child.message = `新 ${one.created} · 更新 ${one.updated}`;
      progress.total = children.reduce((n, c) => n + c.total, 0);
      progress.done = children.reduce((n, c) => n + c.done, 0);
      progress.setChildren(children);
    }
    return result;
  }

  const cookies = loadCookies("zhihu");
  if (!cookies.length && !getPlatformStorageStatePath("zhihu")) {
    return {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [
        "未配置知乎开放平台 ZHIHU_ACCESS_SECRET，且未 platform_login(zhihu)。请任选其一：在 .env 配置 Access Secret，或 Chat 调用 platform_login。",
      ],
      items: [],
      mode,
      collectionsDiscovered: 0,
      collectionsSynced: 0,
      byCollection: [],
    };
  }

  const collections: ZhihuCollectionMeta[] = [];
  const errors: string[] = [];
  progress.setMessage("正在拉取收藏夹列表…");

  if (opts.collectionUrl?.trim()) {
    const id = extractZhihuCollectionId(opts.collectionUrl);
    if (!id) {
      return {
        scanned: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [`无法从 URL 解析收藏夹 id: ${opts.collectionUrl}`],
        items: [],
        mode,
      };
    }
    collections.push({
      id,
      title: `收藏夹 ${id}`,
      url: opts.collectionUrl.trim(),
    });
  } else {
    const discovered = await listZhihuMyCollections({ maxCollections });
    errors.push(...discovered.errors);
    collections.push(...discovered.collections);
  }

  const result: InboxSyncResult = {
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors,
    items: [],
    mode,
    collectionsDiscovered: collections.length,
    collectionsSynced: 0,
    byCollection: [],
  };

  if (!collections.length) {
    if (!result.errors.length) result.errors.push("没有可同步的收藏夹。");
    return result;
  }

  const children: InboxSyncProgressChild[] = collections.map((c) => ({
    id: c.id,
    label: c.title,
    total: 0,
    done: 0,
    status: "pending",
  }));
  progress.setMessage(`共 ${collections.length} 个收藏夹`);
  progress.setChildren(children);

  for (const collection of collections) {
    throwIfInboxSyncAborted(shouldAbort);
    const child = children.find((c) => c.id === collection.id)!;
    child.status = "running";
    child.message = "拉取中…";
    progress.setMessage(`知乎 · ${collection.title}`);
    progress.setChildren(children);
    const childTracker = new InboxSyncProgressTracker((p) => {
      child.total = p.total;
      child.done = p.done;
      if (p.message) child.message = p.message;
      progress.total = children.reduce((n, c) => n + c.total, 0);
      progress.done = children.reduce((n, c) => n + c.done, 0);
      progress.message = `知乎 · ${collection.title}`;
      progress.setChildren(children);
    });
    const one = await syncOneZhihuCollection(prisma, config, {
      collection,
      mode,
      maxItems: perCollection,
      fetchContent: opts.fetchContent,
      maxChars: opts.maxChars,
      progress: childTracker,
      shouldAbort,
    });
    result.scanned += one.scanned;
    result.created += one.created;
    result.updated += one.updated;
    result.skipped += one.skipped;
    result.errors.push(...one.errors);
    result.items.push(...one.items);
    result.collectionsSynced = (result.collectionsSynced ?? 0) + 1;
    result.byCollection!.push({
      id: collection.id,
      title: collection.title,
      scanned: one.scanned,
      created: one.created,
      updated: one.updated,
      remoteCount: one.remoteCount,
      localCount: one.localCount,
      approxNew: one.approxNew,
      stoppedEarly: one.stoppedEarly,
    });
    child.total = Math.max(child.total, one.remoteCount ?? one.scanned, child.done);
    child.done = Math.max(child.done, one.created + one.updated);
    child.status = one.errors.length > 0 && child.done <= 0 ? "error" : "done";
    child.message = `新 ${one.created} · 更新 ${one.updated}`;
    progress.total = children.reduce((n, c) => n + c.total, 0);
    progress.done = children.reduce((n, c) => n + c.done, 0);
    progress.setChildren(children);
  }

  return result;
}
