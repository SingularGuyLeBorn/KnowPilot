/**
 * 知识 Inbox 管道 — 截图 / 知乎收藏 / 小红书点赞与收藏 / B 站收藏夹与稍后再看 / 微信公众号链接
 *
 * 原始件落 data/inbox/；成文经 PostService（post_create）进 content/{garden}/。
 * 知乎优先走开放平台 Access Secret（favlists / favlist_contents）；无 key 时回退
 * platform_login 的 cookie / storageState + 站内 API。
 * B 站学 BiliNote：复用 platform_login(bilibili) 的 SESSDATA 调站内 API。
 */

import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { loadCookies, type CookieJarEntry } from "./cookieJar.js";
import { getPlatformStorageStatePath } from "./metablog/auth/platformLogin.js";
import { launchPlaywrightBrowser } from "./metablog/playwrightChrome.js";
import { parsePlatformUrl } from "./metablog/index.js";
import { performOcrFromFile } from "./ocrService.js";
import { detectPlatform } from "./metablog/platform/fetcher.js";
import {
  resolveZhihuAccessSecret,
  zhihuFavlistContents,
  zhihuUserFavlists,
} from "./zhihuOpenApi.js";

export type InboxSource = "screenshot" | "zhihu" | "xhs" | "wechat" | "bilibili" | "url";
export type BilibiliSyncMode = "full" | "incremental";
export type BilibiliSyncKind = "fav" | "toview";

export interface InboxUpsertInput {
  source: InboxSource;
  externalId: string;
  title: string;
  url?: string | null;
  excerpt?: string | null;
  contentPath?: string | null;
  content?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export type ZhihuSyncMode = "full" | "incremental";

export interface ZhihuCollectionMeta {
  id: string;
  title: string;
  url: string;
  /** 远端条目数（若 API 提供） */
  itemCount?: number;
}

export interface InboxSyncResult {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  items: Array<{ id: string; title: string; url?: string | null; created: boolean }>;
  /** 小红书 / B 站：按 kind 分别计数 */
  byKind?: Partial<
    Record<
      "liked" | "collect" | "fav" | "toview",
      { scanned: number; created: number; updated: number; stoppedEarly?: boolean }
    >
  >;
  /** 知乎：同步模式与分夹摘要 */
  mode?: ZhihuSyncMode;
  collectionsDiscovered?: number;
  collectionsSynced?: number;
  byCollection?: Array<{
    id: string;
    title: string;
    scanned: number;
    created: number;
    updated: number;
    remoteCount?: number;
    localCount?: number;
    approxNew?: number;
    stoppedEarly?: boolean;
  }>;
}

const ZHIHU_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type XhsSyncKind = "liked" | "collect";

const XHS_KIND_CFG: Record<
  XhsSyncKind,
  {
    tabQuery: string;
    tabLabels: string[];
    apiPattern: RegExp;
    tag: string;
    externalPrefix: string;
    label: string;
  }
> = {
  liked: {
    tabQuery: "tab=liked&subTab=note",
    tabLabels: ["点赞", "赞过"],
    apiPattern: /note\/like|like\/page|liked/i,
    tag: "like",
    externalPrefix: "like:",
    label: "点赞",
  },
  collect: {
    tabQuery: "tab=fav&subTab=note",
    tabLabels: ["收藏", "我的收藏"],
    apiPattern: /note\/collect|collect\/page|collected/i,
    tag: "favorite",
    externalPrefix: "fav:",
    label: "收藏",
  },
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".bmp"]);
const MAX_CONTENT_CHARS = 80_000;

export function getInboxRoot(config: AppConfig): string {
  return config.dataPaths.inbox;
}

export function ensureInboxDirs(config: AppConfig): {
  root: string;
  screenshots: string;
  drop: string;
  zhihu: string;
  xhs: string;
  bilibili: string;
  wechat: string;
  wechatLinks: string;
  raw: string;
} {
  const root = getInboxRoot(config);
  const screenshots = path.join(root, "screenshots");
  const drop = path.join(screenshots, "drop");
  const zhihu = path.join(root, "zhihu");
  const xhs = path.join(root, "xhs");
  const bilibili = path.join(root, "bilibili");
  const wechat = path.join(root, "wechat");
  const raw = path.join(root, "raw");
  for (const dir of [root, screenshots, drop, zhihu, xhs, bilibili, wechat, raw]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const wechatLinks = path.join(wechat, "links.txt");
  if (!fs.existsSync(wechatLinks)) {
    fs.writeFileSync(
      wechatLinks,
      "# 每行一个微信公众号文章链接（或任意 URL）\n# 同步后已处理的行会移到 links.done.txt\n",
      "utf-8",
    );
  }
  const readme = path.join(root, "README.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        "KnowPilot 知识 Inbox",
        "",
        "screenshots/drop/  — 把手机截图丢这里（或配置 inbox.screenshotWatchDir）",
        "wechat/links.txt   — 每行一个公众号/网页链接",
        "zhihu/ xhs/ bilibili/ raw/ — 同步落地的原文缓存",
        "",
        "在 /inbox 页或 Chat 里调用 inbox_* 工具同步与蒸馏。",
        "",
      ].join("\n"),
      "utf-8",
    );
  }
  return { root, screenshots, drop, zhihu, xhs, bilibili, wechat, wechatLinks, raw };
}

export function resolveScreenshotWatchDir(config: AppConfig): string {
  const configured = config.inbox.screenshotWatchDir?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(config.projectRoot, configured);
  }
  return path.join(getInboxRoot(config), "screenshots", "drop");
}

function cookiesToHeader(cookies: CookieJarEntry[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function truncate(text: string, max = MAX_CONTENT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[TRUNCATED original=${text.length}]`;
}

function hashExternalId(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 40);
}

function inferSourceFromUrl(url: string): InboxSource {
  try {
    const host = new URL(url).hostname;
    if (host.includes("zhihu.com")) return "zhihu";
    if (host.includes("xiaohongshu.com") || host.includes("xhslink.com")) return "xhs";
    if (host.includes("bilibili.com") || host.includes("b23.tv")) return "bilibili";
    if (host.includes("mp.weixin.qq.com")) return "wechat";
    const p = detectPlatform(host);
    if (p === "zhihu") return "zhihu";
    if (p === "xiaohongshu") return "xhs";
    if (p === "bilibili") return "bilibili";
    if (p === "wechat") return "wechat";
  } catch {
    /* ignore */
  }
  return "url";
}

export function extractZhihuCollectionId(collectionUrl: string): string | null {
  const m = collectionUrl.match(/\/collections?\/(\d+)/i);
  return m?.[1] ?? null;
}

/** 增量：本页有条目且零新增 → 提前停 */
export function shouldStopZhihuIncrementalPage(pageSeen: number, pageCreated: number): boolean {
  return pageSeen > 0 && pageCreated === 0;
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

export async function upsertInboxItem(
  prisma: PrismaClient,
  input: InboxUpsertInput,
): Promise<{ id: string; created: boolean; title: string; url?: string | null }> {
  const tags = (input.tags ?? []).join(",");
  const metadata = JSON.stringify(input.metadata ?? {});
  const existing = await prisma.inboxItem.findUnique({
    where: { source_externalId: { source: input.source, externalId: input.externalId } },
  });
  if (existing) {
    // 已蒸馏/忽略的条目不覆盖状态；仅刷新内容字段
    const data: Record<string, unknown> = {
      title: input.title || existing.title,
      url: input.url ?? existing.url,
      excerpt: input.excerpt ?? existing.excerpt,
      contentPath: input.contentPath ?? existing.contentPath,
      content: input.content ?? existing.content,
      tags: tags || existing.tags,
      metadata,
      capturedAt: new Date(),
    };
    const updated = await prisma.inboxItem.update({ where: { id: existing.id }, data });
    return { id: updated.id, created: false, title: updated.title, url: updated.url };
  }
  const created = await prisma.inboxItem.create({
    data: {
      source: input.source,
      externalId: input.externalId,
      title: input.title,
      url: input.url ?? null,
      excerpt: input.excerpt ?? null,
      contentPath: input.contentPath ?? null,
      content: input.content ?? null,
      tags,
      metadata,
      status: "fetched",
    },
  });
  return { id: created.id, created: true, title: created.title, url: created.url };
}

async function fetchArticleBody(
  url: string,
  maxChars: number,
): Promise<{ title: string; content: string; author?: string; platform?: string }> {
  const parsed = await parsePlatformUrl({
    url,
    timeout: 45000,
    method: "playwright",
    embedOcr: false,
  });
  const content = truncate(String(parsed.content ?? ""), maxChars);
  return {
    title: String(parsed.title || url).slice(0, 200),
    content,
    author: parsed.author ? String(parsed.author) : undefined,
    platform: parsed.platform ? String(parsed.platform) : undefined,
  };
}

export async function captureInboxUrl(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    url: string;
    source?: InboxSource;
    fetchContent?: boolean;
    maxChars?: number;
  },
): Promise<{ id: string; created: boolean; title: string; url: string }> {
  ensureInboxDirs(config);
  const url = opts.url.trim();
  const source = opts.source ?? inferSourceFromUrl(url);
  const maxChars = opts.maxChars ?? 12000;
  let title = url;
  let content: string | null = null;
  let excerpt: string | null = null;
  let contentPath: string | null = null;
  const metadata: Record<string, unknown> = { capturedFrom: "url" };

  if (opts.fetchContent !== false) {
    try {
      const body = await fetchArticleBody(url, maxChars);
      title = body.title;
      content = body.content;
      excerpt = body.content.slice(0, 280);
      metadata.author = body.author;
      metadata.platform = body.platform;
      const rawDir = path.join(getInboxRoot(config), "raw", source);
      fs.mkdirSync(rawDir, { recursive: true });
      const fileName = `${hashExternalId(url)}.md`;
      const abs = path.join(rawDir, fileName);
      fs.writeFileSync(
        abs,
        `---\ntitle: ${JSON.stringify(title)}\nurl: ${JSON.stringify(url)}\nsource: ${source}\n---\n\n${content}\n`,
        "utf-8",
      );
      contentPath = path.relative(config.projectRoot, abs).replace(/\\/g, "/");
    } catch (err) {
      metadata.fetchError = err instanceof Error ? err.message : String(err);
      title = `未能抓取正文 · ${url.slice(0, 80)}`;
    }
  }

  const result = await upsertInboxItem(prisma, {
    source,
    externalId: url,
    title,
    url,
    excerpt,
    content,
    contentPath,
    tags: [source],
    metadata,
  });
  return { ...result, url };
}

export async function captureInboxUrls(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    urls: string[];
    source?: InboxSource;
    fetchContent?: boolean;
    maxChars?: number;
  },
): Promise<InboxSyncResult> {
  const result: InboxSyncResult = { scanned: 0, created: 0, updated: 0, skipped: 0, errors: [], items: [] };
  for (const raw of opts.urls) {
    const url = raw.trim();
    if (!url || url.startsWith("#")) continue;
    result.scanned += 1;
    try {
      const item = await captureInboxUrl(prisma, config, {
        url,
        source: opts.source,
        fetchContent: opts.fetchContent,
        maxChars: opts.maxChars,
      });
      if (item.created) result.created += 1;
      else result.updated += 1;
      result.items.push(item);
    } catch (err) {
      result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped += 1;
    }
  }
  return result;
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
 * 同步单个收藏夹：分页拉取 + upsert；incremental 时整页无新增则提前停。
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

  const localCountBefore = await countLocalZhihuCollectionItems(prisma, opts.collection.id);
  const remoteCount = opts.collection.itemCount;
  const approxNew =
    typeof remoteCount === "number" ? Math.max(0, remoteCount - localCountBefore) : undefined;

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
      return upserted.created;
    } catch (err) {
      skipped += 1;
      errors.push(`${item.url}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  let apiOk = false;
  if (cookies.length) {
    try {
      let offset = 0;
      while (scanned < maxItems) {
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

        let pageCreated = 0;
        let pageSeen = 0;
        for (const item of parsed.items) {
          if (seen.has(item.url) || scanned >= maxItems) continue;
          seen.add(item.url);
          pageSeen += 1;
          const isNew = await upsertItem(item);
          if (isNew) pageCreated += 1;
        }

        if (mode === "incremental" && shouldStopZhihuIncrementalPage(pageSeen, pageCreated)) {
          stoppedEarly = true;
          break;
        }
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
    let streakKnown = 0;
    let pageCreated = 0;
    for (const item of fetched.items) {
      if (seen.has(item.url) || scanned >= maxItems) continue;
      seen.add(item.url);
      const isNew = await upsertItem(item);
      if (isNew) {
        pageCreated += 1;
        streakKnown = 0;
      } else {
        streakKnown += 1;
      }
      if (mode === "incremental" && localCountBefore > 0 && streakKnown >= pageSize) {
        stoppedEarly = true;
        break;
      }
    }
    if (mode === "incremental" && pageCreated === 0 && localCountBefore > 0 && scanned > 0) {
      stoppedEarly = true;
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
    fetchContent?: boolean;
    maxChars?: number;
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
  const pageSize = 20;
  const urlToken = Number(opts.collection.id);
  const localCountBefore = await countLocalZhihuCollectionItems(prisma, opts.collection.id);
  const resultItems: Array<{ id: string; title: string; url?: string | null; created: boolean }> =
    [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let scanned = 0;
  let stoppedEarly = false;
  let remoteCount: number | undefined;
  let offset: number | string = 0;

  while (scanned < opts.maxItems) {
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
    if (typeof page.data.Paging?.Totals === "number") remoteCount = page.data.Paging.Totals;
    const items = page.data.Items ?? [];
    if (!items.length) break;

    let pageCreated = 0;
    let pageSeen = 0;
    for (const row of items) {
      if (scanned >= opts.maxItems) break;
      const url = String(row.Url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      pageSeen += 1;
      scanned += 1;
      try {
        const title = String(row.Title || url).slice(0, 200);
        const excerpt = row.Summary ? String(row.Summary).slice(0, 500) : null;
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
          if (captured.created) {
            created += 1;
            pageCreated += 1;
          } else updated += 1;
          resultItems.push(captured);
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
          if (upserted.created) {
            created += 1;
            pageCreated += 1;
          } else updated += 1;
          resultItems.push(upserted);
        }
      } catch (err) {
        skipped += 1;
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (opts.mode === "incremental" && shouldStopZhihuIncrementalPage(pageSeen, pageCreated)) {
      stoppedEarly = true;
      break;
    }
    if (page.data.Paging?.IsEnd) break;
    const next = page.data.Paging?.NextOffset;
    if (next === undefined || next === null || String(next) === "") break;
    offset = next;
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
 * - mode=full 拉到护栏/末尾；mode=incremental（默认）整页无新增即停
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
    fetchContent?: boolean;
    maxChars?: number;
  },
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const mode: ZhihuSyncMode = opts.mode ?? "incremental";
  const perCollection =
    opts.maxItems ?? opts.maxItemsPerCollection ?? (opts.collectionUrl ? 50 : 5000);
  const maxCollections = opts.maxCollections ?? 50;

  const openApiSecret = await resolveZhihuAccessSecret(prisma);
  if (openApiSecret) {
    const errors: string[] = [];
    const collections: ZhihuCollectionMeta[] = [];

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

    for (const collection of collections) {
      const one = await syncOneZhihuCollectionOpenApi(prisma, config, {
        secret: openApiSecret,
        collection,
        mode,
        maxItems: perCollection,
        fetchContent: opts.fetchContent,
        maxChars: opts.maxChars,
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
        "未配置知乎开放平台 ZHIHU_ACCESS_SECRET，且未 platform_login(zhihu)。请任选其一：在 .env.local 配置 Access Secret，或 Chat 调用 platform_login。",
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

  for (const collection of collections) {
    const one = await syncOneZhihuCollection(prisma, config, {
      collection,
      mode,
      maxItems: perCollection,
      fetchContent: opts.fetchContent,
      maxChars: opts.maxChars,
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
  }

  return result;
}

type XhsNoteItem = {
  kind: XhsSyncKind;
  noteId: string;
  title: string;
  url: string;
  author?: string;
};

/** 解析小红书列表 API JSON（供单测与 syncXhsLibrary 共用） */
export function parseXhsNotesFromApiJson(
  json: unknown,
  kind: XhsSyncKind,
): Array<Omit<XhsNoteItem, "kind">> {
  const out: Array<Omit<XhsNoteItem, "kind">> = [];
  const root = json as {
    data?: {
      notes?: Array<{
        note_id?: string;
        id?: string;
        display_title?: string;
        title?: string;
        xsec_token?: string;
        user?: { nickname?: string };
        note_card?: {
          note_id?: string;
          display_title?: string;
          user?: { nickname?: string };
          xsec_token?: string;
        };
      }>;
    };
  };
  const rows = root?.data?.notes ?? [];
  for (const row of rows) {
    const card = row.note_card ?? row;
    const noteId = String(card.note_id || row.note_id || row.id || "");
    if (!noteId) continue;
    const title = String(
      card.display_title || row.display_title || row.title || `小红书笔记 ${noteId}`,
    ).slice(0, 200);
    const token = card.xsec_token || row.xsec_token;
    const url = token
      ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(token)}`
      : `https://www.xiaohongshu.com/explore/${noteId}`;
    out.push({
      noteId,
      title,
      url,
      author: card.user?.nickname || row.user?.nickname,
    });
  }
  void kind;
  return out;
}

export function xhsInboxExternalId(kind: XhsSyncKind, noteId: string): string {
  return `${XHS_KIND_CFG[kind].externalPrefix}${noteId}`;
}

export type XhsSyncMode = ZhihuSyncMode;

/** 增量：本批有条目且全是已入库 noteId → 提前停（对齐 MetaBlog pageNewCount===0） */
export function shouldStopXhsIncrementalBatch(
  batchSize: number,
  batchNewCount: number,
  hasLocalBaseline: boolean,
): boolean {
  return hasLocalBaseline && batchSize > 0 && batchNewCount === 0;
}

async function loadExistingXhsNoteIds(
  prisma: PrismaClient,
  kind: XhsSyncKind,
): Promise<Set<string>> {
  const prefix = XHS_KIND_CFG[kind].externalPrefix;
  const rows = await prisma.inboxItem.findMany({
    where: { source: "xhs", externalId: { startsWith: prefix } },
    select: { externalId: true },
  });
  return new Set(rows.map((r) => r.externalId.slice(prefix.length)));
}

/**
 * 小红书「点赞 + 收藏」：Playwright + storageState，拦截列表 API / DOM 兜底。
 * kinds 默认两者；mode=incremental（默认）遇已知 noteId 批次早停；full 滚到 maxItems。
 */
export async function syncXhsLibrary(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    kinds?: XhsSyncKind[];
    mode?: XhsSyncMode;
    maxItems?: number;
    fetchContent?: boolean;
    maxChars?: number;
  },
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const mode: XhsSyncMode = opts.mode ?? "incremental";
  const maxItems = opts.maxItems ?? (mode === "full" ? 2000 : 200);
  const kinds = (opts.kinds?.length ? opts.kinds : (["liked", "collect"] as XhsSyncKind[])).filter(
    (k): k is XhsSyncKind => k === "liked" || k === "collect",
  );
  const uniqueKinds = [...new Set(kinds)];
  const storageState = getPlatformStorageStatePath("xhs");
  const cookies = loadCookies("xhs");
  if (!storageState && !cookies.length) {
    return {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ["小红书未登录。请先在 Chat 调用 platform_login(platform=xhs) 扫码登录。"],
      items: [],
      mode,
      byKind: {},
    };
  }

  const notes: XhsNoteItem[] = [];
  const errors: string[] = [];
  const stoppedEarlyByKind: Partial<Record<XhsSyncKind, boolean>> = {};
  /** 当前正在采集的 kind（response 监听用） */
  let activeKind: XhsSyncKind | null = null;
  const existingByKind = new Map<XhsSyncKind, Set<string>>();
  for (const kind of uniqueKinds) {
    existingByKind.set(kind, await loadExistingXhsNoteIds(prisma, kind));
  }

  const { chromium } = await import("playwright");
  const browser = await launchPlaywrightBrowser(chromium, { headless: true });
  try {
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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

    context.on("response", async (response) => {
      try {
        if (!activeKind) return;
        if (stoppedEarlyByKind[activeKind]) return;
        const cfg = XHS_KIND_CFG[activeKind];
        const u = response.url();
        if (!cfg.apiPattern.test(u)) return;
        if (!response.ok()) return;
        const json = await response.json().catch(() => null);
        if (!json) return;
        const parsed = parseXhsNotesFromApiJson(json, activeKind);
        if (!parsed.length) return;
        const existing = existingByKind.get(activeKind) ?? new Set();
        let batchNew = 0;
        for (const n of parsed) {
          if (notes.filter((x) => x.kind === activeKind).length >= maxItems) break;
          if (notes.some((x) => x.kind === activeKind && x.noteId === n.noteId)) continue;
          if (!existing.has(n.noteId)) batchNew += 1;
          notes.push({ kind: activeKind, ...n });
        }
        if (
          mode === "incremental" &&
          shouldStopXhsIncrementalBatch(parsed.length, batchNew, existing.size > 0)
        ) {
          stoppedEarlyByKind[activeKind] = true;
        }
      } catch {
        /* ignore */
      }
    });

    const page = await context.newPage();
    await page.goto("https://www.xiaohongshu.com", { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));

    const profileHref = await page.evaluate(() => {
      const a =
        document.querySelector<HTMLAnchorElement>('a[href*="/user/profile/"]') ||
        document.querySelector<HTMLAnchorElement>('a[href*="user/profile"]');
      return a?.href || null;
    });
    if (!profileHref) {
      errors.push("未能定位小红书个人主页链接，请确认登录态有效后重试。");
    }
    const uid = profileHref?.match(/\/user\/profile\/([^/?#]+)/)?.[1] ?? null;

    const scrollRounds = mode === "full" ? 40 : 16;

    for (const kind of uniqueKinds) {
      activeKind = kind;
      const cfg = XHS_KIND_CFG[kind];
      const beforeCount = notes.filter((n) => n.kind === kind).length;
      const existing = existingByKind.get(kind) ?? new Set();

      if (uid) {
        await page.goto(`https://www.xiaohongshu.com/user/profile/${uid}?${cfg.tabQuery}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await new Promise((r) => setTimeout(r, 2000));
      } else if (profileHref) {
        await page.goto(profileHref, { waitUntil: "domcontentloaded", timeout: 60000 });
        await new Promise((r) => setTimeout(r, 1500));
      }

      const labels = cfg.tabLabels;
      await page.evaluate((tabLabels: string[]) => {
        const nodes = Array.from(document.querySelectorAll("a, span, div, button"));
        const target = nodes.find((el) => {
          const t = (el.textContent || "").trim();
          return tabLabels.some((l) => t === l || t.startsWith(l));
        });
        if (target instanceof HTMLElement) target.click();
      }, labels);
      await new Promise((r) => setTimeout(r, 1500));

      let stagnant = 0;
      for (
        let i = 0;
        i < scrollRounds &&
        notes.filter((n) => n.kind === kind).length < maxItems &&
        !stoppedEarlyByKind[kind];
        i++
      ) {
        const before = notes.filter((n) => n.kind === kind).length;
        await page.mouse.wheel(0, 1800);
        await new Promise((r) => setTimeout(r, 1100));
        const after = notes.filter((n) => n.kind === kind).length;
        if (after === before) stagnant += 1;
        else stagnant = 0;
        if (stagnant >= 3) break;
      }

      // DOM 兜底（API 未命中时）
      if (notes.filter((n) => n.kind === kind).length === beforeCount) {
        const fromDom = await page.evaluate(() => {
          const out: Array<{ noteId: string; title: string; url: string }> = [];
          for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/explore/"]'))) {
            const m = a.href.match(/\/explore\/([a-zA-Z0-9]+)/);
            if (!m) continue;
            const noteId = m[1]!;
            if (out.some((x) => x.noteId === noteId)) continue;
            const title = (a.getAttribute("title") || a.textContent || `笔记 ${noteId}`).trim().slice(0, 200);
            out.push({ noteId, title: title || `笔记 ${noteId}`, url: a.href.split("&")[0]! });
          }
          return out;
        });
        let batchNew = 0;
        for (const n of fromDom) {
          if (notes.filter((x) => x.kind === kind).length >= maxItems) break;
          if (notes.some((x) => x.kind === kind && x.noteId === n.noteId)) continue;
          if (!existing.has(n.noteId)) batchNew += 1;
          notes.push({ kind, ...n });
          // 列表按时间序：incremental 连续命中已知则截断后续
          if (
            mode === "incremental" &&
            existing.size > 0 &&
            existing.has(n.noteId) &&
            batchNew === 0 &&
            notes.filter((x) => x.kind === kind).length - beforeCount >= 8
          ) {
            // 前若干条全旧 → MetaBlog 同构早停
            const collected = notes.filter((x) => x.kind === kind).slice(beforeCount);
            const allOld = collected.every((x) => existing.has(x.noteId));
            if (allOld) {
              stoppedEarlyByKind[kind] = true;
              break;
            }
          }
        }
        if (
          mode === "incremental" &&
          fromDom.length > 5 &&
          shouldStopXhsIncrementalBatch(
            fromDom.length,
            fromDom.filter((n) => !existing.has(n.noteId)).length,
            existing.size > 0,
          )
        ) {
          stoppedEarlyByKind[kind] = true;
        }
      }

      if (notes.filter((n) => n.kind === kind).length === beforeCount) {
        errors.push(`未采集到「${cfg.label}」笔记。请确认登录后个人页该 Tab 有内容。`);
      }
    }

    activeKind = null;
    await context.close();
  } catch (err) {
    errors.push(`小红书同步失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close().catch(() => {});
  }

  // incremental：入库时再按序早停——只保留「碰到已知基线之前」的新条目 + 碰到的那一页已知（用于 update）
  const notesToUpsert: XhsNoteItem[] = [];
  for (const kind of uniqueKinds) {
    const existing = existingByKind.get(kind) ?? new Set();
    const kindNotes = notes.filter((n) => n.kind === kind);
    if (mode !== "incremental" || existing.size === 0) {
      notesToUpsert.push(...kindNotes);
      continue;
    }
    let hitKnownStreak = 0;
    for (const note of kindNotes) {
      notesToUpsert.push(note);
      if (existing.has(note.noteId)) {
        hitKnownStreak += 1;
        if (hitKnownStreak >= 5) {
          stoppedEarlyByKind[kind] = true;
          break;
        }
      } else {
        hitKnownStreak = 0;
      }
    }
  }

  const result: InboxSyncResult = {
    scanned: notesToUpsert.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors,
    items: [],
    mode,
    byKind: {},
  };

  for (const kind of uniqueKinds) {
    result.byKind![kind] = {
      scanned: 0,
      created: 0,
      updated: 0,
      stoppedEarly: Boolean(stoppedEarlyByKind[kind]),
    };
  }

  for (const note of notesToUpsert) {
    const cfg = XHS_KIND_CFG[note.kind];
    const bucket = result.byKind![note.kind]!;
    bucket.scanned += 1;
    try {
      const externalId = xhsInboxExternalId(note.kind, note.noteId);
      let title = note.title;
      let content: string | null = null;
      let excerpt: string | null = null;
      const metadata: Record<string, unknown> = {
        author: note.author,
        kind: note.kind,
        noteId: note.noteId,
      };
      if (opts.fetchContent) {
        try {
          const body = await fetchArticleBody(note.url, opts.maxChars ?? 12000);
          title = body.title || note.title;
          content = body.content;
          excerpt = body.content.slice(0, 280);
          metadata.platform = body.platform;
          if (body.author) metadata.author = body.author;
        } catch (err) {
          metadata.fetchError = err instanceof Error ? err.message : String(err);
        }
      }
      const upserted = await upsertInboxItem(prisma, {
        source: "xhs",
        externalId,
        title,
        url: note.url,
        excerpt,
        content,
        tags: ["xhs", cfg.tag],
        metadata,
      });
      if (upserted.created) {
        result.created += 1;
        bucket.created += 1;
      } else {
        result.updated += 1;
        bucket.updated += 1;
      }
      result.items.push(upserted);
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${note.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

const BILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type BilibiliVideoItem = {
  kind: BilibiliSyncKind;
  bvid: string;
  title: string;
  url: string;
  author?: string;
  intro?: string;
  mediaId?: string;
  folderTitle?: string;
};

/** externalId：fav:{mediaId}:{bvid} / toview:{bvid} */
export function bilibiliInboxExternalId(
  kind: BilibiliSyncKind,
  bvid: string,
  mediaId?: string,
): string {
  if (kind === "toview") return `toview:${bvid}`;
  return `fav:${mediaId ?? "0"}:${bvid}`;
}

export function shouldStopBilibiliIncrementalPage(pageSeen: number, pageCreated: number): boolean {
  return pageSeen > 0 && pageCreated === 0;
}

export function parseBilibiliFavFoldersJson(
  json: unknown,
): Array<{ id: string; title: string; mediaCount?: number }> {
  const root = json as {
    data?: { list?: Array<{ id?: number | string; title?: string; media_count?: number }> };
  };
  const out: Array<{ id: string; title: string; mediaCount?: number }> = [];
  for (const row of root?.data?.list ?? []) {
    const id = String(row.id ?? "");
    if (!/^\d+$/.test(id)) continue;
    out.push({
      id,
      title: String(row.title || `收藏夹 ${id}`).slice(0, 200),
      mediaCount: typeof row.media_count === "number" ? row.media_count : undefined,
    });
  }
  return out;
}

export function parseBilibiliFavMediasJson(json: unknown): {
  items: Array<{ bvid: string; title: string; author?: string; intro?: string }>;
  hasMore: boolean;
} {
  const root = json as {
    data?: {
      medias?: Array<{
        bvid?: string;
        title?: string;
        intro?: string;
        upper?: { name?: string };
      }> | null;
      has_more?: boolean;
    };
  };
  const items: Array<{ bvid: string; title: string; author?: string; intro?: string }> = [];
  for (const row of root?.data?.medias ?? []) {
    const bvid = String(row.bvid || "").trim();
    if (!/^BV[\w]+$/i.test(bvid)) continue;
    items.push({
      bvid,
      title: String(row.title || bvid).slice(0, 200),
      author: row.upper?.name,
      intro: row.intro ? String(row.intro).slice(0, 500) : undefined,
    });
  }
  return { items, hasMore: Boolean(root?.data?.has_more) };
}

export function parseBilibiliToviewJson(
  json: unknown,
): Array<{ bvid: string; title: string; author?: string; intro?: string }> {
  const root = json as {
    data?: {
      list?: Array<{
        bvid?: string;
        title?: string;
        desc?: string;
        owner?: { name?: string };
      }>;
    };
  };
  const items: Array<{ bvid: string; title: string; author?: string; intro?: string }> = [];
  for (const row of root?.data?.list ?? []) {
    const bvid = String(row.bvid || "").trim();
    if (!/^BV[\w]+$/i.test(bvid)) continue;
    items.push({
      bvid,
      title: String(row.title || bvid).slice(0, 200),
      author: row.owner?.name,
      intro: row.desc ? String(row.desc).slice(0, 500) : undefined,
    });
  }
  return items;
}

function loadBilibiliCookieHeader(): string | null {
  const cookies = loadCookies("bilibili");
  if (cookies.some((c) => c.name === "SESSDATA" && c.value)) {
    return cookiesToHeader(cookies);
  }
  const ssPath = getPlatformStorageStatePath("bilibili");
  if (!ssPath || !fs.existsSync(ssPath)) return null;
  try {
    const ss = JSON.parse(fs.readFileSync(ssPath, "utf-8")) as {
      cookies?: Array<{ name?: string; value?: string }>;
    };
    const list = ss.cookies ?? [];
    if (!list.some((c) => c.name === "SESSDATA" && c.value)) return null;
    return list
      .filter((c) => c.name && c.value)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    return null;
  }
}

async function bilibiliFetchJson(url: string, cookieHeader: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      Referer: "https://www.bilibili.com/",
      "User-Agent": BILI_UA,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`B站 API HTTP ${res.status}: ${url}`);
  }
  const json = (await res.json()) as { code?: number; message?: string };
  if (typeof json.code === "number" && json.code !== 0) {
    throw new Error(`B站 API code=${json.code}: ${json.message || "未知错误"}`);
  }
  return json;
}

async function fetchBilibiliTranscriptForInbox(
  bvid: string,
  cookieHeader: string,
  maxChars: number,
): Promise<{ content: string | null; excerpt: string | null; summary?: string }> {
  const { fetchBilibiliPagelistCid, fetchBilibiliSubtitleExcerpt, fetchBilibiliAiConclusion } =
    await import("./metablog/platform/fetcher.js");
  const cid = await fetchBilibiliPagelistCid(bvid, 12000, cookieHeader);
  if (!cid) return { content: null, excerpt: null };
  const [transcript, summary] = await Promise.all([
    fetchBilibiliSubtitleExcerpt(bvid, cid, 12000, maxChars, cookieHeader),
    fetchBilibiliAiConclusion(bvid, 12000, 2000, cookieHeader),
  ]);
  const parts: string[] = [];
  if (summary) parts.push(`## AI 总结\n\n${summary}`);
  if (transcript) parts.push(`## 字幕\n\n${transcript}`);
  if (!parts.length) return { content: null, excerpt: null, summary: summary || undefined };
  const content = truncate(parts.join("\n\n"), maxChars);
  return {
    content,
    excerpt: (summary || transcript).slice(0, 280),
    summary: summary || undefined,
  };
}

/**
 * B 站「我创建的收藏夹 + 稍后再看」：SESSDATA 调站内 API（对齐 BiliNote 登录态思路）。
 * kinds 默认两者；mode=incremental 遇整页无新增早停；full 拉到 maxItems。
 */
export async function syncBilibiliLibrary(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    kinds?: BilibiliSyncKind[];
    mode?: BilibiliSyncMode;
    maxItems?: number;
    maxFolders?: number;
    fetchContent?: boolean;
    maxChars?: number;
  },
): Promise<InboxSyncResult> {
  const dirs = ensureInboxDirs(config);
  const mode: BilibiliSyncMode = opts.mode ?? "incremental";
  const maxItems = opts.maxItems ?? (mode === "full" ? 2000 : 200);
  const maxFolders = opts.maxFolders ?? 50;
  const kinds = (
    opts.kinds?.length ? opts.kinds : (["fav", "toview"] as BilibiliSyncKind[])
  ).filter((k): k is BilibiliSyncKind => k === "fav" || k === "toview");
  const uniqueKinds = [...new Set(kinds)];

  const cookieHeader = loadBilibiliCookieHeader();
  if (!cookieHeader) {
    return {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ["B站未登录。请先在 Chat 调用 platform_login(platform=bilibili) 扫码登录。"],
      items: [],
      mode,
      byKind: {},
    };
  }

  const result: InboxSyncResult = {
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    items: [],
    mode,
    byKind: {},
    byCollection: [],
  };
  for (const kind of uniqueKinds) {
    result.byKind![kind] = { scanned: 0, created: 0, updated: 0 };
  }

  let mid: number | null = null;
  try {
    const nav = (await bilibiliFetchJson(
      "https://api.bilibili.com/x/web-interface/nav",
      cookieHeader,
    )) as { data?: { isLogin?: boolean; mid?: number; uname?: string } };
    if (!nav.data?.isLogin || !nav.data.mid) {
      result.errors.push("B站登录态失效（nav.isLogin=false）。请重新 platform_login(bilibili)。");
      return result;
    }
    mid = nav.data.mid;
  } catch (err) {
    result.errors.push(`B站 nav 失败: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const videos: BilibiliVideoItem[] = [];
  const stoppedEarlyByKind: Partial<Record<BilibiliSyncKind, boolean>> = {};

  if (uniqueKinds.includes("fav") && mid != null) {
    try {
      const foldersJson = await bilibiliFetchJson(
        `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`,
        cookieHeader,
      );
      try {
        fs.writeFileSync(
          path.join(dirs.bilibili, `folders-${mid}.json`),
          JSON.stringify(foldersJson, null, 2),
          "utf-8",
        );
      } catch {
        /* ignore */
      }
      const folders = parseBilibiliFavFoldersJson(foldersJson).slice(0, maxFolders);
      result.collectionsDiscovered = folders.length;
      let syncedFolders = 0;

      for (const folder of folders) {
        const existing = await prisma.inboxItem.findMany({
          where: {
            source: "bilibili",
            externalId: { startsWith: `fav:${folder.id}:` },
          },
          select: { externalId: true },
        });
        const existingBvids = new Set(
          existing.map((r) => r.externalId.replace(`fav:${folder.id}:`, "")),
        );
        let folderScanned = 0;
        let stoppedEarly = false;
        let pn = 1;
        const ps = 20;

        while (folderScanned < maxItems) {
          const pageJson = await bilibiliFetchJson(
            `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folder.id}&pn=${pn}&ps=${ps}&order=mtime`,
            cookieHeader,
          );
          const { items, hasMore } = parseBilibiliFavMediasJson(pageJson);
          if (!items.length) break;

          let pageNew = 0;
          for (const item of items) {
            if (folderScanned >= maxItems) break;
            const isNew = !existingBvids.has(item.bvid);
            if (isNew) pageNew += 1;
            videos.push({
              kind: "fav",
              bvid: item.bvid,
              title: item.title,
              url: `https://www.bilibili.com/video/${item.bvid}`,
              author: item.author,
              intro: item.intro,
              mediaId: folder.id,
              folderTitle: folder.title,
            });
            folderScanned += 1;
          }

          if (mode === "incremental" && existingBvids.size > 0 && shouldStopBilibiliIncrementalPage(items.length, pageNew)) {
            stoppedEarly = true;
            stoppedEarlyByKind.fav = true;
            break;
          }
          if (!hasMore) break;
          pn += 1;
        }

        syncedFolders += 1;
        result.byCollection!.push({
          id: folder.id,
          title: folder.title,
          scanned: folderScanned,
          created: 0,
          updated: 0,
          remoteCount: folder.mediaCount,
          localCount: existingBvids.size,
          approxNew: Math.max(0, (folder.mediaCount ?? 0) - existingBvids.size),
          stoppedEarly,
        });
      }
      result.collectionsSynced = syncedFolders;
    } catch (err) {
      result.errors.push(`B站收藏夹同步失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (uniqueKinds.includes("toview")) {
    try {
      const existing = await prisma.inboxItem.findMany({
        where: { source: "bilibili", externalId: { startsWith: "toview:" } },
        select: { externalId: true },
      });
      const existingBvids = new Set(existing.map((r) => r.externalId.slice("toview:".length)));
      const toviewJson = await bilibiliFetchJson(
        "https://api.bilibili.com/x/v2/history/toview",
        cookieHeader,
      );
      try {
        fs.writeFileSync(
          path.join(dirs.bilibili, "toview.json"),
          JSON.stringify(toviewJson, null, 2),
          "utf-8",
        );
      } catch {
        /* ignore */
      }
      const list = parseBilibiliToviewJson(toviewJson);
      let pageNew = 0;
      let taken = 0;
      for (const item of list) {
        if (taken >= maxItems) break;
        const isNew = !existingBvids.has(item.bvid);
        if (mode === "incremental" && existingBvids.size > 0 && !isNew && pageNew === 0 && taken >= 5) {
          // 列表按加入时间：连续已知且尚无新增 → 早停
          stoppedEarlyByKind.toview = true;
          break;
        }
        if (isNew) pageNew += 1;
        videos.push({
          kind: "toview",
          bvid: item.bvid,
          title: item.title,
          url: `https://www.bilibili.com/video/${item.bvid}`,
          author: item.author,
          intro: item.intro,
        });
        taken += 1;
      }
      if (
        mode === "incremental" &&
        existingBvids.size > 0 &&
        shouldStopBilibiliIncrementalPage(Math.min(list.length, maxItems), pageNew)
      ) {
        stoppedEarlyByKind.toview = true;
      }
    } catch (err) {
      result.errors.push(`B站稍后再看同步失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 去重（同 kind+bvid+mediaId）
  const seen = new Set<string>();
  const uniqueVideos: BilibiliVideoItem[] = [];
  for (const v of videos) {
    const key = bilibiliInboxExternalId(v.kind, v.bvid, v.mediaId);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueVideos.push(v);
  }

  for (const video of uniqueVideos) {
    const bucket = result.byKind![video.kind]!;
    bucket.scanned += 1;
    result.scanned += 1;
    try {
      const externalId = bilibiliInboxExternalId(video.kind, video.bvid, video.mediaId);
      let title = video.title;
      let content: string | null = null;
      let excerpt: string | null = video.intro?.slice(0, 280) ?? null;
      const metadata: Record<string, unknown> = {
        kind: video.kind,
        bvid: video.bvid,
        author: video.author,
      };
      if (video.mediaId) {
        metadata.collectionId = video.mediaId;
        metadata.collectionTitle = video.folderTitle;
      }
      if (opts.fetchContent) {
        try {
          const body = await fetchBilibiliTranscriptForInbox(
            video.bvid,
            cookieHeader,
            opts.maxChars ?? 12000,
          );
          content = body.content;
          if (body.excerpt) excerpt = body.excerpt;
          if (body.summary) metadata.aiSummary = body.summary;
          metadata.via = "bilibili_subtitle";
        } catch (err) {
          metadata.fetchError = err instanceof Error ? err.message : String(err);
        }
      }
      const tags =
        video.kind === "toview"
          ? ["bilibili", "toview"]
          : ["bilibili", "favorite"];
      const upserted = await upsertInboxItem(prisma, {
        source: "bilibili",
        externalId,
        title,
        url: video.url,
        excerpt,
        content,
        tags,
        metadata,
      });
      if (upserted.created) {
        result.created += 1;
        bucket.created += 1;
      } else {
        result.updated += 1;
        bucket.updated += 1;
      }
      if (video.kind === "fav" && video.mediaId && result.byCollection) {
        const col = result.byCollection.find((c) => c.id === video.mediaId);
        if (col) {
          if (upserted.created) col.created += 1;
          else col.updated += 1;
        }
      }
      result.items.push(upserted);
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${video.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.byKind?.fav) result.byKind.fav.stoppedEarly = Boolean(stoppedEarlyByKind.fav);
  if (result.byKind?.toview) result.byKind.toview.stoppedEarly = Boolean(stoppedEarlyByKind.toview);

  return result;
}


export async function ingestWechatDropFile(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    fetchContent?: boolean;
    maxChars?: number;
    maxUrls?: number;
  } = {},
): Promise<InboxSyncResult> {
  const { wechatLinks, wechat } = ensureInboxDirs(config);
  const raw = fs.readFileSync(wechatLinks, "utf-8");
  const lines = raw.split(/\r?\n/);
  const urls: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      kept.push(line);
      continue;
    }
    const m = t.match(/https?:\/\/[^\s]+/i);
    if (m) urls.push(m[0].replace(/[),.;]+$/, ""));
    else kept.push(line);
  }

  const maxUrls = opts.maxUrls ?? 50;
  const batch = urls.slice(0, maxUrls);
  const result = await captureInboxUrls(prisma, config, {
    urls: batch,
    source: "wechat",
    fetchContent: opts.fetchContent !== false,
    maxChars: opts.maxChars,
  });

  // 已处理 URL 归档
  if (batch.length) {
    const donePath = path.join(wechat, "links.done.txt");
    const stamp = new Date().toISOString();
    fs.appendFileSync(donePath, `\n# ${stamp}\n${batch.join("\n")}\n`, "utf-8");
  }
  const remaining = urls.slice(maxUrls);
  const next = [
    "# 每行一个微信公众号文章链接（或任意 URL）",
    "# 同步后已处理的行会移到 links.done.txt",
    ...kept.filter((l) => l.trim().startsWith("#") || !l.trim()),
    ...remaining,
    "",
  ].join("\n");
  fs.writeFileSync(wechatLinks, next, "utf-8");
  return result;
}

export async function scanScreenshotDrop(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    dir?: string;
    maxFiles?: number;
    runOcr?: boolean;
  } = {},
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const dir = opts.dir?.trim()
    ? path.isAbsolute(opts.dir)
      ? opts.dir
      : path.join(config.projectRoot, opts.dir)
    : resolveScreenshotWatchDir(config);
  fs.mkdirSync(dir, { recursive: true });
  const maxFiles = opts.maxFiles ?? 50;
  const runOcr = opts.runOcr !== false;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [`无法读取截图目录 ${dir}: ${err instanceof Error ? err.message : String(err)}`],
      items: [],
    };
  }

  const files = entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const abs = path.join(dir, e.name);
      const st = fs.statSync(abs);
      return { abs, name: e.name, mtime: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxFiles);

  const archiveDir = path.join(getInboxRoot(config), "screenshots", "archived");
  fs.mkdirSync(archiveDir, { recursive: true });

  const result: InboxSyncResult = {
    scanned: files.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    items: [],
  };

  for (const file of files) {
    try {
      const buf = fs.readFileSync(file.abs);
      const externalId = crypto.createHash("sha1").update(buf).digest("hex");
      const destName = `${externalId}${path.extname(file.name).toLowerCase()}`;
      const destAbs = path.join(archiveDir, destName);
      if (!fs.existsSync(destAbs)) {
        fs.copyFileSync(file.abs, destAbs);
      }
      const contentPath = path.relative(config.projectRoot, destAbs).replace(/\\/g, "/");

      let content: string | null = null;
      let excerpt: string | null = null;
      let title = `截图 ${file.name}`;
      const metadata: Record<string, unknown> = {
        originalName: file.name,
        size: file.size,
        mtime: new Date(file.mtime).toISOString(),
        watchDir: dir,
      };

      if (runOcr) {
        const ocr = await performOcrFromFile(config, destAbs, "auto");
        if (ocr.success && ocr.text) {
          content = truncate(ocr.text, 20000);
          excerpt = ocr.text.slice(0, 280);
          const firstLine = ocr.text.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
          if (firstLine) title = firstLine.slice(0, 80);
          metadata.ocrEngine = ocr.engine;
        } else {
          metadata.ocrError = ocr.error || "OCR 无结果";
        }
      }

      const upserted = await upsertInboxItem(prisma, {
        source: "screenshot",
        externalId,
        title,
        excerpt,
        content,
        contentPath,
        tags: ["screenshot"],
        metadata,
      });
      if (upserted.created) result.created += 1;
      else result.updated += 1;
      result.items.push(upserted);

      // 成功入库后从 drop 移除原文件（已归档副本）
      if (path.resolve(file.abs).startsWith(path.resolve(path.join(getInboxRoot(config), "screenshots", "drop")))) {
        fs.unlinkSync(file.abs);
      }
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

export function formatInboxItemBody(item: {
  title: string;
  url?: string | null;
  source: string;
  content?: string | null;
  excerpt?: string | null;
  contentPath?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): string {
  const lines = [
    `# ${item.title}`,
    "",
    `- 来源: ${item.source}`,
    item.url ? `- 原文: ${item.url}` : null,
    item.contentPath ? `- 本地文件: ${item.contentPath}` : null,
    item.tags?.length ? `- 标签: ${item.tags.join(", ")}` : null,
    "",
    "## 内容",
    "",
    item.content || item.excerpt || "（无正文，请打开原文或本地文件查看）",
    "",
  ];
  return lines.filter((x) => x !== null).join("\n");
}
