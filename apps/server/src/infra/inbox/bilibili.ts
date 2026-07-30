/**
 * B 站 Inbox 同步
 */

import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import { loadCookies } from "../cookieJar.js";
import { getPlatformStorageStatePath } from "../metablog/auth/platformLogin.js";
import {
  ensureInboxDirs,
  throwIfInboxSyncAborted,
  upsertInboxItem,
  shouldStopIncrementalKnownStreak,
  InboxSyncProgressTracker,
  truncate,
  cookiesToHeader,
  type InboxSyncProgressFn,
  type InboxSyncResult,
  type BilibiliSyncMode,
  type BilibiliSyncKind,
} from "./shared.js";

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
    await import("../metablog/platform/fetcher.js");
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
    /** 入库上限；列表仍可扫到 maxItems */
    maxUpsert?: number;
    fetchContent?: boolean;
    maxChars?: number;
    onProgress?: InboxSyncProgressFn;
    shouldAbort?: () => boolean;
  },
): Promise<InboxSyncResult> {
  const dirs = ensureInboxDirs(config);
  const mode: BilibiliSyncMode = opts.mode ?? "incremental";
  const maxItems = opts.maxItems ?? (mode === "full" ? 2000 : 200);
  const progress = new InboxSyncProgressTracker(opts.onProgress);
  const shouldAbort = opts.shouldAbort;
  throwIfInboxSyncAborted(shouldAbort);
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
        let streakKnown = 0;
        let pn = 1;
        const ps = 20;

        while (folderScanned < maxItems) {
          throwIfInboxSyncAborted(shouldAbort);
          const pageJson = await bilibiliFetchJson(
            `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folder.id}&pn=${pn}&ps=${ps}&order=mtime`,
            cookieHeader,
          );
          const { items, hasMore } = parseBilibiliFavMediasJson(pageJson);
          if (!items.length) break;

          for (const item of items) {
            if (folderScanned >= maxItems) break;
            const isNew = !existingBvids.has(item.bvid);
            if (isNew) streakKnown = 0;
            else streakKnown += 1;
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
            if (
              mode === "incremental" &&
              existingBvids.size > 0 &&
              shouldStopIncrementalKnownStreak(streakKnown)
            ) {
              stoppedEarly = true;
              stoppedEarlyByKind.fav = true;
              break;
            }
          }

          if (stoppedEarly) break;
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
      let streakKnown = 0;
      let taken = 0;
      for (const item of list) {
        if (taken >= maxItems) break;
        const isNew = !existingBvids.has(item.bvid);
        if (isNew) streakKnown = 0;
        else streakKnown += 1;
        videos.push({
          kind: "toview",
          bvid: item.bvid,
          title: item.title,
          url: `https://www.bilibili.com/video/${item.bvid}`,
          author: item.author,
          intro: item.intro,
        });
        taken += 1;
        if (
          mode === "incremental" &&
          existingBvids.size > 0 &&
          shouldStopIncrementalKnownStreak(streakKnown)
        ) {
          stoppedEarlyByKind.toview = true;
          break;
        }
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

  const videosForWrite =
    opts.maxUpsert != null && opts.maxUpsert > 0
      ? uniqueVideos.slice(0, opts.maxUpsert)
      : uniqueVideos;

  progress.setTotal(videosForWrite.length);

  for (const video of videosForWrite) {
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
      progress.success();
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${video.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.byKind?.fav) result.byKind.fav.stoppedEarly = Boolean(stoppedEarlyByKind.fav);
  if (result.byKind?.toview) result.byKind.toview.stoppedEarly = Boolean(stoppedEarlyByKind.toview);

  return result;
}
