/**
 * 知识 Inbox 管道 — 截图 / 知乎收藏 / 小红书收藏 / 微信公众号链接
 *
 * 原始件落 data/inbox/；成文经 PostService（post_create）进 content/{garden}/。
 * 平台私有收藏无官方 OAuth：复用 platform_login 的 cookie / storageState。
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

export type InboxSource = "screenshot" | "zhihu" | "xhs" | "wechat" | "url";

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

export interface InboxSyncResult {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  items: Array<{ id: string; title: string; url?: string | null; created: boolean }>;
}

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
  wechat: string;
  wechatLinks: string;
  raw: string;
} {
  const root = getInboxRoot(config);
  const screenshots = path.join(root, "screenshots");
  const drop = path.join(screenshots, "drop");
  const zhihu = path.join(root, "zhihu");
  const xhs = path.join(root, "xhs");
  const wechat = path.join(root, "wechat");
  const raw = path.join(root, "raw");
  for (const dir of [root, screenshots, drop, zhihu, xhs, wechat, raw]) {
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
        "zhihu/ xhs/ raw/   — 同步落地的原文缓存",
        "",
        "在 /inbox 页或 Chat 里调用 inbox_* 工具同步与蒸馏。",
        "",
      ].join("\n"),
      "utf-8",
    );
  }
  return { root, screenshots, drop, zhihu, xhs, wechat, wechatLinks, raw };
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
    if (host.includes("mp.weixin.qq.com")) return "wechat";
    const p = detectPlatform(host);
    if (p === "zhihu") return "zhihu";
    if (p === "xiaohongshu") return "xhs";
    if (p === "wechat") return "wechat";
  } catch {
    /* ignore */
  }
  return "url";
}

function extractZhihuCollectionId(collectionUrl: string): string | null {
  const m = collectionUrl.match(/\/collections?\/(\d+)/i);
  return m?.[1] ?? null;
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

/** 知乎收藏夹：优先官方 Web API + cookie；失败再 Playwright 列表页 */
export async function syncZhihuCollection(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    collectionUrl: string;
    maxItems?: number;
    fetchContent?: boolean;
    maxChars?: number;
  },
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const maxItems = opts.maxItems ?? 50;
  const collectionId = extractZhihuCollectionId(opts.collectionUrl);
  if (!collectionId) {
    return {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [`无法从 URL 解析收藏夹 id: ${opts.collectionUrl}`],
      items: [],
    };
  }

  const cookies = loadCookies("zhihu");
  if (!cookies.length && !getPlatformStorageStatePath("zhihu")) {
    return {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ["知乎未登录。请先在 Chat 调用 platform_login(platform=zhihu) 扫码登录。"],
      items: [],
    };
  }

  type ListItem = { title: string; url: string; excerpt?: string; author?: string };
  const list: ListItem[] = [];
  const errors: string[] = [];

  try {
    let offset = 0;
    const limit = 20;
    while (list.length < maxItems) {
      const apiUrl = `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=${offset}&limit=${limit}`;
      const res = await fetch(apiUrl, {
        headers: {
          Cookie: cookiesToHeader(cookies),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Referer: opts.collectionUrl,
        },
      });
      if (!res.ok) {
        errors.push(`知乎 API ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));
        break;
      }
      const data = (await res.json()) as {
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
      const batch = data.data ?? [];
      if (!batch.length) break;
      for (const row of batch) {
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
        list.push({
          title: String(title).slice(0, 200),
          url,
          excerpt: c.excerpt ? String(c.excerpt).slice(0, 280) : undefined,
          author: c.author?.name,
        });
        if (list.length >= maxItems) break;
      }
      if (data.paging?.is_end) break;
      offset += limit;
    }
  } catch (err) {
    errors.push(`知乎 API 失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // API 空结果时降级 Playwright + 现有收藏夹解析
  if (list.length === 0) {
    try {
      const parsed = await parsePlatformUrl({
        url: opts.collectionUrl,
        timeout: 60000,
        method: "playwright",
        platform: "ZhihuCollection",
        embedOcr: false,
      });
      const md = String(parsed.content ?? "");
      const blockRe = /## (.+)\n(?:- 作者: (.+)\n)?- 链接: (.+)\n(?:- 摘要: (.+)\n)?/g;
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(md)) !== null && list.length < maxItems) {
        list.push({
          title: m[1].trim(),
          author: m[2]?.trim(),
          url: m[3].trim(),
          excerpt: m[4]?.trim(),
        });
      }
      if (list.length === 0) {
        errors.push("收藏夹解析为空：请确认已登录且收藏夹可访问。");
      }
    } catch (err) {
      errors.push(`Playwright 降级失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const result: InboxSyncResult = {
    scanned: list.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors,
    items: [],
  };

  for (const item of list.slice(0, maxItems)) {
    try {
      if (opts.fetchContent) {
        const captured = await captureInboxUrl(prisma, config, {
          url: item.url,
          source: "zhihu",
          fetchContent: true,
          maxChars: opts.maxChars,
        });
        if (captured.created) result.created += 1;
        else result.updated += 1;
        result.items.push(captured);
      } else {
        const upserted = await upsertInboxItem(prisma, {
          source: "zhihu",
          externalId: item.url,
          title: item.title,
          url: item.url,
          excerpt: item.excerpt ?? null,
          tags: ["zhihu", "collection"],
          metadata: { collectionUrl: opts.collectionUrl, author: item.author },
        });
        if (upserted.created) result.created += 1;
        else result.updated += 1;
        result.items.push(upserted);
      }
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${item.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

/** 小红书「我的收藏」：Playwright + storageState，拦截收藏分页 API */
export async function syncXhsFavorites(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    maxItems?: number;
    fetchContent?: boolean;
    maxChars?: number;
  },
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const maxItems = opts.maxItems ?? 50;
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
    };
  }

  type NoteItem = { noteId: string; title: string; url: string; author?: string };
  const notes: NoteItem[] = [];
  const errors: string[] = [];

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
        const u = response.url();
        if (!/note\/collect|collect\/page|collected/i.test(u)) return;
        if (!response.ok()) return;
        const json = (await response.json().catch(() => null)) as {
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
            cursor?: string;
          };
        } | null;
        const rows = json?.data?.notes ?? [];
        for (const row of rows) {
          const card = row.note_card ?? row;
          const noteId = String(card.note_id || row.note_id || row.id || "");
          if (!noteId || notes.some((n) => n.noteId === noteId)) continue;
          const title = String(card.display_title || row.display_title || row.title || `小红书笔记 ${noteId}`).slice(
            0,
            200,
          );
          const token = card.xsec_token || row.xsec_token;
          const url = token
            ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(token)}`
            : `https://www.xiaohongshu.com/explore/${noteId}`;
          notes.push({
            noteId,
            title,
            url,
            author: card.user?.nickname || row.user?.nickname,
          });
        }
      } catch {
        /* ignore parse errors */
      }
    });

    const page = await context.newPage();
    await page.goto("https://www.xiaohongshu.com", { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 尝试进入个人页 → 收藏 Tab
    const profileHref = await page.evaluate(() => {
      const a =
        document.querySelector<HTMLAnchorElement>('a[href*="/user/profile/"]') ||
        document.querySelector<HTMLAnchorElement>('a[href*="user/profile"]');
      return a?.href || null;
    });
    if (profileHref) {
      await page.goto(profileHref, { waitUntil: "domcontentloaded", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1500));
      // 点击「收藏」
      const collectClicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("a, span, div, button"));
        const target = nodes.find((el) => /^(收藏|我的收藏)$/.test((el.textContent || "").trim()));
        if (target instanceof HTMLElement) {
          target.click();
          return true;
        }
        return false;
      });
      if (!collectClicked) {
        // URL 猜：部分版本用 channel_type / tab
        const uid = profileHref.match(/\/user\/profile\/([^/?#]+)/)?.[1];
        if (uid) {
          await page.goto(`https://www.xiaohongshu.com/user/profile/${uid}?channel_type=collect`, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        }
      }
    } else {
      errors.push("未能定位小红书个人主页链接，请确认登录态有效后重试。");
    }

    // 滚动加载
    for (let i = 0; i < 12 && notes.length < maxItems; i++) {
      await page.mouse.wheel(0, 1800);
      await new Promise((r) => setTimeout(r, 1200));
    }

    // DOM 兜底扫卡片
    if (notes.length === 0) {
      const fromDom = await page.evaluate(() => {
        const out: Array<{ noteId: string; title: string; url: string }> = [];
        for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/explore/"]'))) {
          const m = a.href.match(/\/explore\/([a-zA-Z0-9]+)/);
          if (!m) continue;
          const noteId = m[1];
          if (out.some((x) => x.noteId === noteId)) continue;
          const title = (a.getAttribute("title") || a.textContent || `笔记 ${noteId}`).trim().slice(0, 200);
          out.push({ noteId, title: title || `笔记 ${noteId}`, url: a.href.split("&")[0] });
        }
        return out;
      });
      for (const n of fromDom) {
        if (notes.length >= maxItems) break;
        if (!notes.some((x) => x.noteId === n.noteId)) notes.push(n);
      }
    }

    await context.close();
  } catch (err) {
    errors.push(`小红书同步失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close().catch(() => {});
  }

  const result: InboxSyncResult = {
    scanned: Math.min(notes.length, maxItems),
    created: 0,
    updated: 0,
    skipped: 0,
    errors,
    items: [],
  };

  for (const note of notes.slice(0, maxItems)) {
    try {
      if (opts.fetchContent) {
        const captured = await captureInboxUrl(prisma, config, {
          url: note.url,
          source: "xhs",
          fetchContent: true,
          maxChars: opts.maxChars,
        });
        if (captured.created) result.created += 1;
        else result.updated += 1;
        result.items.push(captured);
      } else {
        const upserted = await upsertInboxItem(prisma, {
          source: "xhs",
          externalId: note.noteId,
          title: note.title,
          url: note.url,
          tags: ["xhs", "favorite"],
          metadata: { author: note.author },
        });
        if (upserted.created) result.created += 1;
        else result.updated += 1;
        result.items.push(upserted);
      }
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${note.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.scanned === 0 && result.errors.length === 0) {
    result.errors.push("未采集到收藏笔记。请确认登录后个人页「收藏」Tab 有内容。");
  }
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
