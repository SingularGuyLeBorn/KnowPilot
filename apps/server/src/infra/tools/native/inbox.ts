/**
 * 知识 Inbox native 工具 — 截图 / 知乎 / 小红书 / 微信公众号
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
  if (!collectionUrl) throw new Error("collectionUrl 必填（知乎收藏夹链接）");
  return ctx.services.inbox.syncZhihu({
    collectionUrl,
    maxItems: typeof args.maxItems === "number" ? args.maxItems : 50,
    fetchContent: coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
  });
}

async function inboxSyncXhs(args: Record<string, unknown>, ctx: NativeToolContext) {
  return ctx.services.inbox.syncXhs({
    maxItems: typeof args.maxItems === "number" ? args.maxItems : 50,
    fetchContent: coerceToolBoolean(args.fetchContent),
    maxChars: typeof args.maxChars === "number" ? args.maxChars : 12000,
  });
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
      "列出知识 Inbox 待消化素材（截图/知乎收藏/小红书收藏/微信公众号）。status=fetched 待处理，distilled 已成文，ignored 已丢弃。",
    concurrencyClass: "B",
    parameters: {
      type: "object",
      properties: {
        page: { type: "number" },
        pageSize: { type: "number" },
        keyword: { type: "string" },
        source: { type: "string", enum: ["screenshot", "zhihu", "xhs", "wechat", "url"] },
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
      "把单个链接（知乎/小红书/微信公众号/任意网页）抓取正文写入 Inbox。需登录态的内容先 platform_login。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        source: { type: "string", enum: ["screenshot", "zhihu", "xhs", "wechat", "url"] },
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
        source: { type: "string", enum: ["zhihu", "xhs", "wechat", "url"] },
        fetchContent: { type: "boolean" },
        maxChars: { type: "number" },
      },
    },
  },
  {
    name: "inbox_sync_zhihu",
    description:
      "同步知乎收藏夹条目到 Inbox。参数 collectionUrl 如 https://www.zhihu.com/collection/123。需先 platform_login(platform=zhihu)。默认只拉列表；fetchContent=true 时逐篇抓正文（较慢）。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      required: ["collectionUrl"],
      properties: {
        collectionUrl: { type: "string" },
        maxItems: { type: "number" },
        fetchContent: { type: "boolean", description: "是否立即抓每篇正文，默认 false" },
        maxChars: { type: "number" },
      },
    },
  },
  {
    name: "inbox_sync_xhs",
    description:
      "同步小红书「我的收藏」到 Inbox。需先 platform_login(platform=xhs)。默认只拉列表；fetchContent=true 时逐篇抓正文。",
    concurrencyClass: "C",
    parameters: {
      type: "object",
      properties: {
        maxItems: { type: "number" },
        fetchContent: { type: "boolean" },
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
  inbox_sync_zhihu: inboxSyncZhihu,
  inbox_sync_xhs: inboxSyncXhs,
  inbox_scan_screenshots: inboxScanScreenshots,
  inbox_ingest_wechat: inboxIngestWechat,
  inbox_distill: inboxDistill,
  inbox_ignore: inboxIgnore,
};

export function registerInboxTools(): void {
  registerNativeDomain(INBOX_DEFS, INBOX_HANDLERS);
}
