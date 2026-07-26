/**
 * Native Web 域 — search / RSS / article / scrape / screenshot / read_image
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AppConfig } from "../../config.js";
import {
  smartSearch,
  parsePlatformUrl,
  scrapePage,
  screenshotPage,
  getSharedBrowser,
  resetSearchEngineConfigs,
  detectPlatform,
  isArticleFetchFatalError,
  type SearchEngineName,
} from "../../metablog/index.js";
import { fetchWithTimeout } from "../../metablog/search/engines.js";
import { downloadImageToTemp, ocrRemoteImage } from "../../metablog/ocrBridge.js";
import { performOcrFromFile } from "../../ocrService.js";
import { resilientChatCompletion } from "../../resilientLlmClient.js";
import { resolveSafePath } from "../../safePath.js";
import { isSmokeInfoSource } from "../../smokeArtifacts.js";
import {
  fetchBilibiliPagelistCid,
  fetchBilibiliSubtitleExcerpt,
  fetchBilibiliAiConclusion,
} from "../../metablog/platform/fetcher.js";
import { YouTubeTranscriptApi } from "youtube-transcript-api-js";
import {
  AGENT_TOOL_RESULT_MAX_CHARS,
  LLM_MODEL_IDS,
  resolveModelSupportsVision,
} from "@knowpilot/shared";
import type { NativeToolContext, NativeToolDefinition } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

interface InfoSourceSnapshot {
  name: string;
  slug?: string | null;
  url: string;
  type: string;
  description: string;
  reliability: number;
}

async function loadEnabledInfoSources(ctx: NativeToolContext): Promise<InfoSourceSnapshot[]> {
  if (!ctx.services?.infoSource?.list) return [];
  try {
    const items: Array<{
      name: string;
      url: string;
      type: string;
      description: string | null;
      reliability: number;
      sourceSlug?: string | null;
    }> = [];
    let page = 1;
    while (true) {
      const result = await ctx.services.infoSource.list({ page, pageSize: 100, enabled: true });
      items.push(...result.items);
      if (page >= result.totalPages) break;
      page += 1;
    }
    return items
      .filter((s) => !isSmokeInfoSource(s.name, s.sourceSlug))
      .slice()
      .sort((a, b) => b.reliability - a.reliability)
      .map((s) => ({
        name: s.name,
        slug: s.sourceSlug,
        url: s.url,
        type: s.type,
        description: s.description ?? "",
        reliability: s.reliability,
      }));
  } catch {
    return [];
  }
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function getInfoSourceDomains(sources: InfoSourceSnapshot[]): string[] {
  const domains = new Set<string>();
  for (const source of sources) {
    const domain = extractDomain(source.url);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

function summarizeInfoSources(sources: InfoSourceSnapshot[]) {
  return sources.map((s) => ({ name: s.name, url: s.url, reliability: s.reliability, type: s.type }));
}

function scoreInfoSourceMatch(source: InfoSourceSnapshot, query: string): number {
  const q = query.toLowerCase().trim();
  let score = source.reliability;
  const haystack = `${source.name} ${source.description} ${source.url} ${source.type}`.toLowerCase();
  if (q && haystack.includes(q)) score += 10;
  for (const word of q.split(/\s+/).filter((w) => w.length > 1)) {
    if (haystack.includes(word)) score += 2;
  }
  return score;
}

function buildInfoSourceCatalogResults(
  sources: InfoSourceSnapshot[],
  query: string,
  maxResults: number,
) {
  return sources
    .map((source) => ({ source, score: scoreInfoSourceMatch(source, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ source }) => ({
      title: source.name,
      url: source.url,
      content: source.description,
      reliability: source.reliability,
      type: source.type,
    }));
}

async function tavilySearch(
  apiKey: string,
  query: string,
  maxResults: number,
  includeDomains?: string[],
) {
  const body: Record<string, unknown> = {
    api_key: apiKey,
    query,
    max_results: maxResults,
    include_answer: true,
  };
  if (includeDomains?.length) body.include_domains = includeDomains;

  // 与引擎层同源 8s 超时：scoped 阶段裸 fetch 在网络黑洞时会挂起到 OS 级超时
  const res = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily 搜索失败: HTTP ${res.status}`);
  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return {
    provider: "tavily" as const,
    answer: data.answer,
    results: (data.results || []).slice(0, maxResults),
  };
}

async function serpApiSearch(apiKey: string, query: string, maxResults: number) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(maxResults));
  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`SerpAPI 搜索失败: HTTP ${res.status}`);
  const data = (await res.json()) as { organic_results?: Array<{ title: string; link: string; snippet: string }> };
  return {
    provider: "serpapi" as const,
    results: (data.organic_results || []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    })),
  };
}

export function syncSearchEnvFromConfig(config: AppConfig) {
  const entries: Array<[string, string | undefined]> = [
    ["SEARCH_BAIDU_QIANFAN_API_KEY", config.search.baiduQianfanApiKey],
    ["SEARCH_TAVILY_API_KEY", config.search.tavilyApiKey],
    ["SEARCH_SERPAPI_API_KEY", config.search.serpApiKey],
    ["SEARCH_METASO_API_KEY", config.search.metasoApiKey],
    ["SEARCH_BOCHA_API_KEY", config.search.bochaApiKey],
    ["SEARCH_LANGSEARCH_API_KEY", config.search.langsearchApiKey],
    ["SEARCH_BRAVE_API_KEY", config.search.braveApiKey],
    ["SEARCH_BING_API_KEY", config.search.bingApiKey],
  ];
  for (const [key, val] of entries) {
    if (val) process.env[key] = val;
  }
  process.env.SEARCH_ENGINE_PRIORITY = config.search.enginePriority;
  resetSearchEngineConfigs();
}

function mapSmartSearchResponse(data: Awaited<ReturnType<typeof smartSearch>>, maxResults: number) {
  return {
    provider: data.engine,
    engine: data.engine,
    query: data.query,
    total: data.total,
    elapsedMs: data.elapsedMs,
    enginesAttempted: data.enginesAttempted,
    results: data.results.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.snippet,
      snippet: r.snippet,
      source: r.source,
    })),
  };
}

async function tryScopedInfoSourceSearch(
  args: { query: string; maxResults: number },
  ctx: NativeToolContext,
  infoSources: InfoSourceSnapshot[],
) {
  if (infoSources.length === 0) return null;

  const { query, maxResults } = args;
  const domains = getInfoSourceDomains(infoSources);
  const infoSourcesUsed = summarizeInfoSources(infoSources);
  const { tavilyApiKey, serpApiKey } = ctx.config.search;

  if (tavilyApiKey && domains.length > 0) {
    try {
      const scoped = await tavilySearch(tavilyApiKey, query, maxResults, domains);
      if (scoped.results.length > 0) {
        return { ...scoped, infoSourcesUsed, searchPhase: "infoSource-scoped" as const };
      }
    } catch {
      /* continue */
    }
  }

  if (serpApiKey && domains.length > 0) {
    try {
      const siteQuery = domains.map((d) => `site:${d}`).join(" OR ");
      const scoped = await serpApiSearch(serpApiKey, `${query} (${siteQuery})`, maxResults);
      if (scoped.results.length > 0) {
        return { ...scoped, infoSourcesUsed, searchPhase: "infoSource-scoped" as const };
      }
    } catch {
      /* continue */
    }
  }

  return null;
}

async function fallbackInfoSourceSearch(
  args: { query: string; maxResults: number },
  ctx: NativeToolContext,
  infoSources: InfoSourceSnapshot[],
) {
  const { query, maxResults } = args;
  const infoSourcesUsed = summarizeInfoSources(infoSources);
  const { tavilyApiKey, serpApiKey } = ctx.config.search;

  if (infoSources.length > 0) {
    return {
      provider: "infoSource" as const,
      query,
      results: buildInfoSourceCatalogResults(infoSources, query, maxResults),
      infoSourcesUsed,
      searchPhase: "infoSource-catalog" as const,
      note: "MetaBlog 多引擎搜索失败，回退至已启用信息源目录。",
    };
  }

  if (tavilyApiKey) {
    return {
      ...(await tavilySearch(tavilyApiKey, query, maxResults)),
      searchPhase: "general-fallback" as const,
    };
  }

  if (serpApiKey) {
    return {
      ...(await serpApiSearch(serpApiKey, query, maxResults)),
      searchPhase: "general-fallback" as const,
    };
  }

  return null;
}

async function webSearch(args: Record<string, unknown>, ctx: NativeToolContext) {
  const query = String(args.query || "");
  const maxResults = Number(args.maxResults || 5);
  const preferredEngine = args.engine ? (String(args.engine) as SearchEngineName) : undefined;
  if (!query) throw new Error("query 不能为空");

  const infoSources = await loadEnabledInfoSources(ctx);
  const infoSourcesUsed = summarizeInfoSources(infoSources);

  syncSearchEnvFromConfig(ctx.config);

  const started = Date.now();

  const scopedFirst = await tryScopedInfoSourceSearch({ query, maxResults }, ctx, infoSources);
  if (scopedFirst) {
    return { ...scopedFirst, elapsedMs: Date.now() - started };
  }

  try {
    const data = await smartSearch(query, maxResults, preferredEngine);
    return {
      ...mapSmartSearchResponse(data, maxResults),
      infoSourcesUsed: infoSources.length > 0 ? infoSourcesUsed : undefined,
      searchPhase: "smart-search" as const,
      elapsedMs: data.elapsedMs ?? Date.now() - started,
    };
  } catch (smartErr) {
    const fallback = await fallbackInfoSourceSearch({ query, maxResults }, ctx, infoSources);
    if (fallback) {
      return { ...fallback, elapsedMs: Date.now() - started };
    }
    throw smartErr instanceof Error ? smartErr : new Error(String(smartErr));
  }
}

// ============================================================================
// RSS / Atom Feed 抓取工具
// ============================================================================

async function rssFetchTool(args: Record<string, unknown>, ctx: NativeToolContext): Promise<unknown> {
  const { prisma } = ctx;
  if (!prisma) throw new Error("rss_fetch 需要 prisma");

  const { fetchRssSource, draftPostsFromRssItems } = await import("../../rssFetch.js");

  let sourceId: string | undefined;
  if (typeof args.sourceId === "string") sourceId = args.sourceId;
  else if (typeof args.sourceName === "string") {
    const found = await prisma.infoSource.findFirst({
      where: { name: args.sourceName },
      select: { id: true },
    });
    if (!found) return { error: `未找到名为 "${args.sourceName}" 的信息源` };
    sourceId = found.id;
  }
  if (!sourceId) return { error: "需要提供 sourceId 或 sourceName" };

  const maxItems = typeof args.maxItems === "number" ? Math.max(1, Math.min(50, args.maxItems)) : 20;
  const autoDraft = args.autoDraft === true;

  const result = await fetchRssSource(prisma, sourceId, { maxItems, timeoutMs: 20000 });
  if (!result.success) return { error: result.error, sourceId, sourceName: result.sourceName };

  let draftedIds: string[] = [];
  if (autoDraft && result.newCount > 0) {
    const itemIds = result.items.map((i) => i.guid); // guid here is actually the DB id? No, it's source:guid
    // Need to fetch DB ids by guid
    const items = await prisma.infoSourceItem.findMany({
      where: { sourceId, guid: { in: itemIds } },
      select: { id: true },
    });
    draftedIds = await draftPostsFromRssItems(
      prisma,
      sourceId,
      items.map((i) => i.id),
      typeof args.defaultCategory === "string" ? args.defaultCategory : "信息源",
    );
  }

  return {
    ...result,
    autoDraft,
    draftedIds,
    message: `抓取成功：${result.fetchedCount} 条，新增 ${result.newCount} 条${autoDraft ? "，已生成 " + draftedIds.length + " 篇草稿" : ""}`,
  };
}

async function rssDraftPostsTool(args: Record<string, unknown>, ctx: NativeToolContext): Promise<unknown> {
  const { prisma } = ctx;
  if (!prisma) throw new Error("rss_draft_posts 需要 prisma");
  const { draftPostsFromRssItems } = await import("../../rssFetch.js");

  const sourceId = typeof args.sourceId === "string" ? args.sourceId : undefined;
  const itemIds = Array.isArray(args.itemIds) ? args.itemIds.filter((id): id is string => typeof id === "string") : [];
  if (!sourceId || itemIds.length === 0) return { error: "需要提供 sourceId 和 itemIds 数组" };

  const draftedIds = await draftPostsFromRssItems(
    prisma,
    sourceId,
    itemIds,
    typeof args.defaultCategory === "string" ? args.defaultCategory : "信息源",
  );
  return { sourceId, draftedIds, draftedCount: draftedIds.length };
}

// 与 reactLoop snapshot.toolResultMaxChars 同源（shared AGENT_TOOL_RESULT_MAX_CHARS）
const READ_ARTICLE_MAX_CHARS = AGENT_TOOL_RESULT_MAX_CHARS;
/** 低于此字数且已通过 minReadable 校验时，提示 Agent 正文可能不完整 */
const READ_ARTICLE_SHORT_WARN_CHARS = 150;

/** read_article 是否应视为失效页（404 标题 / 平台壳页 + 正文过短） */
export function isUnreadableArticlePage(
  title: string,
  contentLength: number,
  minReadable = 80,
  content = "",
): boolean {
  if (content.includes("简书系信息发布平台") && content.includes("著作权归作者所有") && contentLength < 200) {
    return true;
  }
  if (contentLength >= minReadable) return false;
  if (/404|页面不存在|not found|找不到页面|http 404|page not found/i.test(title)) return true;
  if (content.includes("简书系信息发布平台") && content.includes("著作权归作者所有")) return true;
  return false;
}

export function readArticleContentWarning(contentLength: number, minReadable = 80): string | undefined {
  if (contentLength < minReadable || contentLength >= READ_ARTICLE_SHORT_WARN_CHARS) return undefined;
  return "正文较短";
}

function formatReadArticleFatalError(url: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  let platform = "unknown";
  try {
    platform = detectPlatform(new URL(url).hostname);
  } catch {
    /* ignore */
  }
  const hostMatch = msg.match(/\(([^)]+)\)\s*$/);
  const detail = (hostMatch?.[1] ?? msg.replace(/^页面(?:不可用|不存在)或已删除\s*/i, "").trim()) || msg;
  return new Error(`页面不可用或已删除 · ${platform} · ${detail.slice(0, 80)}`);
}

async function readArticleTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const url = String(args.url || "");
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  let result;
  try {
    result = await parsePlatformUrl({
      url,
      timeout: args.timeout !== undefined ? Number(args.timeout) : 30000,
      platform: args.platform ? String(args.platform) : undefined,
      method: args.method === "playwright" ? "playwright" : undefined,
      embedOcr: args.embedOcr !== false,
      fetchImageFiles: false,
    });
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw formatReadArticleFatalError(url, err);
    throw err;
  }

  const maxChars = Number(args.maxChars || READ_ARTICLE_MAX_CHARS);
  const offset = Math.max(0, Number(args.offset || 0));
  const fullContent = result.content ?? "";
  const content = fullContent.slice(offset);
  const truncated = content.length > maxChars;
  const title = result.title ?? "";
  const minReadable = Number(args.minChars ?? 80);
  const platform = result.platform ?? "unknown";
  const contentWarning = readArticleContentWarning(content.length, minReadable);
  if (isUnreadableArticlePage(title, content.length, minReadable, content)) {
    throw new Error(`页面不可用或已删除 · ${platform} · ${title.slice(0, 80)}`);
  }

  return {
    title: result.title,
    author: result.author,
    platform: result.platform,
    url: result.url,
    method: result.method,
    content: truncated ? content.slice(0, maxChars) : content,
    contentTruncated: truncated,
    contentChars: content.length,
    totalChars: fullContent.length,
    offset,
    nextOffset: truncated || offset + content.length < fullContent.length ? offset + Math.min(content.length, maxChars) : undefined,
    contentWarning,
    suggestedTool: contentWarning ? "scrape_web_page" : undefined,
    elapsedMs: Date.now() - started,
    images: result.images?.slice(0, 20),
    videos: result.videos,
    metadata: result.metadata,
  };
}

async function scrapeWebPageTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const url = String(args.url || "");
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  const result = await scrapePage({
    url,
    timeout: args.timeout !== undefined ? Number(args.timeout) : 30000,
    waitFor: args.waitFor ? String(args.waitFor) : undefined,
    extractArticle: args.extractArticle !== false,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error || "网页采集失败");
  }

  const { data } = result;
  let platform = "unknown";
  try {
    platform = detectPlatform(new URL(url).hostname);
  } catch {
    /* ignore */
  }

  return {
    url: data.url,
    title: data.title,
    description: data.description,
    text: data.text.slice(0, 12000),
    textChars: data.text.length,
    textTruncated: data.text.length > 12000,
    method: "playwright",
    platform,
    elapsedMs: Date.now() - started,
    links: data.links.slice(0, 30),
    images: data.images.slice(0, 20),
    metadata: data.metadata,
    scrapedAt: data.scrapedAt,
  };
}

/** 打开页面截图并落盘到 content/uploads/screenshots/，只返路径（禁止把 base64 塞进 tool result） */
async function browserScreenshotTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  const fullPage = args.fullPage === true;
  const result = await screenshotPage({
    url,
    timeout: args.timeout !== undefined ? Number(args.timeout) : 30000,
    waitFor: args.waitFor ? String(args.waitFor) : undefined,
    fullPage,
    width: args.width !== undefined ? Number(args.width) : 1280,
    height: args.height !== undefined ? Number(args.height) : 800,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error || "页面截图失败");
  }

  const { data } = result;
  const dirAbs = path.join(ctx.config.uploadDir, "screenshots");
  fs.mkdirSync(dirAbs, { recursive: true });
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
  const fileName = `${Date.now().toString(36)}-${hash}.png`;
  const absPath = path.join(dirAbs, fileName);
  fs.writeFileSync(absPath, data.buffer);

  const relPath = path
    .relative(ctx.config.projectRoot, absPath)
    .replace(/\\/g, "/");
  const publicUrl = `/uploads/screenshots/${fileName}`;

  return {
    url: data.url,
    title: data.title,
    path: relPath,
    publicUrl,
    bytes: data.buffer.length,
    width: data.width,
    height: data.height,
    fullPage: data.fullPage,
    mimeType: "image/png",
    suggestedTool: "read_image",
    suggestedArgs: { path: relPath, mode: "auto" },
    elapsedMs: Date.now() - started,
  };
}

/**
 * scroll_screenshot：分段滚动截图，解决 SPA 懒加载/长页 fullPage 截图空白问题。
 * 每次滚动一个视口高度，等待加载后截一张视口图，返回多张截图路径。
 */
async function scrollScreenshotTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  const scrollSteps = Math.min(Math.max(Number(args.scrollSteps || 5), 1), 20);
  const scrollDelay = Math.min(Math.max(Number(args.scrollDelay || 800), 200), 5000);
  const width = args.width !== undefined ? Number(args.width) : 1280;
  const height = args.height !== undefined ? Number(args.height) : 800;
  const timeout = args.timeout !== undefined ? Number(args.timeout) : 30000;

  let context: import("playwright").BrowserContext | null = null;
  try {
    const browser = await getSharedBrowser();
    context = await browser.newContext({
      viewport: { width, height },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(600);

    const dirAbs = path.join(ctx.config.uploadDir, "screenshots");
    fs.mkdirSync(dirAbs, { recursive: true });
    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
    const screenshots: Array<{ path: string; publicUrl: string; step: number }> = [];
    let title = "";
    try {
      title = await page.title();
    } catch {
      /* ignore */
    }

    for (let step = 0; step < scrollSteps; step++) {
      // 滚动前先截图（第 0 步是顶部）
      const buffer = Buffer.from(await page.screenshot({ type: "png", fullPage: false }));
      const fileName = `${Date.now().toString(36)}-${hash}-s${step}.png`;
      const absPath = path.join(dirAbs, fileName);
      fs.writeFileSync(absPath, buffer);
      const relPath = path.relative(ctx.config.projectRoot, absPath).replace(/\\/g, "/");
      screenshots.push({
        path: relPath,
        publicUrl: `/uploads/screenshots/${fileName}`,
        step,
      });
      // 滚动一个视口高度
      await page.evaluate((h) => window.scrollBy(0, h), height).catch(() => undefined);
      await page.waitForTimeout(scrollDelay);
      // 检测是否已到底（scrollY + innerHeight >= scrollHeight - 10）
      const atBottom = await page
        .evaluate(() => window.innerHeight + window.scrollY >= (document.body.scrollHeight || 0) - 10)
        .catch(() => false);
      if (atBottom && step > 0) break;
    }

    return {
      url,
      title,
      screenshots,
      count: screenshots.length,
      width,
      height,
      elapsedMs: Date.now() - started,
      suggestedTool: "read_image",
      note: "返回多张视口截图（按滚动顺序），用 read_image 逐张识图；或用 vision_describe 做语义理解",
    };
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}

/**
 * save_webpage：把网页完整保存到本地（HTML + Markdown），再 read_file 读。
 * 解决 read_article 截断、长文分段麻烦的问题——存本地后可反复读、离线读。
 */
async function saveWebpageTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  const format = String(args.format || "both") as "html" | "markdown" | "both";
  const timeout = args.timeout !== undefined ? Number(args.timeout) : 30000;

  // 抓取正文（复用 read_article 的抓取链路，含登录态复用）
  const result = await parsePlatformUrl({
    url,
    timeout,
    method: args.method === "playwright" ? "playwright" : undefined,
    embedOcr: false,
    fetchImageFiles: false,
  }).catch((err: unknown) => {
    if (isArticleFetchFatalError(err)) throw formatReadArticleFatalError(url, err);
    throw err;
  });

  const title = (result.title || "untitled").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
  const dirAbs = path.join(ctx.config.dataDir, "webpages");
  fs.mkdirSync(dirAbs, { recursive: true });

  const saved: { htmlPath?: string; markdownPath?: string } = {};
  const content = result.content ?? "";

  if (format === "html" || format === "both") {
    // 包一层基础 HTML 壳
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title></head><body><article><pre>${content.replace(/</g, "&lt;")}</pre></article></body></html>`;
    const htmlName = `${hash}-${title}.html`;
    const htmlAbs = path.join(dirAbs, htmlName);
    fs.writeFileSync(htmlAbs, html, "utf-8");
    saved.htmlPath = path.relative(ctx.config.projectRoot, htmlAbs).replace(/\\/g, "/");
  }
  if (format === "markdown" || format === "both") {
    const mdName = `${hash}-${title}.md`;
    const mdAbs = path.join(dirAbs, mdName);
    const md = `# ${title}\n\n> 来源: ${url}\n> 平台: ${result.platform ?? "unknown"}\n\n---\n\n${content}`;
    fs.writeFileSync(mdAbs, md, "utf-8");
    saved.markdownPath = path.relative(ctx.config.projectRoot, mdAbs).replace(/\\/g, "/");
  }

  return {
    url,
    title: result.title,
    author: result.author,
    platform: result.platform,
    method: result.method,
    ...saved,
    contentChars: content.length,
    elapsedMs: Date.now() - started,
    suggestedTool: "read_file",
    suggestedArgs: saved.markdownPath ? { path: saved.markdownPath } : { path: saved.htmlPath },
    note: "网页已保存到本地，用 read_file 读取完整正文（支持 offset 分段读长文）；data/webpages/ 目录下",
  };
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "image/png";
}

function resolveLocalImagePath(config: AppConfig, rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  // /uploads/... → content/uploads/...
  if (trimmed.startsWith("/uploads/")) {
    return resolveSafePath(config, `content/uploads/${trimmed.slice("/uploads/".length)}`);
  }
  return resolveSafePath(config, trimmed);
}

async function readImageWithVision(
  ctx: NativeToolContext,
  absPath: string,
  mimeType: string,
  prompt: string,
  model: string,
): Promise<{ text: string; model: string }> {
  const b64 = fs.readFileSync(absPath).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;
  const result = await resilientChatCompletion({
    config: ctx.config,
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
        ],
      },
    ],
    maxTokens: 2048,
    temperature: 0.2,
  });
  const text = (result.content ?? "").trim();
  if (!text) throw new Error("Vision 模型未返回可读描述");
  return { text, model };
}

/** 读图：OCR 或 Vision。输入 path（项目内相对路径）或 http(s)/uploads URL。 */
async function readImageTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const started = Date.now();
  const pathArg = args.path != null ? String(args.path).trim() : "";
  const urlArg = args.url != null ? String(args.url).trim() : "";
  if (!pathArg && !urlArg) {
    throw new Error("path 与 url 至少提供一个（优先用 browser_screenshot 返回的 path）");
  }

  const language = args.language != null ? String(args.language) : "auto";
  const prompt =
    args.prompt != null && String(args.prompt).trim()
      ? String(args.prompt).trim()
      : "请完整描述这张图片中的可见文字、布局与关键信息。若是截图，优先提取页面标题、正文要点与 UI 状态。";

  let mode = String(args.mode || "auto").toLowerCase() as "ocr" | "vision" | "auto";
  if (mode !== "ocr" && mode !== "vision" && mode !== "auto") mode = "auto";

  const agentModel = ctx.agentSnapshot?.model || "";
  const explicitModel = args.model != null ? String(args.model).trim() : "";
  const visionModel =
    explicitModel ||
    (resolveModelSupportsVision(agentModel) ? agentModel : LLM_MODEL_IDS.DEEPSEEK_VL2);

  if (mode === "auto") {
    mode = resolveModelSupportsVision(explicitModel || agentModel || visionModel) ? "vision" : "ocr";
  }

  // 远程 http(s) URL：vision 先下载临时文件；OCR 走 ocrRemoteImage
  if (urlArg && /^https?:\/\//i.test(urlArg) && !pathArg) {
    if (mode === "vision") {
      const tempPath = await downloadImageToTemp(urlArg);
      try {
        const mimeType = mimeFromExt(tempPath);
        const { text, model } = await readImageWithVision(ctx, tempPath, mimeType, prompt, visionModel);
        return {
          text: text.slice(0, AGENT_TOOL_RESULT_MAX_CHARS),
          textChars: text.length,
          textTruncated: text.length > AGENT_TOOL_RESULT_MAX_CHARS,
          source: "vision" as const,
          mode: "vision",
          model,
          url: urlArg,
          elapsedMs: Date.now() - started,
        };
      } finally {
        fs.unlink(tempPath, () => undefined);
      }
    }
    const ocr = await ocrRemoteImage(urlArg, language);
    if (!ocr.success || !ocr.text) {
      throw new Error(ocr.error || "远程图片 OCR 失败");
    }
    return {
      text: ocr.text.slice(0, AGENT_TOOL_RESULT_MAX_CHARS),
      textChars: ocr.text.length,
      textTruncated: ocr.text.length > AGENT_TOOL_RESULT_MAX_CHARS,
      source: "ocr" as const,
      mode: "ocr",
      engine: ocr.engine,
      url: urlArg,
      elapsedMs: Date.now() - started,
    };
  }

  const absPath = resolveLocalImagePath(ctx.config, pathArg || urlArg);
  if (!fs.existsSync(absPath)) {
    throw new Error(`图片文件不存在: ${pathArg || urlArg}`);
  }
  const mimeType = mimeFromExt(absPath);

  if (mode === "vision") {
    const { text, model } = await readImageWithVision(ctx, absPath, mimeType, prompt, visionModel);
    return {
      text: text.slice(0, AGENT_TOOL_RESULT_MAX_CHARS),
      textChars: text.length,
      textTruncated: text.length > AGENT_TOOL_RESULT_MAX_CHARS,
      source: "vision" as const,
      mode: "vision",
      model,
      path: pathArg || urlArg,
      elapsedMs: Date.now() - started,
    };
  }

  const ocr = await performOcrFromFile(ctx.config, absPath, language);
  if (!ocr.success || !ocr.text) {
    throw new Error(ocr.error || "OCR 失败");
  }
  return {
    text: ocr.text.slice(0, AGENT_TOOL_RESULT_MAX_CHARS),
    textChars: ocr.text.length,
    textTruncated: ocr.text.length > AGENT_TOOL_RESULT_MAX_CHARS,
    source: "ocr" as const,
    mode: "ocr",
    engine: ocr.engine,
    path: pathArg || urlArg,
    elapsedMs: Date.now() - started,
  };
}

/**
 * 外挂视觉理解器默认模型选择顺序（国内优先、免费优先）：
 * 1. env VISION_DESCRIBE_MODEL（显式覆盖）
 * 2. 当前 Agent 模型若支持 vision → 复用（不额外计费切换）
 * 3. 智谱 zhipu provider 配了 key → glm-4.1v-thinking-flash（免费、国内直连、无需代理）★ 国内首选
 * 4. Kimi provider 配了 key → kimi-k2.5（注册送免费额度、国内直连、多模态）
 * 5. Gemini provider 配了 key → gemini-2.0-flash（国外，国内需代理）
 * 6. OpenRouter provider 配了 key → google/gemma-4-26b-a4b-it:free（国外，需代理）
 * 7. deepseek-vl2 兜底（付费）
 */
function resolveDefaultVisionModel(ctx: NativeToolContext): string {
  const explicit = process.env.VISION_DESCRIBE_MODEL?.trim();
  if (explicit) return explicit;
  const agentModel = ctx.agentSnapshot?.model || "";
  if (agentModel && resolveModelSupportsVision(agentModel)) return agentModel;
  const providers = ctx.config.llm.providers;
  if (providers.zhipu?.apiKey?.trim()) return "glm-4.1v-thinking-flash";
  if (providers.kimi?.apiKey?.trim()) return "kimi-k2.5";
  if (providers.gemini?.apiKey?.trim()) return providers.gemini.model || "gemini-2.0-flash";
  if (providers.openrouter?.apiKey?.trim()) return "google/gemma-4-26b-a4b-it:free";
  return LLM_MODEL_IDS.DEEPSEEK_VL2;
}

/**
 * vision_describe — 外挂视觉理解器。
 * 让纯文本模型把图片交给免费多模态模型理解，返回文字描述作为参考。
 * 与 read_image 区别：read_image 偏 OCR/文字提取（auto 优先 OCR）；
 * vision_describe 强制 vision 语义理解/描述/问答，默认用免费多模态模型，不消耗付费额度。
 */
async function visionDescribeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const started = Date.now();
  const pathArg = args.path != null ? String(args.path).trim() : "";
  const urlArg = args.url != null ? String(args.url).trim() : "";
  if (!pathArg && !urlArg) {
    throw new Error("path 与 url 至少提供一个（path 优先；url 为 http(s) 或 /uploads/...）");
  }

  const question =
    args.question != null && String(args.question).trim()
      ? String(args.question).trim()
      : "请详细描述这张图片的内容：包含主体对象、场景、布局、可见文字、颜色与关键视觉信息。若是图表/截图，提取关键数据与 UI 状态。";
  const model = args.model != null && String(args.model).trim() ? String(args.model).trim() : resolveDefaultVisionModel(ctx);

  // 远程 http(s) URL：下载到临时文件再走 vision
  if (urlArg && /^https?:\/\//i.test(urlArg) && !pathArg) {
    const tempPath = await downloadImageToTemp(urlArg);
    try {
      const mimeType = mimeFromExt(tempPath);
      const { text, model: usedModel } = await readImageWithVision(ctx, tempPath, mimeType, question, model);
      return {
        description: text.slice(0, AGENT_TOOL_RESULT_MAX_CHARS),
        chars: text.length,
        truncated: text.length > AGENT_TOOL_RESULT_MAX_CHARS,
        model: usedModel,
        url: urlArg,
        elapsedMs: Date.now() - started,
      };
    } finally {
      fs.unlink(tempPath, () => undefined);
    }
  }

  const absPath = resolveLocalImagePath(ctx.config, pathArg || urlArg);
  if (!fs.existsSync(absPath)) {
    throw new Error(`图片文件不存在: ${pathArg || urlArg}`);
  }
  const mimeType = mimeFromExt(absPath);
  const { text, model: usedModel } = await readImageWithVision(ctx, absPath, mimeType, question, model);
  return {
    description: text.slice(0, AGENT_TOOL_RESULT_MAX_CHARS),
    chars: text.length,
    truncated: text.length > AGENT_TOOL_RESULT_MAX_CHARS,
    model: usedModel,
    path: pathArg || urlArg,
    elapsedMs: Date.now() - started,
  };
}

/** 从 bilibili URL 或纯 bvid 字符串提取 BV 号 */
function extractBvid(input: string): string | null {
  const s = String(input).trim();
  // 纯 BV 号
  const direct = s.match(/^(BV[0-9A-Za-z]{8,})$/);
  if (direct) return direct[1];
  // URL 中提取
  const inUrl = s.match(/\/(BV[0-9A-Za-z]{8,})(?:\/|\?|#|$)/);
  if (inUrl) return inUrl[1];
  // 末尾 BV 号
  const tail = s.match(/(BV[0-9A-Za-z]{8,})$/);
  if (tail) return tail[1];
  return null;
}

/** 从 YouTube URL（watch/youtu.be/shorts/embed/live）或纯 11 位 videoId 提取 ID */
function extractYouTubeId(input: string): string | null {
  const s = String(input).trim();
  // 纯 11 位 videoId
  const direct = s.match(/^([A-Za-z0-9_-]{11})$/);
  if (direct) return direct[1];
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    // watch?v=<id>
    const v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    // /shorts/<id>、/embed/<id>、/live/<id>、/v/<id>
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

/** YouTube 字幕抓取：纯 HTTP 调 YouTube 内部 timedtext 端点，零 API key、零浏览器，本地轻量 */
async function fetchYouTubeTranscript(
  videoId: string,
  maxChars: number,
): Promise<{ transcript: string; title: string; author: string; language: string; note?: string }> {
  const api = new YouTubeTranscriptApi();
  // 优先中英，回退任意可用
  const languages = ["zh-Hans", "zh", "zh-CN", "zh-TW", "en"];
  let fetched;
  try {
    fetched = await api.fetch(videoId, languages, false);
  } catch (err) {
    // 无指定语言字幕时尝试拿任意可用字幕
    try {
      const list = await api.list(videoId);
      const anyTranscript = list.getAllTranscripts()[0];
      if (!anyTranscript) {
        return { transcript: "", title: "", author: "", language: "", note: "该视频没有可用字幕（CC）。可能是无字幕视频、纯音乐、或字幕需登录。可建议用户提供音频文件走 whisper 转写。" };
      }
      fetched = await anyTranscript.fetch(false);
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      return { transcript: "", title: "", author: "", language: "", note: `YouTube 字幕抓取失败：${msg}` };
    }
  }
  const snippets = fetched.snippets || [];
  const fullText = snippets.map((sn) => sn.text).join(" ").replace(/\s+/g, " ").trim();
  const truncated = fullText.length > maxChars;
  const transcript = truncated ? fullText.slice(0, maxChars) : fullText;
  const meta = fetched.metadata;
  return {
    transcript,
    title: meta?.title || "",
    author: meta?.author || "",
    language: fetched.language || fetched.languageCode || "",
    note: truncated ? `字幕已截断到 ${maxChars} 字符（全文 ${fullText.length} 字符）` : undefined,
  };
}

/**
 * video_transcript：给一个 bilibili 或 YouTube 视频链接，抓取字幕逐字稿 + AI 总结。
 * bilibili 复用 metablog 字幕抓取；YouTube 用 youtube-transcript-api-js（纯 HTTP、零 API key、零浏览器，本地轻量）。
 * 用于「视频转文字、生成草稿、逐字稿、内容整理」场景。
 */
async function videoTranscriptTool(args: Record<string, unknown>, _ctx: NativeToolContext) {
  const urlArg = String(args.url ?? "").trim();
  if (!urlArg) throw new Error("需要 url 参数（bilibili 或 YouTube 视频链接/ID）");
  const maxChars = typeof args.maxChars === "number" && args.maxChars > 0 ? Math.min(args.maxChars, 50000) : 20000;
  const includeSummary = args.includeSummary !== false;
  const started = Date.now();

  // YouTube 分支
  const ytId = extractYouTubeId(urlArg);
  if (ytId) {
    const yt = await fetchYouTubeTranscript(ytId, maxChars);
    return {
      platform: "youtube",
      videoId: ytId,
      transcript: yt.transcript,
      title: yt.title,
      author: yt.author,
      language: yt.language,
      summary: "",
      transcriptChars: yt.transcript.length,
      truncated: yt.transcript.length >= maxChars,
      note: yt.note,
      elapsedMs: Date.now() - started,
    };
  }

  // bilibili 分支
  const bvid = extractBvid(urlArg);
  if (!bvid) throw new Error(`无法从输入解析 bilibili BV 号或 YouTube 视频 ID：${urlArg}`);
  const cid = await fetchBilibiliPagelistCid(bvid, 10000);
  if (!cid) {
    return {
      platform: "bilibili",
      bvid,
      transcript: "",
      summary: "",
      note: "无法获取视频 cid（可能视频不存在或已被删除），未取到字幕。",
      elapsedMs: Date.now() - started,
    };
  }

  const [transcript, summary] = await Promise.all([
    fetchBilibiliSubtitleExcerpt(bvid, cid, 10000, maxChars),
    includeSummary ? fetchBilibiliAiConclusion(bvid, 10000, 4000) : Promise.resolve(""),
  ]);

  if (!transcript && !summary) {
    return {
      platform: "bilibili",
      bvid,
      cid,
      transcript: "",
      summary: "",
      note: "该视频没有可用字幕（CC）或 AI 总结。可能是无字幕视频、纯音乐、或字幕需登录获取。可建议用户提供音频/视频文件走 whisper 转写。",
      elapsedMs: Date.now() - started,
    };
  }

  return {
    platform: "bilibili",
    bvid,
    cid,
    transcript: transcript || "",
    summary: summary || "",
    transcriptChars: transcript.length,
    truncated: transcript.length >= maxChars,
    elapsedMs: Date.now() - started,
  };
}

const WEB_DEFS: NativeToolDefinition[] = [
  {
    name: "web_search",
    concurrencyClass: "B",
    // 纯搜索只读（syncSearchEnvFromConfig 只写进程内 env 且幂等）
    description:
      "搜索互联网（MetaBlog smartSearch 多引擎；/sources 信息源启用后 Tavily/SerpAPI 优先 scoped 到信息源域名）。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        maxResults: { type: "number", description: "最大结果数，默认 5" },
        engine: {
          type: "string",
          description: "优先引擎：baidu_qianfan|metaso|bocha|tavily|bing_crawler|duckduckgo|searxng|serpapi 等",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "rss_fetch",
    description:
      "抓取指定 RSS/Atom 信息源的最新条目，自动去重。支持 sourceId 或 sourceName。可设置 autoDraft=true 自动生成 Post 草稿。",
    parameters: {
      type: "object",
      properties: {
        sourceId: { type: "string", description: "信息源 ID" },
        sourceName: { type: "string", description: "信息源名称（sourceId 的替代）" },
        maxItems: { type: "number", description: "最大抓取条数，默认 20，最大 50" },
        autoDraft: { type: "boolean", description: "是否自动把新条目生成 Post 草稿" },
        defaultCategory: { type: "string", description: "自动生成草稿时的分类，默认\"信息源\"" },
      },
      required: [],
    },
  },
  {
    name: "rss_draft_posts",
    description: "把已抓取的 RSS 条目转成 Post 草稿。",
    parameters: {
      type: "object",
      properties: {
        sourceId: { type: "string", description: "信息源 ID" },
        itemIds: { type: "array", items: { type: "string" }, description: "InfoSourceItem 的 id 列表" },
        defaultCategory: { type: "string", description: "草稿分类，默认 \"信息源\"" },
      },
      required: ["sourceId", "itemIds"],
    },
  },
  {
    name: "read_article",
    concurrencyClass: "A",
    // 只读抓取网页正文，无本地写副作用
    description:
      "读取网页文章为 Markdown（MetaBlog readArticle）。支持知乎/微信/小红书/B站/掘金/CSDN/InfoQ/SegmentFault/开源中国/博客园/简书等；InfoQ 走官方 API；SPA 站 HTTP→Playwright→DOM→Jina 降级；404/壳页明确报错；正文偏短返回 contentWarning。长文分段读：第一次 offset=0，根据返回的 nextOffset 继续读下一段（contentTruncated=true 或 nextOffset 存在时翻页）。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "文章 URL" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        platform: { type: "string", description: "可选平台：zhihu、wechat、xiaohongshu、bilibili 等" },
        method: { type: "string", enum: ["playwright"], description: "强制 Playwright 渲染" },
        embedOcr: { type: "boolean", description: "是否 OCR 嵌入图片文字，默认 true" },
        maxChars: { type: "number", description: `返回正文最大字符数，默认 ${AGENT_TOOL_RESULT_MAX_CHARS}` },
        offset: { type: "number", description: "正文起始字符偏移（用于分段读取长文，默认 0 从头开始）。配合 maxChars 翻页：第一次 offset=0，第二次 offset=上次返回的 offset+contentChars" },
        minChars: { type: "number", description: "可读正文下限，低于且标题像 404 则报错，默认 80" },
      },
      required: ["url"],
    },
  },
  {
    name: "scrape_web_page",
    concurrencyClass: "B",
    // 只读 Playwright 采集，无本地写副作用
    description: "Playwright 采集网页正文、链接与元数据（MetaBlog scrapeWebPage）。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "目标 URL" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        waitFor: { type: "string", description: "可选 CSS 选择器" },
        extractArticle: { type: "boolean", description: "启发式提取正文，默认 true" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_screenshot",
    concurrencyClass: "B",
    // 截图落盘到 uploads/screenshots，文件名含时间戳，重跑不覆盖旧图
    description:
      "用 Playwright 打开页面并截图（PNG），保存到 content/uploads/screenshots/。返回 path/publicUrl（不含图片字节）。视觉确认页面 / 登录墙 / 图表时用；随后用 read_image 读图。纯文字页优先 read_article。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "目标页面 URL（http/https）" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        waitFor: { type: "string", description: "可选 CSS 选择器，出现后再截" },
        fullPage: { type: "boolean", description: "是否整页长截图，默认 false（视口）" },
        width: { type: "number", description: "视口宽度，默认 1280" },
        height: { type: "number", description: "视口高度，默认 800" },
      },
      required: ["url"],
    },
  },
  {
    name: "scroll_screenshot",
    concurrencyClass: "B",
    // 滚动截图落盘到 uploads/screenshots，无本地写副作用（除截图文件）
    description:
      "分段滚动截图（解决 SPA 懒加载/长页 fullPage 截图空白）。每次滚动一个视口高度，等待加载后截一张视口图，返回多张截图路径（按滚动顺序）。适合无限滚动、懒加载长页、需看清整页布局的场景。随后用 read_image 逐张识图或 vision_describe 语义理解。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "目标页面 URL（http/https）" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        scrollSteps: { type: "number", description: "滚动截图次数（1~20，默认 5），每次滚动一个视口高度" },
        scrollDelay: { type: "number", description: "每次滚动后等待加载毫秒（200~5000，默认 800），懒加载页可调大" },
        width: { type: "number", description: "视口宽度，默认 1280" },
        height: { type: "number", description: "视口高度（也是滚动步长），默认 800" },
      },
      required: ["url"],
    },
  },
  {
    name: "save_webpage",
    concurrencyClass: "A",
    // 抓取网页正文存本地，便于反复读/离线读
    description:
      "把网页完整正文保存到本地（data/webpages/ 目录，HTML 和/或 Markdown），再用 read_file 读取。解决 read_article 截断、长文分段麻烦的问题——存本地后可反复读、离线读、用 read_file offset 分段读长文。复用 read_article 的抓取链路（含登录态复用）。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "文章 URL" },
        format: { type: "string", enum: ["html", "markdown", "both"], description: "保存格式，默认 both（同时存 HTML + Markdown）" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        method: { type: "string", enum: ["playwright"], description: "强制 Playwright 渲染（SPA 页用）" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_image",
    concurrencyClass: "B",
    // OCR/vision 只读，无本地写副作用
    description:
      "读取图片中的文字或视觉内容。path 用 browser_screenshot 返回的相对路径；也可传 http(s) 图片 URL。mode=ocr|vision|auto（默认 auto：当前模型支持 vision 则识图，否则 OCR）。结果只回文本。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内相对路径，如 content/uploads/screenshots/xxx.png；也可用 /uploads/...",
        },
        url: { type: "string", description: "http(s) 图片 URL，或 /uploads/...（与 path 二选一）" },
        mode: {
          type: "string",
          enum: ["ocr", "vision", "auto"],
          description: "ocr=本地/云 OCR；vision=多模态识图；auto=按模型能力选择",
        },
        language: { type: "string", description: "OCR 语言：auto|chs|en 等，默认 auto" },
        prompt: { type: "string", description: "vision 模式下的识图提示（可选）" },
        model: { type: "string", description: "vision 模型 id（可选；默认 Agent 模型或 deepseek-vl2）" },
      },
      required: [],
    },
  },
  {
    name: "vision_describe",
    concurrencyClass: "B",
    // 只读：调多模态模型识图，无本地写副作用
    description:
      "外挂视觉理解器：把图片交给多模态模型做语义理解，返回文字描述。专为纯文本模型设计——当前 Agent 不支持 vision 时，用免费多模态模型（Gemini/OpenRouter 免费层）代为看图，结果作为参考文本回灌给当前模型。与 read_image 区别：read_image 偏 OCR 文字提取（auto 优先 OCR）；vision_describe 强制 vision 语义理解/描述/问答，默认免费模型不消耗付费额度。用法：browser_screenshot 后想理解页面/图表/UI，或本地/URL 图片需语义描述时调用。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目内相对路径，如 content/uploads/screenshots/xxx.png；也可用 /uploads/...",
        },
        url: { type: "string", description: "http(s) 图片 URL，或 /uploads/...（与 path 二选一，path 优先）" },
        question: {
          type: "string",
          description: "想让视觉模型回答的问题/聚焦点。默认整体描述；可指定如「提取图中所有文字」「这张图表的趋势是什么」「描述 UI 当前状态」",
        },
        model: {
          type: "string",
          description: "视觉模型 id（可选；默认按 Gemini→OpenRouter 免费多模态→deepseek-vl2 顺序选择，可用 env VISION_DESCRIBE_MODEL 覆盖）",
        },
      },
      required: [],
    },
  },
  {
    name: "video_transcript",
    concurrencyClass: "B",
    description:
      "视频转文字逐字稿：给一个 bilibili 或 YouTube 视频链接/ID，抓取字幕逐字稿（+ bilibili 的 AI 总结）。用于「视频转文字、生成草稿、逐字稿、内容整理、做笔记」场景。返回 transcript（字幕逐字稿）、summary（bilibili AI 总结，YouTube 无）、title/author（YouTube 元信息）。bilibili 用 BV 号或链接；YouTube 用 watch/youtu.be/shorts 链接或 11 位 videoId。无字幕视频（纯音乐/无 CC）会返回空 transcript，可建议用户提供音频文件走 whisper 转写。结果可直接用于生成知识库文章（post_create）或草稿（write_file）。",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "视频链接或 ID：bilibili（如 https://www.bilibili.com/video/BV1xx... 或 BV1xx...）、YouTube（如 https://www.youtube.com/watch?v=xxxx 或 https://youtu.be/xxxx 或纯 11 位 videoId）",
        },
        maxChars: {
          type: "number",
          description: "字幕逐字稿最大字符数，默认 20000，上限 50000",
        },
        includeSummary: {
          type: "boolean",
          description: "是否包含 bilibili AI 总结（仅 bilibili 有效），默认 true",
        },
      },
      required: ["url"],
    },
  },
];

const WEB_HANDLERS = {
  web_search: webSearch,
  rss_fetch: rssFetchTool,
  rss_draft_posts: rssDraftPostsTool,
  read_article: readArticleTool,
  scrape_web_page: scrapeWebPageTool,
  browser_screenshot: browserScreenshotTool,
  scroll_screenshot: scrollScreenshotTool,
  save_webpage: saveWebpageTool,
  read_image: readImageTool,
  vision_describe: visionDescribeTool,
  video_transcript: videoTranscriptTool,
};

export function registerWebTools(): void {
  registerNativeDomain(WEB_DEFS, WEB_HANDLERS);
}
