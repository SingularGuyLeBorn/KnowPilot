/**
 * Native Web 域 — search / RSS / article / scrape
 */
import type { AppConfig } from "../../config.js";
import {
  smartSearch,
  parsePlatformUrl,
  scrapePage,
  resetSearchEngineConfigs,
  detectPlatform,
  isArticleFetchFatalError,
  type SearchEngineName,
} from "../../metablog/index.js";
import { isSmokeInfoSource } from "../../smokeArtifacts.js";
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

  const res = await fetch("https://api.tavily.com/search", {
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
  const res = await fetch(url);
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

const READ_ARTICLE_MAX_CHARS = 16_000;
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
  const content = result.content ?? "";
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

const WEB_DEFS: NativeToolDefinition[] = [
  {
    name: "web_search",
    concurrencyClass: "B",
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
    description:
      "读取网页文章为 Markdown（MetaBlog readArticle）。支持知乎/微信/小红书/B站/掘金/CSDN/InfoQ/SegmentFault/开源中国/博客园/简书等；InfoQ 走官方 API；SPA 站 HTTP→Playwright→DOM→Jina 降级；404/壳页明确报错；正文偏短返回 contentWarning。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "文章 URL" },
        timeout: { type: "number", description: "超时毫秒，默认 30000" },
        platform: { type: "string", description: "可选平台：zhihu、wechat、xiaohongshu、bilibili 等" },
        method: { type: "string", enum: ["playwright"], description: "强制 Playwright 渲染" },
        embedOcr: { type: "boolean", description: "是否 OCR 嵌入图片文字，默认 true" },
        maxChars: { type: "number", description: "返回正文最大字符数，默认 16000" },
        minChars: { type: "number", description: "可读正文下限，低于且标题像 404 则报错，默认 80" },
      },
      required: ["url"],
    },
  },
  {
    name: "scrape_web_page",
    concurrencyClass: "B",
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
  }
];

const WEB_HANDLERS = {
  web_search: webSearch,
  rss_fetch: rssFetchTool,
  rss_draft_posts: rssDraftPostsTool,
  read_article: readArticleTool,
  scrape_web_page: scrapeWebPageTool,
};

export function registerWebTools(): void {
  registerNativeDomain(WEB_DEFS, WEB_HANDLERS);
}
