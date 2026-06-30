/**
 * ============================================================================
 * 智能网页采集服务 - webScraper.ts
 * ============================================================================
 *
 * REQ-037: 三 API 分层架构(Scrape → Crawl → SERP).
 * Playwright 渲染 → 内容提取 → 结构化输出.
 *
 * @module server/services
 */

import type { Page, BrowserContext } from "playwright";
import { closeSharedBrowser, getSharedBrowser, isSharedBrowserReady } from "./browserPool.js";
import {
  PW_SCROLL_HALF,
  PW_EXTRACT_METADATA,
  PW_EXTRACT_LINKS,
  PW_EXTRACT_IMAGES,
  PW_EXTRACT_ARTICLE_TEXT,
  PW_BODY_TEXT,
  needsSpaWait,
} from "./playwrightBrowserScripts.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ==================== 类型 ====================

export interface ScrapedPage {
  url: string;
  title: string;
  description?: string;
  text: string;
  html: string;
  links: { text: string; href: string }[];
  images: { alt: string; src: string }[];
  metadata: Record<string, string>;
  scrapedAt: number;
}

export interface ScrapeOptions {
  url: string;
  waitFor?: string; // CSS selector to wait for
  timeout?: number; // ms
  extractArticle?: boolean; // 是否提取正文(去除噪音)
}

export interface BatchScrapeOptions {
  urls: string[];
  concurrency?: number;
  timeout?: number;
}

export interface ScrapeResult {
  success: boolean;
  data?: ScrapedPage;
  error?: string;
}

// ==================== 配置 ====================

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CONCURRENCY = 3;

// ==================== 核心函数 ====================

/** @deprecated 使用 closeSharedBrowser，保留别名供 index 导出 */
export const closeBrowser = closeSharedBrowser;

function extractMetadata(page: Page): Promise<Record<string, string>> {
  return page.evaluate(PW_EXTRACT_METADATA);
}

function extractLinks(page: Page): Promise<{ text: string; href: string }[]> {
  return page.evaluate(PW_EXTRACT_LINKS);
}

function extractImages(page: Page): Promise<{ alt: string; src: string }[]> {
  return page.evaluate(PW_EXTRACT_IMAGES);
}

async function extractArticleText(page: Page): Promise<string> {
  await page.evaluate(PW_SCROLL_HALF);
  await page.waitForTimeout(400);
  return page.evaluate(PW_EXTRACT_ARTICLE_TEXT);
}

async function preparePageForExtract(page: Page, url: string): Promise<void> {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* ignore */
  }
  if (needsSpaWait(hostname)) {
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.evaluate(PW_SCROLL_HALF);
    await page.waitForTimeout(600);
  }
}

/**
 * 单页采集
 */
export async function scrapePage(options: ScrapeOptions): Promise<ScrapeResult> {
  const { url, waitFor, timeout = DEFAULT_TIMEOUT, extractArticle = true } = options;

  if (!url || !url.startsWith("http")) {
    return { success: false, error: "无效的 URL" };
  }

  let page: Page | null = null;
  let context: BrowserContext | null = null;
  try {
    const browser = await getSharedBrowser();
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: DEFAULT_UA,
    });
    page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(600);
    await preparePageForExtract(page, url);

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 5000 }).catch(() => {
        // 可选等待, 失败不阻塞
      });
    }

    const title = await page.title();
    const html = await page.content();
    const metadata = await extractMetadata(page);
    const links = await extractLinks(page);
    const images = await extractImages(page);

    const text = extractArticle
      ? await extractArticleText(page)
      : ((await page.evaluate(PW_BODY_TEXT)) as string);

    return {
      success: true,
      data: {
        url,
        title,
        description: metadata["description"] || metadata["og:description"],
        text,
        html: html.slice(0, 100_000), // 限制 HTML 大小
        links,
        images,
        metadata,
        scrapedAt: Date.now(),
      },
    };
  } catch (e: any) {
    return { success: false, error: `采集失败: ${e.message}` };
  } finally {
    if (page) await page.close();
    if (context) await context.close();
  }
}

/**
 * 批量采集
 */
export async function scrapeBatch(options: BatchScrapeOptions): Promise<ScrapeResult[]> {
  const { urls, concurrency = DEFAULT_CONCURRENCY, timeout = DEFAULT_TIMEOUT } = options;

  const results: ScrapeResult[] = [];
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift()!;
      const result = await scrapePage({ url, timeout });
      results.push(result);
    }
  }

  const workers = Array(Math.min(concurrency, urls.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * 获取采集服务状态
 */
export function getScraperStatus() {
  return {
    browserReady: isSharedBrowserReady(),
    defaultTimeout: DEFAULT_TIMEOUT,
    defaultConcurrency: DEFAULT_CONCURRENCY,
  };
}
