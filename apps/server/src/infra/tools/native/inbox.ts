/**
 * 知识 Inbox native 工具 — 截图 / 知乎 / 小红书 / B 站 / 微信公众号
 */

import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";
import { coerceToolBoolean } from "./types.js";

async function inboxList(args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.services.inbox.list({
    page: typeof args.page === "number" ? args.page : 1,
    pageSize: typeof args.pageSize === "number" ? args.pageSize : 20,
    keyword: typeof args.keyword === "string" ? args.keyword : undefined,
    source: typeof args.source === "string" ? (args.source as any) : undefined,
    status: typeof args.status === "string" ? (args.status as any) : undefined,
    orderBy: "capturedAt",
    order: "desc",
  });
}

async function inboxStats(_args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.services.inbox.stats();
}

async function inboxCaptureUrl(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 必填");
  return ctx.services.inbox.captureUrl({
    url,
    source: typeof args.source === "string" ? (args.source as any) : undefined,
    fetchContent: args.fetchContent === undefined ? true : coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
  });
}

async function inboxCaptureUrls(args: Record<string, unknown>, ctx: NativeToolContext) {
  const urls = Array.isArray(args.urls) ? args.urls.map(String) : [];
  if (!urls.length) throw new Error("urls 不能为空");
  return ctx.services.inbox.captureUrls({
    urls,
    source: typeof args.source === "string" ? (args.source as any) : undefined,
    fetchContent: args.fetchContent === undefined ? true : coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
  });
}

async function inboxSyncZhihu(args: Record<string, unknown>, ctx: NativeToolContext) {
  const collectionUrl = String(args.collectionUrl || "").trim();
  const mode = args.mode === "full" ? "full" : "incremental";
  return ctx.services.inbox.syncZhihu({
    collectionUrl: collectionUrl || undefined,
    mode,
    maxCollections: typeof args.maxCollections === "number" ? args.maxCollections : 50,
    maxItemsPerCollection:
      typeof args.maxItemsPerCollection === "number" ? args.maxItemsPerCollection : 5000,
    maxItems: typeof args.maxItems === "number" ? args.maxItems : undefined,
    fetchContent: coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
  });
}

async function inboxSyncXhs(args: Record<string, unknown>, ctx: NativeToolContext) {
  const rawKinds = Array.isArray(args.kinds) ? args.kinds.map(String) : [];
  const kinds = rawKinds.filter((k): k is "liked" | "collect" => k === "liked" || k === "collect");
  const mode = args.mode === "full" ? "full" : "incremental";
  return ctx.services.inbox.syncXhs({
    kinds: kinds.length ? kinds : ["liked", "collect"],
    mode,
    maxItems:
      typeof args.maxItems === "number" ? args.maxItems : mode === "full" ? 2000 : 200,
    fetchContent: coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
  });
}

async function inboxSyncBilibili(args: Record<string, unknown>, ctx: NativeToolContext) {
  const rawKinds = Array.isArray(args.kinds) ? args.kinds.map(String) : [];
  const kinds = rawKinds.filter((k): k is "fav" | "toview" => k === "fav" || k === "toview");
  const mode = args.mode === "full" ? "full" : "incremental";
  return ctx.services.inbox.syncBilibili({
    kinds: kinds.length ? kinds : ["fav", "toview"],
    mode,
    maxItems:
      typeof args.maxItems === "number" ? args.maxItems : mode === "full" ? 2000 : 200,
    maxFolders: typeof args.maxFolders === "number" ? args.maxFolders : 50,
    fetchContent: coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
  });
}

/** 与 UI「平台同步」同通道：后台任务立即返回 jobId，不堵对话 */
async function inboxStartPlatformSync(args: Record<string, unknown>, ctx: NativeToolContext) {
  const mode = args.mode === "full" ? "full" : "incremental";
  const job = await ctx.services.inbox.startPlatformSync({
    mode,
    zhihu: args.zhihu === undefined ? true : coerceToolBoolean(args.zhihu),
    xhs: args.xhs === undefined ? true : coerceToolBoolean(args.xhs),
    bilibili: args.bilibili === undefined ? true : coerceToolBoolean(args.bilibili),
    screenshots: args.screenshots === undefined ? true : coerceToolBoolean(args.screenshots),
    wechat: args.wechat === undefined ? true : coerceToolBoolean(args.wechat),
    maxItems: typeof args.maxItems === "number" ? args.maxItems : undefined,
    maxUpsert: typeof args.maxUpsert === "number" ? args.maxUpsert : undefined,
    probe: coerceToolBoolean(args.probe),
    fetchContent: coerceToolBoolean(args.fetchContent),
  });
  return {
    ...job,
    hint: "已启动后台同步。用 inbox_platform_sync_status 查进度；完成后到 /inbox 浏览。长时全量请优先本工具，勿用 inbox_sync_* 堵对话。",
  };
}

async function inboxPlatformSyncStatus(args: Record<string, unknown>, ctx: NativeToolContext) {
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  if (jobId) {
    return ctx.services.inbox.getPlatformSyncProgress(jobId);
  }
  const [active, latest] = await Promise.all([
    ctx.services.inbox.getActivePlatformSync(),
    ctx.services.inbox.getLatestPlatformSync(),
  ]);
  return {
    active,
    latest,
    hint: active
      ? `同步进行中 jobId=${active.id}${active.currentLabel ? ` · ${active.currentLabel}` : ""}`
      : latest
        ? `无进行中任务；最近一次 ${latest.status} jobId=${latest.id}`
        : "尚无同步任务",
  };
}

async function inboxCancelPlatformSync(args: Record<string, unknown>, ctx: NativeToolContext) {
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : undefined;
  return ctx.services.inbox.cancelPlatformSync(jobId || undefined);
}

async function inboxScanScreenshots(args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.services.inbox.scanScreenshots({
    dir: typeof args.dir === "string" ? args.dir : undefined,
    maxFiles: typeof args.maxFiles === "number" ? args.maxFiles : 50,
    runOcr: args.runOcr === undefined ? true : coerceToolBoolean(args.runOcr),
  });
}

async function inboxIngestWechat(args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.services.inbox.ingestWechatDrop({
    fetchContent: args.fetchContent === undefined ? true : coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
    maxUrls: typeof args.maxUrls === "number" ? args.maxUrls : 50,
  });
}

async function inboxDistill(args: Record<string, unknown>, ctx: NativeToolContext) {
  const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
  if (!ids.length) throw new Error("ids 不能为空");
  return ctx.services.inbox.distill({
    ids,
    garden: typeof args.garden === "string" ? args.garden : ctx.config.inbox.defaultGarden || "knowledge",
    published: coerceToolBoolean(args.published),
  });
}

async function inboxIgnore(args: Record<string, unknown>, ctx: NativeToolContext) {
  const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
  if (!ids.length) throw new Error("ids 不能为空");
  return ctx.services.inbox.ignoreItems({ ids });
}

const INBOX_DEFS: NativeToolDefinition[] = [
  {
    name: "inbox_list",
    description:
      "列出知识 Inbox 待消化素材（截图/知乎收藏/小红书点赞与收藏/B站收藏与稍后再看/微信公众号）。status=fetched 待处理，distilled 已成文，ignored 已丢弃。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      properties: {
        page: { type: "number" },
        pageSize: { type: "number" },
        keyword: { type: "string" },
        source: { type: "string", enum: ["screenshot", "zhihu", "xhs", "wechat", "bilibili", "url"] },
        status: { type: "string", enum: ["fetched", "distilled", "ignored"] },
      },
    },
  },
  {
    name: "inbox_stats",
    description: "Inbox 数量统计与截图监视目录、默认蒸馏花园。",
    concurrencyClass: "B",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inbox_capture_url",
    description:
      "把单个链接（知乎/小红书/B站/微信公众号/任意网页）抓取正文写入 Inbox。需登录态的内容先 platform_login。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        source: { type: "string", enum: ["screenshot", "zhihu", "xhs", "wechat", "bilibili", "url"] },
        fetchContent: { type: "boolean", description: "是否抓正文，默认 true" },
        maxChars: { type: "number" },
      },
    },
  },
  {
    name: "inbox_capture_urls",
    description: "批量把链接写入 Inbox（适合粘贴一批公众号/文章链接）。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      required: ["urls"],
      properties: {
        urls: { type: "array", items: { type: "string" } },
        source: { type: "string", enum: ["zhihu", "xhs", "wechat", "bilibili", "url"] },
        fetchContent: { type: "boolean" },
        maxChars: { type: "number" },
      },
    },
  },
  {
    name: "inbox_start_platform_sync",
    description:
      "【Tier 1·推荐】后台批量同步 Inbox（与 /platform-sync 同通道）。后端有序：知乎 openapi→cookie；小红书/B站需登录。立即返回 jobId；查进度 inbox_platform_sync_status。先 platform_doctor/browser_login_status。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["full", "incremental"], description: "默认 incremental" },
        zhihu: { type: "boolean", description: "默认同步知乎" },
        xhs: { type: "boolean", description: "默认同步小红书" },
        bilibili: { type: "boolean", description: "默认同步 B 站" },
        screenshots: { type: "boolean", description: "默认扫截图目录" },
        wechat: { type: "boolean", description: "默认读微信 links.txt" },
        maxItems: { type: "number" },
        maxUpsert: { type: "number", description: "实际入库上限（试跑）" },
        probe: { type: "boolean", description: "试跑：列表少、入库少，验证登录态" },
        fetchContent: { type: "boolean", description: "默认 false（只拉列表）" },
      },
    },
  },
  {
    name: "inbox_platform_sync_status",
    description:
      "查询平台批量同步进度。传 jobId 查指定任务；不传则返回当前进行中 + 最近一次。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "可选；inbox_start_platform_sync 返回的 jobId" },
      },
    },
  },
  {
    name: "inbox_cancel_platform_sync",
    description: "取消进行中的平台批量同步。不传 jobId 则取消当前活跃任务。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string" },
      },
    },
  },
  {
    name: "inbox_sync_zhihu",
    description:
      "【Tier 1·同步执行会堵对话】知乎收藏。后端：openapi→cookie_api→playwright。日常用 inbox_start_platform_sync。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        collectionUrl: {
          type: "string",
          description: "可选；如 https://www.zhihu.com/collection/123；不填同步全部收藏夹",
        },
        mode: { type: "string", enum: ["full", "incremental"], description: "默认 incremental" },
        maxCollections: { type: "number", description: "最多同步多少个收藏夹，默认 50" },
        maxItemsPerCollection: { type: "number", description: "每夹最多条数，默认 5000" },
        maxItems: { type: "number", description: "覆盖 maxItemsPerCollection 的每夹上限" },
        fetchContent: { type: "boolean", description: "是否立即抓每篇正文，默认 false" },
        maxChars: { type: "number" },
      },
    },
  },
  {
    name: "inbox_sync_xhs",
    description:
      "【Tier 1·同步执行会堵对话】小红书点赞/收藏。后端：storage_state_playwright。日常用 inbox_start_platform_sync；需 platform_login(xhs)。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        kinds: {
          type: "array",
          items: { type: "string", enum: ["liked", "collect"] },
          description: '默认 ["liked","collect"]；liked=点赞，collect=收藏',
        },
        mode: { type: "string", enum: ["full", "incremental"], description: "默认 incremental" },
        maxItems: { type: "number", description: "每种最多条数；incremental 默认 200，full 默认 2000" },
        fetchContent: { type: "boolean" },
        maxChars: { type: "number" },
      },
    },
  },
  {
    name: "inbox_sync_bilibili",
    description:
      "【Tier 1·同步执行会堵对话】B站收藏/稍后再看。后端：cookie_api(SESSDATA)。日常用 inbox_start_platform_sync。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        kinds: {
          type: "array",
          items: { type: "string", enum: ["fav", "toview"] },
          description: '默认 ["fav","toview"]；fav=收藏夹，toview=稍后再看',
        },
        mode: { type: "string", enum: ["full", "incremental"], description: "默认 incremental" },
        maxItems: { type: "number", description: "每夹/稍后再看最多条数" },
        maxFolders: { type: "number", description: "最多同步多少个收藏夹，默认 50" },
        fetchContent: { type: "boolean", description: "是否抓字幕摘要，默认 false" },
        maxChars: { type: "number" },
      },
    },
  },
  {
    name: "inbox_scan_screenshots",
    description:
      "扫描截图目录（默认 data/inbox/screenshots/drop 或 config.yaml inbox.screenshotWatchDir），OCR 后写入 Inbox，并归档原图。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "覆盖默认监视目录" },
        maxFiles: { type: "number" },
        runOcr: { type: "boolean", description: "默认 true" },
      },
    },
  },
  {
    name: "inbox_ingest_wechat",
    description:
      "读取 data/inbox/wechat/links.txt（每行一个公众号/网页链接）入库，已处理行归档到 links.done.txt。也可直接用 inbox_capture_urls。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        fetchContent: { type: "boolean" },
        maxChars: { type: "number" },
        maxUrls: { type: "number" },
      },
    },
  },
  {
    name: "inbox_distill",
    description:
      "把 Inbox 条目蒸馏为 knowledge 花园未发布 Post 草稿（可用 garden 覆盖）。适合批量落库；若需深度改写可先 inbox_list 读内容再 post_create。",
    concurrencyClass: "D",
    destructive: true,
    approvalExempt: true,
    parameters: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: { type: "array", items: { type: "string" } },
        garden: { type: "string", description: "默认 knowledge" },
        published: { type: "boolean", description: "默认 false（草稿）" },
      },
    },
  },
  {
    name: "inbox_ignore",
    description: "忽略 Inbox 条目（不再出现在待消化列表）。",
    concurrencyClass: "D",
    destructive: true,
    approvalExempt: true,
    parameters: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
    },
  },
];

const INBOX_HANDLERS: Record<string, NativeToolHandler> = {
  inbox_list: inboxList,
  inbox_stats: inboxStats,
  inbox_capture_url: inboxCaptureUrl,
  inbox_capture_urls: inboxCaptureUrls,
  inbox_start_platform_sync: inboxStartPlatformSync,
  inbox_platform_sync_status: inboxPlatformSyncStatus,
  inbox_cancel_platform_sync: inboxCancelPlatformSync,
  inbox_sync_zhihu: inboxSyncZhihu,
  inbox_sync_xhs: inboxSyncXhs,
  inbox_sync_bilibili: inboxSyncBilibili,
  inbox_scan_screenshots: inboxScanScreenshots,
  inbox_ingest_wechat: inboxIngestWechat,
  inbox_distill: inboxDistill,
  inbox_ignore: inboxIgnore,
};

export function registerInboxTools(): void {
  registerNativeDomain(INBOX_DEFS, INBOX_HANDLERS);
}
