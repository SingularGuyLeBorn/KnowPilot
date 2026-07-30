/**
 * Inbox 管道 — 共享类型、目录、upsert、抓取与进度
 */

import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import type { CookieJarEntry } from "../cookieJar.js";
import { parsePlatformUrl } from "../metablog/index.js";
import { detectPlatform } from "../metablog/platform/fetcher.js";

export type InboxSource = "screenshot" | "zhihu" | "xhs" | "wechat" | "bilibili" | "url";
export type BilibiliSyncMode = "full" | "incremental";
export type BilibiliSyncKind = "fav" | "toview";

/** 用户停止平台同步时抛出；job 层捕获取消，勿当业务失败 */
export class InboxSyncAbortedError extends Error {
  constructor(message = "用户已停止同步") {
    super(message);
    this.name = "InboxSyncAbortedError";
  }
}

export function throwIfInboxSyncAborted(shouldAbort?: () => boolean): void {
  if (shouldAbort?.()) throw new InboxSyncAbortedError();
}

export function isInboxSyncAbortedError(err: unknown): boolean {
  return (
    err instanceof InboxSyncAbortedError ||
    (err instanceof Error && err.name === "InboxSyncAbortedError")
  );
}

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
  /** 原平台发布时间 */
  sourceAt?: Date | string | null;
}

/** CSV tags 精确 token 匹配（避免 fav⊂favorite 这类 contains 误伤） */
export function csvTagWhere(tag: string): {
  OR: Array<Record<string, unknown>>;
} {
  const t = tag.trim();
  return {
    OR: [
      { tags: t },
      { tags: { startsWith: `${t},` } },
      { tags: { endsWith: `,${t}` } },
      { tags: { contains: `,${t},` } },
    ],
  };
}

function coerceSourceAt(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 1e11) return new Date(n); // ms
  if (Number.isFinite(n) && n > 1e9) return new Date(n * 1000); // sec
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

/** 子步骤（知乎按收藏夹） */
export type InboxSyncProgressChild = {
  id: string;
  label: string;
  total: number;
  done: number;
  status?: "pending" | "running" | "done" | "error";
  message?: string;
};

/** 条目级进度：list 定 total，每成功 upsert 一次 done+1 */
export type InboxSyncProgress = {
  total: number;
  done: number;
  /** 步骤文案（如等待扫码）；可选 */
  message?: string;
  /** 知乎等：按收藏夹拆开的子进度 */
  children?: InboxSyncProgressChild[];
  /** 最近活动行（新在前），供进度 UI 列表 */
  recent?: string[];
};

export type InboxSyncProgressFn = (p: InboxSyncProgress) => void;

const PROGRESS_RECENT_MAX = 60;

export function emitInboxSyncProgress(
  onProgress: InboxSyncProgressFn | undefined,
  total: number,
  done: number,
  message?: string,
  children?: InboxSyncProgressChild[],
  recent?: string[],
): void {
  if (!onProgress) return;
  const t = Math.max(0, total);
  const d = Math.max(0, done);
  onProgress({
    total: Math.max(t, d),
    done: d,
    ...(message ? { message } : {}),
    ...(children ? { children } : {}),
    ...(recent && recent.length ? { recent } : {}),
  });
}

/** 可变进度计数器：list 定 total，成功 upsert 调 success() */
export class InboxSyncProgressTracker {
  total = 0;
  done = 0;
  message?: string;
  children?: InboxSyncProgressChild[];
  recent: string[] = [];
  constructor(private readonly onProgress?: InboxSyncProgressFn) {}
  setTotal(n: number): void {
    this.total = Math.max(0, n);
    this.emit();
  }
  addTotal(n: number): void {
    if (n <= 0) return;
    this.total += n;
    this.emit();
  }
  /** 直接设定 done/total（多阶段任务，如列表落盘 → feed 补拉） */
  setProgress(done: number, total: number, message?: string): void {
    this.total = Math.max(0, total);
    this.done = Math.max(0, Math.min(done, this.total > 0 ? this.total : done));
    if (message != null) this.message = message;
    this.emit();
  }
  setMessage(message: string): void {
    this.message = message;
    this.emit();
  }
  /** 追加一条列表行（新在前）；连续重复不叠 */
  pushRecent(line: string): void {
    const t = line.replace(/\s+/g, " ").trim();
    if (!t) return;
    if (this.recent[0] === t) {
      this.message = t;
      this.emit();
      return;
    }
    this.recent = [t, ...this.recent].slice(0, PROGRESS_RECENT_MAX);
    this.message = t;
    this.emit();
  }
  setChildren(children: InboxSyncProgressChild[]): void {
    this.children = children.map((c) => ({ ...c }));
    this.emit();
  }
  success(): void {
    this.done += 1;
    if (this.done > this.total) this.total = this.done;
    this.emit();
  }
  private emit(): void {
    emitInboxSyncProgress(
      this.onProgress,
      this.total,
      this.done,
      this.message,
      this.children,
      this.recent,
    );
  }
}

/** 已有可用正文：跳过重抓，降低风控 */
export function hasUsableInboxContent(content: string | null | undefined, minChars = 40): boolean {
  const t = String(content ?? "")
    .replace(/^\d+\s*\|\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= minChars;
}

/** 抓取结果像登录墙 / 验证 / 反爬空壳 */
export function looksLikeInboxFetchBlocked(
  content: string | null | undefined,
  errMsg?: string,
): boolean {
  const blob = `${String(content ?? "")} ${String(errMsg ?? "")}`;
  if (
    /安全验证|Security Verification|登录后继续|请先登录|扫码登录|访问频次|请求存在异常|暂时限制|验证码|被限制|登录已过期|login\s*required/i.test(
      blob,
    )
  ) {
    return true;
  }
  const plain = String(content ?? "")
    .replace(/^\d+\s*\|\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  // 过短且带小红书壳标题，多半没进正文
  if (plain.length > 0 && plain.length < 40 && /小红书|xiaohongshu|打开 App/i.test(plain)) {
    return true;
  }
  return false;
}

export async function sleepMs(ms: number, jitterRatio = 0.3): Promise<void> {
  const j = ms * jitterRatio * (Math.random() * 2 - 1);
  await new Promise((r) => setTimeout(r, Math.max(80, Math.round(ms + j))));
}

/** 闭区间 [min, max] 毫秒随机等待 */
export async function sleepRandomMs(minMs: number, maxMs: number): Promise<void> {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  const ms = lo + Math.floor(Math.random() * (hi - lo + 1));
  await new Promise((r) => setTimeout(r, ms));
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

export function cookiesToHeader(cookies: CookieJarEntry[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export function truncate(text: string, max = MAX_CONTENT_CHARS): string {
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

/** 增量早停阈值：连续 N 条已落盘（非新建）才停 */
export const INBOX_INCREMENTAL_KNOWN_STREAK = 10;

/** 增量：连续 streakKnown 条已同步落盘 → 提前停 */
export function shouldStopIncrementalKnownStreak(
  streakKnown: number,
  threshold = INBOX_INCREMENTAL_KNOWN_STREAK,
): boolean {
  return streakKnown >= threshold;
}

/** 占位标题：列表/DOM 没拿到文案时退化成「笔记 {id}」 */
export function isXhsPlaceholderTitle(title: string, noteId?: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^[a-f0-9]{16,}$/i.test(t)) return true;
  if (/^(笔记|小红书笔记)\s+[a-zA-Z0-9]{6,}$/i.test(t)) return true;
  if (noteId) {
    if (t === noteId) return true;
    if (t === `笔记 ${noteId}` || t === `小红书笔记 ${noteId}`) return true;
  }
  return false;
}

/** 从 desc 抽一行可读标题（小红书常把正文当标题、display_title 为空） */
export function titleFromXhsDesc(desc?: string | null): string {
  if (!desc) return "";
  const line = desc
    .split(/\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!line) return "";
  const cleaned = line.replace(/(?:\s*#[^\s#]+)+\s*$/u, "").trim() || line;
  return cleaned.slice(0, 80);
}

export function pickXhsDisplayTitle(
  noteId: string,
  ...candidates: Array<string | undefined | null>
): string {
  for (const c of candidates) {
    const t = String(c ?? "").replace(/\s+/g, " ").trim();
    if (!t || isXhsPlaceholderTitle(t, noteId)) continue;
    return t.slice(0, 200);
  }
  return `笔记 ${noteId}`;
}

async function upsertInboxFts(
  prisma: PrismaClient,
  row: {
    id: string;
    source: string;
    title: string;
    url?: string | null;
    tags?: string | null;
    excerpt?: string | null;
    content?: string | null;
  },
): Promise<void> {
  try {
    const { upsertFtsRow } = await import("../ftsIndex.js");
    await upsertFtsRow(
      prisma,
      "inbox",
      row.id,
      row.title,
      `[${row.source}] ${row.url ?? ""}\n${row.tags ?? ""}\n${row.excerpt ?? ""}\n${row.content ?? ""}`,
    );
  } catch (err) {
    console.warn("[inbox] FTS upsert 失败（不影响入库）:", err instanceof Error ? err.message : err);
  }
}

export async function upsertInboxItem(
  prisma: PrismaClient,
  input: InboxUpsertInput,
): Promise<{ id: string; created: boolean; title: string; url?: string | null }> {
  const tags = (input.tags ?? []).join(",");
  const metadata = JSON.stringify(input.metadata ?? {});
  const sourceAt = coerceSourceAt(input.sourceAt);
  const existing = await prisma.inboxItem.findUnique({
    where: { source_externalId: { source: input.source, externalId: input.externalId } },
  });
  if (existing) {
    // 已蒸馏/忽略的条目不覆盖状态；仅刷新内容字段
    // 禁止用「笔记 {id}」占位标题盖掉已有可读标题
    let nextTitle = input.title?.trim() || existing.title;
    if (
      isXhsPlaceholderTitle(nextTitle) &&
      existing.title &&
      !isXhsPlaceholderTitle(existing.title)
    ) {
      nextTitle = existing.title;
    }
    const data: Record<string, unknown> = {
      title: nextTitle,
      url: input.url ?? existing.url,
      excerpt: input.excerpt ?? existing.excerpt,
      contentPath: input.contentPath ?? existing.contentPath,
      content: input.content ?? existing.content,
      tags: tags || existing.tags,
      metadata,
      capturedAt: new Date(),
    };
    if (sourceAt) data.sourceAt = sourceAt;
    const updated = await prisma.inboxItem.update({ where: { id: existing.id }, data });
    await upsertInboxFts(prisma, updated);
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
      sourceAt,
      content: input.content ?? null,
      tags,
      metadata,
      status: "fetched",
    },
  });
  await upsertInboxFts(prisma, created);
  return { id: created.id, created: true, title: created.title, url: created.url };
}

export async function fetchArticleBody(
  url: string,
  maxChars: number,
): Promise<{
  title: string;
  content: string;
  author?: string;
  platform?: string;
  images?: string[];
}> {
  const parsed = await parsePlatformUrl({
    url,
    timeout: 45000,
    method: "playwright",
    embedOcr: false,
  });
  const content = truncate(String(parsed.content ?? ""), maxChars);
  const images = Array.isArray((parsed as { images?: unknown }).images)
    ? ((parsed as { images: string[] }).images || [])
        .map((u) => String(u || "").trim())
        .filter(Boolean)
        .slice(0, 20)
    : undefined;
  return {
    title: String(parsed.title || url).slice(0, 200),
    content,
    author: parsed.author ? String(parsed.author) : undefined,
    platform: parsed.platform ? String(parsed.platform) : undefined,
    ...(images?.length ? { images } : {}),
  };
}

/**
 * 分批补抓 Inbox 缺正文条目（防风控主路径）。
 * 铁律：先列表入库（fetchContent=false），再用本函数每天小批量补正文；
 * 已有正文跳过；条间 8–22s 随机间隔；连续撞墙立即停。
 */
/** 正文补抓节奏（与 xhs 列表同步共用常量） */
export const XHS_PACE = {
  contentGapMinMs: 8_000,
  contentGapMaxMs: 22_000,
  contentBlockStopStreak: 2,
} as const;

export async function enrichInboxMissingContent(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    source?: InboxSource;
    /** 本轮最多新抓多少条，默认 12 */
    maxItems?: number;
    maxChars?: number;
    /** 指定 id；不传则自动挑 content 空/过短的 fetched 条目 */
    ids?: string[];
    gapMinMs?: number;
    gapMaxMs?: number;
    onProgress?: InboxSyncProgressFn;
    shouldAbort?: () => boolean;
  } = {},
): Promise<
  InboxSyncResult & {
    enriched: number;
    deferred: number;
    stoppedReason?: string;
  }
> {
  ensureInboxDirs(config);
  const maxItems = Math.min(50, Math.max(1, opts.maxItems ?? 12));
  const maxChars = opts.maxChars ?? 12000;
  const gapMin = opts.gapMinMs ?? XHS_PACE.contentGapMinMs;
  const gapMax = opts.gapMaxMs ?? XHS_PACE.contentGapMaxMs;
  const progress = new InboxSyncProgressTracker(opts.onProgress);
  const shouldAbort = opts.shouldAbort;
  throwIfInboxSyncAborted(shouldAbort);

  const errors: string[] = [];
  const items: InboxSyncResult["items"] = [];
  let enriched = 0;
  let deferred = 0;
  let skipped = 0;
  let stoppedReason: string | undefined;
  let blockStreak = 0;

  const where: Record<string, unknown> = {
    status: "fetched",
    url: { not: null },
  };
  if (opts.source) where.source = opts.source;
  if (opts.ids?.length) {
    where.id = { in: opts.ids };
  } else {
    // Prisma 对 SQLite 空串过滤：content null 或极短
    where.OR = [{ content: null }, { content: "" }];
  }

  const candidates = await prisma.inboxItem.findMany({
    where,
    orderBy: { capturedAt: "desc" },
    take: opts.ids?.length ? opts.ids.length : maxItems * 3,
  });

  // 再过滤：指定 ids 时也可能已有正文；OR 空串漏掉只有空白的
  const queue = candidates
    .filter((row) => row.url && !hasUsableInboxContent(row.content))
    .slice(0, maxItems);

  progress.setMessage(`补正文队列 ${queue.length} 条（预算 ${maxItems}）`);
  progress.addTotal(queue.length);

  for (const row of queue) {
    throwIfInboxSyncAborted(shouldAbort);
    if (stoppedReason) {
      deferred += 1;
      continue;
    }
    const url = String(row.url);
    progress.setMessage(`补正文 ${enriched + 1}/${queue.length} · ${row.title.slice(0, 40)}`);
    try {
      const body = await fetchArticleBody(url, maxChars);
      let meta: Record<string, unknown> = {};
      try {
        meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
      } catch {
        meta = {};
      }
      if (looksLikeInboxFetchBlocked(body.content)) {
        blockStreak += 1;
        meta.fetchError = "疑似风控/登录墙";
        meta.contentBlocked = true;
        await prisma.inboxItem.update({
          where: { id: row.id },
          data: { metadata: JSON.stringify(meta) },
        });
        errors.push(`${url}: 疑似风控`);
        progress.pushRecent(`风控 · ${row.title.slice(0, 36)}`);
        if (blockStreak >= XHS_PACE.contentBlockStopStreak) {
          stoppedReason = "连续撞风控，已停止；过几小时再 inbox_enrich";
          errors.push(stoppedReason);
        }
        continue;
      }
      if (body.images?.length) {
        meta.images = body.images;
        if (!meta.cover) meta.cover = body.images[0];
      }
      if (body.author) meta.author = body.author;
      if (body.platform) meta.platform = body.platform;
      delete meta.fetchError;
      delete meta.contentBlocked;
      delete meta.contentDeferred;
      const nextTitle =
        body.title && !isXhsPlaceholderTitle(body.title)
          ? body.title.slice(0, 200)
          : row.title;
      const updated = await prisma.inboxItem.update({
        where: { id: row.id },
        data: {
          title: nextTitle,
          content: body.content,
          excerpt: body.content.slice(0, 280),
          metadata: JSON.stringify(meta),
          capturedAt: new Date(),
        },
      });
      await upsertInboxFts(prisma, updated);
      enriched += 1;
      blockStreak = 0;
      items.push({ id: updated.id, title: updated.title, url: updated.url, created: false });
      progress.success();
      progress.pushRecent(`已补正文 · ${updated.title.slice(0, 40)}`);
      await sleepRandomMs(gapMin, gapMax);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${url}: ${msg}`);
      skipped += 1;
      if (looksLikeInboxFetchBlocked(null, msg)) {
        blockStreak += 1;
        if (blockStreak >= XHS_PACE.contentBlockStopStreak) {
          stoppedReason = "连续失败（疑似风控），已停止；稍后小批量再试";
          errors.push(stoppedReason);
        }
      }
      progress.pushRecent(`失败 · ${row.title.slice(0, 36)} · ${msg.slice(0, 60)}`);
    }
  }

  return {
    scanned: queue.length,
    created: 0,
    updated: enriched,
    skipped,
    errors,
    items,
    enriched,
    deferred,
    stoppedReason,
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
    onProgress?: InboxSyncProgressFn;
  },
): Promise<InboxSyncResult> {
  const urls = opts.urls.map((u) => u.trim()).filter((u) => u && !u.startsWith("#"));
  const progress = new InboxSyncProgressTracker(opts.onProgress);
  progress.setTotal(urls.length);
  const result: InboxSyncResult = { scanned: 0, created: 0, updated: 0, skipped: 0, errors: [], items: [] };
  for (const url of urls) {
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
      progress.success();
    } catch (err) {
      result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped += 1;
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
