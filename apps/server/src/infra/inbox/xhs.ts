/**
 * 小红书 Inbox 同步与解析
 */

import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import { loadCookies } from "../cookieJar.js";
import {
  clearPlatformLoginState,
  getPlatformStorageStatePath,
  isXhsPageLoggedIn,
  waitAndPersistPlatformLogin,
} from "../metablog/auth/platformLogin.js";
import { launchZhihuBrowser } from "../metablog/auth/zhihuBrowser.js";
import {
  ensureInboxDirs,
  getInboxRoot,
  hasUsableInboxContent,
  looksLikeInboxFetchBlocked,
  throwIfInboxSyncAborted,
  upsertInboxItem,
  fetchArticleBody,
  sleepMs,
  sleepRandomMs,
  shouldStopIncrementalKnownStreak,
  InboxSyncProgressTracker,
  isXhsPlaceholderTitle,
  titleFromXhsDesc,
  pickXhsDisplayTitle,
  type InboxSyncProgressFn,
  type InboxSyncResult,
  type ZhihuSyncMode,
} from "./shared.js";

export {
  isXhsPlaceholderTitle,
  titleFromXhsDesc,
  pickXhsDisplayTitle,
} from "./shared.js";

export type XhsSyncKind = "liked" | "collect";

const XHS_KIND_CFG: Record<
  XhsSyncKind,
  {
    tabQuery: string;
    tabLabels: string[];
    /** 只匹配列表分页 API；禁止匹配 user_posted（作品页） */
    apiPattern: RegExp;
    tag: string;
    externalPrefix: string;
    label: string;
  }
> = {
  liked: {
    tabQuery: "tab=liked&subTab=note",
    tabLabels: ["点赞", "赞过", "喜欢"],
    // 实测：v1/note/like/page（勿匹配 POST /note/like）
    apiPattern: /\/api\/sns\/web\/v\d+\/note\/like\/page/i,
    tag: "like",
    externalPrefix: "like:",
    label: "点赞",
  },
  collect: {
    tabQuery: "tab=fav&subTab=note",
    tabLabels: ["收藏", "我的收藏"],
    // 实测：v2/note/collect/page（勿匹配 user_posted）
    apiPattern: /\/api\/sns\/web\/v\d+\/note\/collect\/page/i,
    tag: "favorite",
    externalPrefix: "fav:",
    label: "收藏",
  },
};

/**
 * 小红书节奏：列表用「小步慢滚 + 每步等列表 API」减少翻页请求被取消；
 * feed 补拉仍刻意偏慢防风控。
 */
const XHS_PACE = {
  /** 小步滚后额外缓冲（API wait 之外） */
  scrollGapMinMs: 1_200,
  scrollGapMaxMs: 2_200,
  /** 每次滚轮像素（小步，宁多滚几次） */
  scrollDeltaMin: 380,
  scrollDeltaMax: 520,
  /** 最多小步次数（114 收藏约十余步；点赞 300+ 需更多） */
  scrollRoundsIncremental: 80,
  scrollRoundsFull: 200,
  /** 连续无新增则停 */
  scrollStagnantStop: 12,
  /** 等列表 API 超时（单步） */
  scrollApiWaitMs: 8_000,
  /** Tab/进页后缓冲 */
  afterNavigateMs: 3200,
  afterTabClickMs: 1500,
  /** feed 补拉间隔：10s–30s 均匀随机（防风控） */
  feedGapMinMs: 10_000,
  feedGapMaxMs: 30_000,
  /** feed 单次同步最多条数 */
  feedMaxIncremental: 24,
  feedMaxFull: 48,
  /**
   * 正文抓取节奏（fetchContent / inbox_enrich）：
   * 逐条打开笔记详情，比列表 API 更易风控——必须慢、有预算、撞墙停。
   */
  contentGapMinMs: 8_000,
  contentGapMaxMs: 22_000,
  /** 单次 syncXhs(fetchContent=true) 最多新抓多少条正文（其余只落列表） */
  contentMaxPerListSync: 15,
  /** 连续疑似风控/空壳则停止继续抓正文 */
  contentBlockStopStreak: 2,
} as const;

type XhsNoteItem = {
  kind: XhsSyncKind;
  noteId: string;
  title: string;
  url: string;
  author?: string;
  excerpt?: string;
  coverUrl?: string;
  publishedAtMs?: number;
};

/** 小红书时间字段：秒或毫秒 epoch → ms；过小的数（非时间戳）丢弃 */
export function coerceXhsEpochMs(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 1e9) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 1e9) return n > 1e12 ? n : n * 1000;
    if (/^\d{4}[-/]\d{1,2}([-/]\d{1,2})?/.test(raw.trim())) {
      const d = Date.parse(raw.trim().replace(/\./g, "-"));
      if (!Number.isNaN(d)) return d;
    }
  }
  return undefined;
}

function pickXhsCoverUrl(
  card: Record<string, unknown>,
  row: Record<string, unknown>,
): string | undefined {
  const cover = (card.cover ?? row.cover) as Record<string, unknown> | undefined;
  if (!cover || typeof cover !== "object") return undefined;
  const direct = [
    cover.url_default,
    cover.urlDefault,
    cover.url,
    cover.url_pre,
    cover.urlPre,
  ]
    .map((v) => String(v || "").trim())
    .find((v) => /^https?:\/\//i.test(v));
  if (direct) return direct;
  const infoList = cover.infoList ?? cover.info_list;
  if (Array.isArray(infoList)) {
    for (const item of infoList) {
      if (!item || typeof item !== "object") continue;
      const u = String((item as { url?: string }).url || "").trim();
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  return undefined;
}

function pickXhsTimeFromCornerTags(card: Record<string, unknown>): number | undefined {
  const tags = card.corner_tag_info ?? card.cornerTagInfo;
  if (!Array.isArray(tags)) return undefined;
  for (const tag of tags) {
    if (!tag || typeof tag !== "object") continue;
    const t = tag as Record<string, unknown>;
    const type = String(t.type ?? t.tag_type ?? t.tagType ?? "");
    if (!/publish|time|date/i.test(type) && type !== "") continue;
    const text = String(t.text ?? t.name ?? "").trim();
    const ms = coerceXhsEpochMs(text);
    if (ms) return ms;
  }
  return undefined;
}

function deepPickXhsTimeMs(
  obj: unknown,
  depth: number,
  skipKeys: Set<string>,
): number | undefined {
  if (!obj || typeof obj !== "object" || depth > 3) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const ms = deepPickXhsTimeMs(item, depth + 1, skipKeys);
      if (ms) return ms;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  const TIME_KEYS = new Set([
    "time",
    "timestamp",
    "create_time",
    "created_time",
    "created_at",
    "last_update_time",
    "update_time",
    "publish_time",
    "published_at",
  ]);
  for (const [k, v] of Object.entries(rec)) {
    if (TIME_KEYS.has(k) || TIME_KEYS.has(k.toLowerCase())) {
      const ms = coerceXhsEpochMs(v);
      if (ms) return ms;
    }
  }
  for (const [k, v] of Object.entries(rec)) {
    if (skipKeys.has(k) || skipKeys.has(k.toLowerCase())) continue;
    if (v && typeof v === "object") {
      const ms = deepPickXhsTimeMs(v, depth + 1, skipKeys);
      if (ms) return ms;
    }
  }
  return undefined;
}

function pickXhsPublishedAtMs(card: Record<string, unknown>, row: Record<string, unknown>): number | undefined {
  const candidates = [
    card.time,
    card.timestamp,
    card.create_time,
    card.created_time,
    card.last_update_time,
    card.update_time,
    card.publish_time,
    row.time,
    row.timestamp,
    row.create_time,
    row.last_update_time,
  ];
  for (const raw of candidates) {
    const ms = coerceXhsEpochMs(raw);
    if (ms) return ms;
  }
  const interact = (card.interact_info ?? card.interactInfo) as Record<string, unknown> | undefined;
  if (interact) {
    for (const raw of [interact.time, interact.create_time, interact.timestamp]) {
      const ms = coerceXhsEpochMs(raw);
      if (ms) return ms;
    }
  }
  const fromTags = pickXhsTimeFromCornerTags(card);
  if (fromTags) return fromTags;
  // 列表 API 字段常嵌套；跳过 user/cover 避免误取用户注册时间
  return (
    deepPickXhsTimeMs(card, 0, new Set(["user", "cover", "images_list", "image_list", "video", "share_info"])) ??
    deepPickXhsTimeMs(row, 0, new Set(["user", "cover", "note_card", "noteCard", "images_list", "video"]))
  );
}

/**
 * 列表 API 多半不带绝对发帖时间：关窗前用 /api/sns/web/v1/feed 补 publishedAtMs（及缺失的 desc）。
 * 限流 + max，避免把免费配额/风控打爆。
 */
async function enrichXhsNotesFromFeed(
  page: {
    evaluate: (
      fn: (arg: {
        noteId: string;
        token: string;
      }) => Promise<{ timeMs?: number; desc?: string; author?: string; title?: string } | null>,
      arg: { noteId: string; token: string },
    ) => Promise<{ timeMs?: number; desc?: string; author?: string; title?: string } | null>;
  },
  notes: XhsNoteItem[],
  opts: {
    max?: number;
    shouldAbort?: () => boolean;
    onTick?: (done: number, total: number, note: XhsNoteItem) => void;
  },
): Promise<{ timeFilled: number; titleFilled: number }> {
  // 缺时间或占位标题都补拉；占位标题优先（限速下先救可读性）
  const need = notes
    .filter((n) => !n.publishedAtMs || isXhsPlaceholderTitle(n.title, n.noteId))
    .sort((a, b) => {
      const ap = isXhsPlaceholderTitle(a.title, a.noteId) ? 0 : 1;
      const bp = isXhsPlaceholderTitle(b.title, b.noteId) ? 0 : 1;
      return ap - bp;
    });
  const max = Math.min(opts.max ?? 200, need.length);
  let timeFilled = 0;
  let titleFilled = 0;
  for (let i = 0; i < max; i++) {
    throwIfInboxSyncAborted(opts.shouldAbort);
    const note = need[i]!;
    let token = "";
    try {
      token = new URL(note.url).searchParams.get("xsec_token") ?? "";
    } catch {
      /* ignore */
    }
    opts.onTick?.(i + 1, max, note);
    const hit = await page
      .evaluate(async ({ noteId, token: xsecToken }) => {
        try {
          const r = await fetch("https://edith.xiaohongshu.com/api/sns/web/v1/feed", {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json;charset=UTF-8",
            },
            body: JSON.stringify({
              source_note_id: noteId,
              image_formats: ["jpg", "webp", "avif"],
              extra: '{"need_body_topic":"1"}',
              xsec_source: "pc_user",
              xsec_token: xsecToken || "",
            }),
          });
          if (!r.ok) return null;
          const j = (await r.json().catch(() => null)) as {
            data?: {
              items?: Array<{
                note_card?: Record<string, unknown>;
                noteCard?: Record<string, unknown>;
              }>;
            };
          } | null;
          const card =
            j?.data?.items?.[0]?.note_card ?? j?.data?.items?.[0]?.noteCard ?? null;
          if (!card) return null;
          const timeRaw =
            card.time ?? card.last_update_time ?? card.create_time ?? card.timestamp;
          let timeMs: number | undefined;
          if (typeof timeRaw === "number" && Number.isFinite(timeRaw) && timeRaw > 1e9) {
            timeMs = timeRaw > 1e12 ? timeRaw : timeRaw * 1000;
          } else if (typeof timeRaw === "string" && timeRaw.trim()) {
            const n = Number(timeRaw);
            if (Number.isFinite(n) && n > 1e9) timeMs = n > 1e12 ? n : n * 1000;
          }
          const desc = String(card.desc ?? card.description ?? "").trim();
          const user = card.user as { nickname?: string; nick_name?: string } | undefined;
          const author = user?.nickname || user?.nick_name;
          const titleRaw = String(
            card.display_title ?? card.displayTitle ?? card.title ?? "",
          ).trim();
          return {
            timeMs,
            desc: desc || undefined,
            author: author || undefined,
            title: titleRaw || undefined,
          };
        } catch {
          return null;
        }
      }, { noteId: note.noteId, token })
      .catch(() => null);
    if (hit?.timeMs && !note.publishedAtMs) {
      note.publishedAtMs = hit.timeMs;
      timeFilled += 1;
    }
    if (hit?.desc && !note.excerpt) note.excerpt = hit.desc.slice(0, 500);
    if (hit?.author && !note.author) note.author = hit.author;
    if (isXhsPlaceholderTitle(note.title, note.noteId)) {
      const next = pickXhsDisplayTitle(
        note.noteId,
        hit?.title,
        titleFromXhsDesc(hit?.desc),
        titleFromXhsDesc(note.excerpt),
      );
      if (!isXhsPlaceholderTitle(next, note.noteId)) {
        note.title = next;
        titleFilled += 1;
      }
    }
    // 10s–30s 随机间隔，避免高频 feed 触发风控
    await sleepRandomMs(XHS_PACE.feedGapMinMs, XHS_PACE.feedGapMaxMs);
  }
  return { timeFilled, titleFilled };
}

/** 解析小红书列表 API JSON（供单测与 syncXhsLibrary 共用） */
export function parseXhsNotesFromApiJson(
  json: unknown,
  kind: XhsSyncKind,
): Array<Omit<XhsNoteItem, "kind">> {
  const out: Array<Omit<XhsNoteItem, "kind">> = [];
  const seen = new Set<string>();
  const root = json as {
    data?: {
      notes?: unknown[];
      items?: unknown[];
    };
    notes?: unknown[];
  };
  const dataRec = (root?.data ?? {}) as Record<string, unknown>;
  const rows = [
    ...(Array.isArray(root?.data?.notes) ? root.data!.notes! : []),
    ...(Array.isArray(root?.data?.items) ? root.data!.items! : []),
    ...(Array.isArray(dataRec.note_list) ? (dataRec.note_list as unknown[]) : []),
    ...(Array.isArray(dataRec.noteList) ? (dataRec.noteList as unknown[]) : []),
    ...(Array.isArray(root?.notes) ? root.notes! : []),
  ];
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const card = (row.note_card ?? row.noteCard ?? row) as Record<string, unknown>;
    const user = (card.user ?? row.user) as { nickname?: string; nick_name?: string } | undefined;
    const noteId = String(
      card.note_id || card.noteId || card.id || row.note_id || row.noteId || row.id || row.feed_id || "",
    );
    if (!noteId || seen.has(noteId)) continue;
    // 跳过非笔记卡片（用户卡等）
    if (noteId.length < 6) continue;
    seen.add(noteId);
    const excerptRaw = String(
      card.desc ||
        card.description ||
        card.seo_description ||
        row.desc ||
        row.description ||
        "",
    ).trim();
    const title = pickXhsDisplayTitle(
      noteId,
      card.display_title as string | undefined,
      card.displayTitle as string | undefined,
      card.title as string | undefined,
      row.display_title as string | undefined,
      row.displayTitle as string | undefined,
      row.title as string | undefined,
      titleFromXhsDesc(excerptRaw),
    );
    const excerpt = excerptRaw ? excerptRaw.slice(0, 500) : undefined;
    const token = String(
      card.xsec_token || card.xsecToken || row.xsec_token || row.xsecToken || "",
    );
    const url = token
      ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(token)}`
      : `https://www.xiaohongshu.com/explore/${noteId}`;
    out.push({
      noteId,
      title,
      url,
      author: user?.nickname || user?.nick_name,
      excerpt,
      coverUrl: pickXhsCoverUrl(card, row),
      publishedAtMs: pickXhsPublishedAtMs(card, row),
    });
  }
  void kind;
  return out;
}

export function xhsInboxExternalId(kind: XhsSyncKind, noteId: string): string {
  return `${XHS_KIND_CFG[kind].externalPrefix}${noteId}`;
}

export type XhsSyncMode = ZhihuSyncMode;

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
 * 落盘：发现一条立即串行 upsert（中途中断已写入的保留）；feed 补全后再回写标题/时间。
 */
export async function syncXhsLibrary(
  prisma: PrismaClient,
  config: AppConfig,
  opts: {
    kinds?: XhsSyncKind[];
    mode?: XhsSyncMode;
    maxItems?: number;
    /** 入库上限（跨 kind 合计）；列表仍可扫到 maxItems */
    maxUpsert?: number;
    fetchContent?: boolean;
    maxChars?: number;
    onProgress?: InboxSyncProgressFn;
    shouldAbort?: () => boolean;
  },
): Promise<InboxSyncResult> {
  ensureInboxDirs(config);
  const mode: XhsSyncMode = opts.mode ?? "incremental";
  const maxItems = opts.maxItems ?? (mode === "full" ? 2000 : 500);
  const progress = new InboxSyncProgressTracker(opts.onProgress);
  const shouldAbort = opts.shouldAbort;
  throwIfInboxSyncAborted(shouldAbort);
  const kinds = (opts.kinds?.length ? opts.kinds : (["liked", "collect"] as XhsSyncKind[])).filter(
    (k): k is XhsSyncKind => k === "liked" || k === "collect",
  );
  const uniqueKinds = [...new Set(kinds)];
  // 无落盘态也照样弹有头 Chrome 等扫码（勿直接 return「未登录」——与知乎开放平台不同，小红书只能浏览器登录）
  const storageState = getPlatformStorageStatePath("xhs");
  const cookies = loadCookies("xhs");

  const notes: XhsNoteItem[] = [];
  const errors: string[] = [];
  const stoppedEarlyByKind: Partial<Record<XhsSyncKind, boolean>> = {};
  const knownStreakByKind = new Map<XhsSyncKind, number>();
  /** 当前正在采集的 kind（response 监听用） */
  let activeKind: XhsSyncKind | null = null;
  const existingByKind = new Map<XhsSyncKind, Set<string>>();
  for (const kind of uniqueKinds) {
    existingByKind.set(kind, await loadExistingXhsNoteIds(prisma, kind));
    knownStreakByKind.set(kind, 0);
  }

  // 拉取一条 → 落盘一条（串行队列，避免 response 并发打乱计数）
  const result: InboxSyncResult = {
    scanned: 0,
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
      stoppedEarly: false,
    };
  }
  const upsertCap =
    opts.maxUpsert != null && opts.maxUpsert > 0 ? opts.maxUpsert : Number.POSITIVE_INFINITY;
  const written = new Set<string>();
  let writeSlotsUsed = 0;
  let persistChain: Promise<void> = Promise.resolve();
  /** fetchContent 本轮新抓正文计数 / 连续风控 */
  let contentFetchedThisRun = 0;
  let contentBlockStreak = 0;
  let contentFetchPaused = false;
  const noteKey = (n: XhsNoteItem) => `${n.kind}:${n.noteId}`;
  const clipTitle = (t: string, n = 42) => {
    const s = t.replace(/\s+/g, " ").trim();
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  const describeNote = (note: Pick<XhsNoteItem, "kind" | "title" | "author" | "noteId">) => {
    const kindLabel = XHS_KIND_CFG[note.kind].label;
    const author = note.author?.trim() ? ` · @${note.author.trim()}` : "";
    return `[${kindLabel}] ${clipTitle(note.title)}${author}`;
  };

  const persistXhsNoteNow = async (note: XhsNoteItem): Promise<void> => {
    const key = noteKey(note);
    const firstWrite = !written.has(key);
    if (firstWrite) {
      if (writeSlotsUsed >= upsertCap) return;
      writeSlotsUsed += 1;
      written.add(key);
      progress.addTotal(1);
    }
    const cfg = XHS_KIND_CFG[note.kind];
    const bucket = result.byKind![note.kind]!;
    try {
      const externalId = xhsInboxExternalId(note.kind, note.noteId);
      const existing = await prisma.inboxItem.findUnique({
        where: { source_externalId: { source: "xhs", externalId } },
        select: { content: true, metadata: true, title: true, excerpt: true },
      });
      let existingMeta: Record<string, unknown> = {};
      if (existing?.metadata) {
        try {
          existingMeta = JSON.parse(existing.metadata) as Record<string, unknown>;
        } catch {
          existingMeta = {};
        }
      }
      let title = note.title;
      let content: string | null = existing?.content ?? null;
      let excerpt: string | null = note.excerpt ?? existing?.excerpt ?? null;
      if (isXhsPlaceholderTitle(title, note.noteId)) {
        title = pickXhsDisplayTitle(note.noteId, titleFromXhsDesc(excerpt));
      }
      progress.setMessage(
        `正在落盘 ${result.created + result.updated + 1} · ${describeNote({ ...note, title })}`,
      );
      const metadata: Record<string, unknown> = {
        ...existingMeta,
        author: note.author || existingMeta.author,
        kind: note.kind,
        noteId: note.noteId,
      };
      if (note.publishedAtMs) metadata.publishedAt = note.publishedAtMs;
      if (note.coverUrl) metadata.cover = note.coverUrl;
      if (opts.fetchContent) {
        const already = hasUsableInboxContent(content);
        const overBudget = contentFetchedThisRun >= XHS_PACE.contentMaxPerListSync;
        if (already) {
          progress.pushRecent(`跳过正文（已有）· ${describeNote({ ...note, title })}`);
        } else if (contentFetchPaused || overBudget) {
          if (overBudget && !contentFetchPaused) {
            progress.pushRecent(
              `正文预算已满 ${XHS_PACE.contentMaxPerListSync} 条，其余只落列表；请用 inbox_enrich 续补`,
            );
            contentFetchPaused = true;
          }
          metadata.contentDeferred = true;
        } else {
          progress.setMessage(`抓正文中 · ${describeNote({ ...note, title })}`);
          try {
            const body = await fetchArticleBody(note.url, opts.maxChars ?? 12000);
            const bodyTitle = String(body.title || "").trim();
            if (bodyTitle && !isXhsPlaceholderTitle(bodyTitle, note.noteId)) {
              title = bodyTitle;
            } else if (isXhsPlaceholderTitle(title, note.noteId)) {
              title = pickXhsDisplayTitle(
                note.noteId,
                bodyTitle,
                titleFromXhsDesc(body.content),
              );
            }
            if (looksLikeInboxFetchBlocked(body.content)) {
              contentBlockStreak += 1;
              metadata.fetchError = "疑似风控/登录墙，正文未写入";
              metadata.contentBlocked = true;
              progress.pushRecent(
                `正文疑似风控 · ${describeNote({ ...note, title })} · streak=${contentBlockStreak}`,
              );
              if (contentBlockStreak >= XHS_PACE.contentBlockStopStreak) {
                contentFetchPaused = true;
                errors.push(
                  "正文抓取连续撞风控，已停止本轮继续抓正文（列表仍会落盘）。稍后用 inbox_enrich 小批量续补。",
                );
              }
            } else {
              content = body.content;
              excerpt = body.content.slice(0, 280) || excerpt;
              metadata.platform = body.platform;
              if (body.author) metadata.author = body.author;
              if (body.images?.length) {
                metadata.images = body.images;
                if (!metadata.cover) metadata.cover = body.images[0];
              }
              delete metadata.fetchError;
              delete metadata.contentBlocked;
              delete metadata.contentDeferred;
              contentFetchedThisRun += 1;
              contentBlockStreak = 0;
              await sleepRandomMs(XHS_PACE.contentGapMinMs, XHS_PACE.contentGapMaxMs);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            metadata.fetchError = msg;
            if (looksLikeInboxFetchBlocked(null, msg)) {
              contentBlockStreak += 1;
              metadata.contentBlocked = true;
              if (contentBlockStreak >= XHS_PACE.contentBlockStopStreak) {
                contentFetchPaused = true;
                errors.push(
                  "正文抓取连续失败（疑似风控），已停止本轮继续抓正文。稍后用 inbox_enrich 续补。",
                );
              }
            }
          }
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
        sourceAt: note.publishedAtMs ? new Date(note.publishedAtMs) : null,
      });
      if (firstWrite) {
        bucket.scanned += 1;
        result.scanned += 1;
        if (upserted.created) {
          result.created += 1;
          bucket.created += 1;
        } else {
          result.updated += 1;
          bucket.updated += 1;
        }
        result.items.push(upserted);
        progress.success();
        const verb = upserted.created ? "新收录" : "已更新";
        progress.pushRecent(
          `${verb} ${result.created + result.updated}/${progress.total || result.created + result.updated} · ${describeNote({ ...note, title })}`,
        );
      } else {
        // feed 补全后的二次写入：只刷新字段，不重复计 created/updated
        progress.pushRecent(`回写标题/时间 · ${describeNote({ ...note, title })}`);
      }
    } catch (err) {
      if (firstWrite) result.skipped += 1;
      errors.push(`${note.url}: ${err instanceof Error ? err.message : String(err)}`);
      progress.pushRecent(
        `落盘失败 · ${describeNote(note)} · ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const enqueuePersist = (note: XhsNoteItem) => {
    persistChain = persistChain
      .then(() => persistXhsNoteNow(note))
      .catch((err) => {
        errors.push(`落盘队列: ${err instanceof Error ? err.message : String(err)}`);
      });
  };

  /** 新发现一条：入内存 + 立刻排队落盘 */
  const acceptNote = (kind: XhsSyncKind, n: Omit<XhsNoteItem, "kind">): boolean => {
    if (notes.filter((x) => x.kind === kind).length >= maxItems) return false;
    if (notes.some((x) => x.kind === kind && x.noteId === n.noteId)) return false;
    const item: XhsNoteItem = { kind, ...n };
    notes.push(item);
    const tabCount = notes.filter((x) => x.kind === kind).length;
    progress.pushRecent(
      `发现 · ${describeNote(item)} · 本 Tab ${tabCount}/${maxItems}`,
    );
    enqueuePersist(item);
    return true;
  };

  // 与 platform_login 同一启动器（UA/时区/stealth），否则落盘 storageState 常被当成未登录
  const hitApiUrls: string[] = [];
  let browser: Awaited<ReturnType<typeof launchZhihuBrowser>>["browser"] | null = null;
  try {
    if (!storageState && !cookies.length) {
      progress.setMessage("小红书无登录态：即将弹出 Chrome，请扫码并在手机点确认…");
    }
    const launched = await launchZhihuBrowser({
      headless: false,
      storageState: storageState ?? undefined,
    });
    browser = launched.browser;
    const { context, page } = launched;

    // storageState 有时缺字段：再叠一层 cookieJar（同值覆盖无害）
    if (cookies.length) {
      await context.addCookies(
        cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || "/",
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: (c.sameSite as "Strict" | "Lax" | "None" | undefined) ?? "Lax",
          ...(typeof c.expires === "number" && c.expires > 0 ? { expires: c.expires } : {}),
        })),
      );
    }

    const ingestParsedNotes = (kind: XhsSyncKind, parsed: Array<Omit<XhsNoteItem, "kind">>) => {
      if (stoppedEarlyByKind[kind]) return;
      const existing = existingByKind.get(kind) ?? new Set();
      let streakKnown = knownStreakByKind.get(kind) ?? 0;
      for (const n of parsed) {
        if (!acceptNote(kind, n)) {
          if (notes.filter((x) => x.kind === kind).length >= maxItems) break;
          continue;
        }
        if (existing.has(n.noteId)) {
          streakKnown += 1;
          if (mode === "incremental" && shouldStopIncrementalKnownStreak(streakKnown)) {
            stoppedEarlyByKind[kind] = true;
            break;
          }
        } else {
          streakKnown = 0;
        }
      }
      knownStreakByKind.set(kind, streakKnown);
    };

    context.on("response", async (response) => {
      try {
        if (!activeKind) return;
        if (stoppedEarlyByKind[activeKind]) return;
        const cfg = XHS_KIND_CFG[activeKind];
        const u = response.url();
        // 硬拒作品页，防止误采 user_posted
        if (/user_posted/i.test(u)) return;
        if (!cfg.apiPattern.test(u)) return;
        if (!response.ok()) return;
        const json = await response.json().catch(() => null);
        if (!json) return;
        const parsed = parseXhsNotesFromApiJson(json, activeKind);
        if (!parsed.length) return;
        hitApiUrls.push(u.split("?")[0] ?? u);
        ingestParsedNotes(activeKind, parsed);
      } catch {
        /* ignore */
      }
    });

    // page 已由 launchZhihuBrowser 创建（与 platform_login 同上下文）
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await new Promise((r) => setTimeout(r, 2500));

    const ensureXhsSession = async (reason: string): Promise<boolean> => {
      // 侧栏已有「我」= 已登录，绝不再弹「登录态失效」（探索页文案不能覆盖此判定）
      if (await isXhsPageLoggedIn(page)) return true;

      const onLogin =
        /\/login/i.test(page.url()) ||
        /verifyUuid|website-login|captcha/i.test(page.url());
      if (!onLogin) {
        const stillModal = await page
          .locator(".login-container, [class*='login-container'], img.qrcode-img")
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);
        if (!stillModal) {
          // 无「我」也无弹层：再等一轮渲染后复检
          await new Promise((r) => setTimeout(r, 1500));
          if (await isXhsPageLoggedIn(page)) return true;
        }
      }
      progress.setMessage(
        `${reason}请完成安全验证/登录扫码，每次扫完后在手机点「确认」；窗口会等到左侧出现「我」才继续（可能扫两遍，约 8 分钟内勿关）…`,
      );
      const relogin = await waitAndPersistPlatformLogin("xhs", context, page, 480);
      if (!relogin.success) {
        clearPlatformLoginState("xhs");
        errors.push(`小红书补登失败：${relogin.message}`);
        return false;
      }
      progress.setMessage("登录成功，继续拉取…");
      await page.goto("https://www.xiaohongshu.com/explore", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await new Promise((r) => setTimeout(r, 2000));
      return true;
    };

    if (
      !(await ensureXhsSession(
        !storageState && !cookies.length ? "未登录：" : "登录态失效：",
      ))
    ) {
      return {
        scanned: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors,
        items: [],
        mode,
        byKind: {},
      };
    }

    // 优先用身份 API 拿 user_id（比侧栏 DOM 稳）
    let uid: string | null = null;
    try {
      const me = await page.evaluate(async () => {
        const r = await fetch("https://edith.xiaohongshu.com/api/sns/web/v2/user/me", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        return (await r.json().catch(() => null)) as {
          data?: { user_id?: string; userId?: string; guest?: boolean };
        } | null;
      });
      if (me?.data?.guest === true) {
        errors.push("小红书 /user/me 仍为访客态。请重新 platform_login(xhs)。");
      } else {
        uid = String(me?.data?.user_id || me?.data?.userId || "").trim() || null;
      }
    } catch {
      /* ignore */
    }

    const profileHref = await page.evaluate(() => {
      const a =
        document.querySelector<HTMLAnchorElement>('a[href*="/user/profile/"]') ||
        document.querySelector<HTMLAnchorElement>('a[href*="user/profile"]');
      return a?.href || null;
    });
    if (!uid) {
      uid = profileHref?.match(/\/user\/profile\/([^/?#]+)/)?.[1] ?? null;
    }
    if (!uid) {
      errors.push(
        "未能解析小红书 user_id（浏览器未识别登录）。请重新 platform_login(xhs) 后同步。",
      );
    }

    const scrollRounds =
      mode === "full" ? XHS_PACE.scrollRoundsFull : XHS_PACE.scrollRoundsIncremental;

    for (const kind of uniqueKinds) {
      throwIfInboxSyncAborted(shouldAbort);
      activeKind = kind;
      const cfg = XHS_KIND_CFG[kind];
      const beforeCount = notes.filter((n) => n.kind === kind).length;
      const existing = existingByKind.get(kind) ?? new Set();

      if (uid) {
        await page.goto(`https://www.xiaohongshu.com/user/profile/${uid}?${cfg.tabQuery}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await sleepMs(XHS_PACE.afterNavigateMs);
      } else if (profileHref) {
        await page.goto(profileHref, { waitUntil: "domcontentloaded", timeout: 60000 });
        await sleepMs(XHS_PACE.afterNavigateMs);
      } else {
        errors.push(`跳过「${cfg.label}」：无个人主页可打开。`);
        continue;
      }

      // 进点赞/收藏页再次被踢登录：继续等（勿当失败关窗）
      if (!(await ensureXhsSession(`打开「${cfg.label}」时又需登录：`))) {
        continue;
      }
      if (uid && /\/login/i.test(page.url())) {
        await page.goto(`https://www.xiaohongshu.com/user/profile/${uid}?${cfg.tabQuery}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await sleepMs(XHS_PACE.afterNavigateMs);
      }

      // 只靠 URL 进 Tab（禁止点「笔记」文案，易误进作品页 user_posted）
      // 若 URL 被踢偏，再点「收藏/点赞」主 Tab
      const onRightTab =
        (kind === "collect" && /[?&]tab=fav\b/i.test(page.url())) ||
        (kind === "liked" && /[?&]tab=liked\b/i.test(page.url()));
      if (!onRightTab) {
        await page.evaluate((tabLabels: string[]) => {
          const tabNodes = Array.from(
            document.querySelectorAll<HTMLElement>(
              "[class*='reds-tab'], [class*='tab-item'], [role='tab']",
            ),
          );
          const hit = tabNodes.find((el) => {
            const t = (el.textContent || "").trim();
            return tabLabels.some((l) => t === l || t.startsWith(l));
          });
          if (hit) hit.click();
        }, cfg.tabLabels);
        await sleepMs(XHS_PACE.afterTabClickMs);
      }

      const harvestDom = async () => {
        const fromDom = await page.evaluate(() => {
          const out: Array<{ noteId: string; title: string; url: string; author?: string }> = [];
          for (const sec of Array.from(
            document.querySelectorAll<HTMLElement>("section.note-item"),
          )) {
            const noteId = (sec.getAttribute("data-note-id") || "").trim();
            if (!noteId || noteId.length < 6) continue;
            if (out.some((x) => x.noteId === noteId)) continue;
            const title =
              sec.querySelector(".title span")?.textContent?.trim() ||
              sec.querySelector(".title")?.textContent?.trim() ||
              "";
            const author =
              sec.querySelector(".author .name, .name")?.textContent?.trim() || undefined;
            const a = sec.querySelector<HTMLAnchorElement>('a[href*="/explore/"]');
            out.push({
              noteId,
              title: (title || `笔记 ${noteId}`).slice(0, 200),
              author,
              url: a?.href || `https://www.xiaohongshu.com/explore/${noteId}`,
            });
          }
          return out;
        });
        ingestParsedNotes(kind, fromDom);
      };

      await harvestDom();
      progress.setMessage(
        `小步慢滚「${cfg.label}」（约 ${scrollRounds} 步，每步等列表 API，noteId 去重）…`,
      );

      let stagnant = 0;
      for (
        let i = 0;
        i < scrollRounds &&
        notes.filter((n) => n.kind === kind).length < maxItems &&
        !stoppedEarlyByKind[kind];
        i++
      ) {
        throwIfInboxSyncAborted(shouldAbort);
        const before = notes.filter((n) => n.kind === kind).length;
        const delta =
          XHS_PACE.scrollDeltaMin +
          Math.floor(
            Math.random() * (XHS_PACE.scrollDeltaMax - XHS_PACE.scrollDeltaMin + 1),
          );
        const latestBefore = notes.filter((n) => n.kind === kind).at(-1);
        progress.setMessage(
          `滚动「${cfg.label}」${i + 1}/${scrollRounds} · 已扫 ${before} 条` +
            (latestBefore ? ` · 最近：${clipTitle(latestBefore.title, 36)}` : " · 等待列表 API…"),
        );

        const waitApi = page
          .waitForResponse(
            (r) => cfg.apiPattern.test(r.url()) && r.ok(),
            { timeout: XHS_PACE.scrollApiWaitMs },
          )
          .catch(() => null);
        await page.mouse.wheel(0, delta);
        const resp = await waitApi;
        if (resp) {
          const json = await resp.json().catch(() => null);
          if (json) {
            hitApiUrls.push(resp.url().split("?")[0] ?? resp.url());
            ingestParsedNotes(kind, parseXhsNotesFromApiJson(json, kind));
          }
        }
        await harvestDom();
        await sleepRandomMs(XHS_PACE.scrollGapMinMs, XHS_PACE.scrollGapMaxMs);

        const after = notes.filter((n) => n.kind === kind).length;
        const latest = notes.filter((n) => n.kind === kind).at(-1);
        if (after > before && latest) {
          progress.pushRecent(
            `滚动「${cfg.label}」${i + 1}/${scrollRounds} · 本步 +${after - before} · 共 ${after} · ${clipTitle(latest.title, 36)}`,
          );
        }
        if (after === before) stagnant += 1;
        else stagnant = 0;
        if (stagnant >= XHS_PACE.scrollStagnantStop) break;
      }

      if (notes.filter((n) => n.kind === kind).length === beforeCount) {
        const pageUrl = page.url();
        const pageTitle = await page.title().catch(() => "");
        errors.push(
          `未采集到「${cfg.label}」笔记（登录态≠列表可抓）。当前页: ${pageTitle || "?"} · ${pageUrl}` +
            (hitApiUrls.length ? ` · 已命中 API ${hitApiUrls.length} 次` : " · 未命中列表 API") +
            "。请确认该 Tab 有内容；同步时会弹有头 Chrome 窗口勿立刻关掉。",
        );
        try {
          const shotDir = path.join(getInboxRoot(config), "xhs");
          fs.mkdirSync(shotDir, { recursive: true });
          await page.screenshot({
            path: path.join(shotDir, `empty-${kind}-${Date.now()}.png`),
            fullPage: false,
          });
        } catch {
          /* ignore */
        }
      }
    }

    // 先等列表阶段落盘队列排空，再 feed 补全
    await persistChain;

    // 关窗前少量 feed 补 sourceAt + 占位标题（刻意限速，防风控）
    const missingTime = notes.filter((n) => !n.publishedAtMs).length;
    const missingTitle = notes.filter((n) => isXhsPlaceholderTitle(n.title, n.noteId)).length;
    if (notes.length > 0 && (missingTime > 0 || missingTitle > 0)) {
      const needN = notes.filter(
        (n) => !n.publishedAtMs || isXhsPlaceholderTitle(n.title, n.noteId),
      ).length;
      const enrichCap = mode === "full" ? XHS_PACE.feedMaxFull : XHS_PACE.feedMaxIncremental;
      const enrichMax = Math.min(enrichCap, needN);
      // feed 阶段：进度条跟 15/24 走（此前只改 message、done/total 仍为 0 → 条卡在 8%）
      progress.setProgress(
        0,
        enrichMax,
        `慢速补拉 feed：缺时间 ${missingTime} / 占位标题 ${missingTitle}（最多 ${enrichMax} 条，间隔 10–30s）…`,
      );
      const { timeFilled, titleFilled } = await enrichXhsNotesFromFeed(page, notes, {
        max: enrichMax,
        shouldAbort,
        onTick: (done, total, note) => {
          // pushRecent 会写 message；再 setProgress 刷新 done/total
          progress.pushRecent(`补拉 feed ${done}/${total} · ${describeNote(note)}`);
          progress.setProgress(done, total);
        },
      });
      if (timeFilled > 0 || titleFilled > 0) {
        progress.setProgress(
          enrichMax,
          enrichMax,
          `已补全时间 ${timeFilled}、标题 ${titleFilled}，正在回写已落盘条目…`,
        );
        // 已落盘条目用 enrich 后的标题/时间再写一遍
        for (const note of notes) {
          if (written.has(noteKey(note))) enqueuePersist(note);
        }
      } else if (missingTime > 0) {
        errors.push(
          "小红书列表未返回发帖时间，且 feed 补拉未拿到 time（可能缺 xsec_token 或风控）。卡片将显示「收录」时间；可稍后全量再同步重试。",
        );
      }
    }

    activeKind = null;
    await persistChain;
    await context.close().catch(() => {});
  } catch (err) {
    errors.push(`小红书同步失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await persistChain.catch(() => {});
    await browser?.close().catch(() => {});
  }

  for (const kind of uniqueKinds) {
    if (result.byKind![kind]) {
      result.byKind![kind]!.stoppedEarly = Boolean(stoppedEarlyByKind[kind]);
    }
  }

  return result;
}
