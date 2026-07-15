/**
 * MetaBlog 搜索 + 多媒体网页访问 — KnowPilot 服务端直调入口
 */

export { smartSearch, getEngineStatus, resetSearchEngineConfigs } from "./search/router.js";
export type { SearchEngineName, SearchResponse, SearchResult } from "./search/types.js";

export { detectPlatform, fetchContent, fetchWithPlaywright, fetchJinaAsHtml, looksLikeBlockedHtml, hasWechatArticleHtml, hasXiaohongshuArticleHtml, hasDouyinArticleHtml, parseCookieHeader, isArticleFetchFatalError } from "./platform/fetcher.js";
export { parseHtmlToMarkdown } from "./platform/parser.js";
export type { ParseResult, ParseOptions } from "./platform/types.js";

export { scrapePage, scrapeBatch, getScraperStatus } from "./webScraper.js";
export { closeSharedBrowser } from "./browserPool.js";
export type { ScrapeOptions, ScrapeResult, ScrapedPage } from "./webScraper.js";

import { detectPlatform, fetchContent, fetchWithPlaywright, fetchJinaAsHtml, looksLikeBlockedHtml, normalizeGithubReadUrl } from "./platform/fetcher.js";
import { parseHtmlToMarkdown } from "./platform/parser.js";
import type { ParseResult } from "./platform/types.js";

const VALID_PLATFORMS = new Set([
  "zhihu",
  "ZhihuCollection",
  "wechat",
  "xiaohongshu",
  "douyin",
  "bilibili",
  "weibo",
  "juejin",
  "csdn",
  "cnblogs",
  "jianshu",
  "infoq",
  "segmentfault",
  "oschina",
  "github-raw",
  "github",
  "stackoverflow",
  "unknown",
]);

/** read_article 支持的平台（不含 unknown / 收藏夹） */
export const READ_ARTICLE_PLATFORMS = [...VALID_PLATFORMS].filter(
  (p) => p !== "unknown" && p !== "ZhihuCollection",
);

const MIN_READABLE_CHARS = 150;

function looksLikeFeedMisparse(platform: string, title: string, content: string): boolean {
  if (platform !== "infoq" && platform !== "oschina") return false;
  const t = title.trim();
  if (/^InfoQ\s*[-–—]|^OSCHINA\s*[-–—]/i.test(t)) return true;
  if (/^OSCHINA\s*[-–—]\s*开源\s*[×x·]/i.test(t)) return true;
  const markers = (content.match(/小时前|编辑推荐|推荐阅读|阅读完需：约 \d+ 分钟/g) || []).length;
  if (markers >= 3 && !/本文字数：\d+/.test(content)) return true;
  return false;
}

function looksLikeBlockedParse(result: ParseResult, platform?: string): boolean {
  const title = (result.title ?? "").trim();
  const titleLower = title.toLowerCase();
  if (/404|页面不存在|not found|找不到页面|http 404|page not found/.test(titleLower)) return true;
  if (title === "404") return true;

  const content = result.content?.trim() ?? "";
  const len = content.length;
  if (platform && looksLikeFeedMisparse(platform, title, content)) return true;
  if (len >= MIN_READABLE_CHARS) return false;
  const blob = `${title} ${content}`;
  return (
    looksLikeBlockedHtml(blob, MIN_READABLE_CHARS) ||
    len < 80 ||
    /^(1\s*\|\s*-|打开知乎|验证码)/.test(content)
  );
}

export interface ParsePlatformUrlOptions {
  url: string;
  timeout?: number;
  platform?: string;
  method?: "playwright";
  embedOcr?: boolean;
  fetchImageFiles?: boolean;
  maxAnswers?: number;
}

/** 对应 MetaBlog POST /api/platform/parse */
export async function parsePlatformUrl(opts: ParsePlatformUrlOptions) {
  const { url, timeout = 30000, method, embedOcr = true, fetchImageFiles = false } = opts;

  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  let platform: string;
  if (opts.platform && VALID_PLATFORMS.has(opts.platform)) {
    platform = opts.platform;
  } else if (targetUrl.hostname.includes("zhihu.com") && /\/collections?\//.test(targetUrl.pathname)) {
    platform = "ZhihuCollection";
  } else {
    platform = detectPlatform(targetUrl.hostname);
  }

  const githubRawUrl = normalizeGithubReadUrl(url);
  const fetchUrl = githubRawUrl ?? url;
  if (githubRawUrl && (!opts.platform || !VALID_PLATFORMS.has(opts.platform))) {
    platform = "github-raw";
  }

  let html: string;
  let fetcherName: string;
  let methodName: string;

  if (method === "playwright") {
    html = await fetchWithPlaywright(fetchUrl, { timeout });
    fetcherName = "playwright";
    methodName = "playwright";
  } else {
    const fetched = await fetchContent(fetchUrl, platform, timeout);
    html = fetched.html;
    fetcherName = fetched.fetcher;
    methodName = fetched.method;
  }

  let parsed = await parseHtmlToMarkdown(
    html,
    url,
    platform,
    { fetcher: fetcherName, method: methodName },
    {
      embedOcr,
      fetchImageFiles,
      maxAnswers: opts.maxAnswers,
    },
  );

  if (!looksLikeBlockedParse(parsed, platform)) return parsed;

  console.warn(`[parsePlatformUrl] 正文过短或被拦截 (${parsed.content?.length ?? 0} 字)，尝试 Jina: ${url}`);
  try {
    const jinaHtml = await fetchJinaAsHtml(url, Math.min(timeout, 20000));
    const retry = await parseHtmlToMarkdown(
      jinaHtml,
      url,
      platform,
      { fetcher: "jina", method: "jina-reader" },
      { embedOcr, fetchImageFiles, maxAnswers: opts.maxAnswers },
    );
    if ((retry.content?.length ?? 0) > (parsed.content?.length ?? 0)) {
      return retry;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[parsePlatformUrl] Jina 重试失败: ${msg.split("\n")[0]}`);
  }
  return parsed;
}
