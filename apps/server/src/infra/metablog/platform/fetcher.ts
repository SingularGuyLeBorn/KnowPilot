/**
 * ============================================================================
 * 平台解析路由 - fetcher
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/routes/platform
 */


import type { ContentFetcher, FetchedContent } from "./types";
import { launchPlaywrightBrowser } from "../playwrightChrome.js";
import { getSharedBrowser, closeSharedBrowser } from "../browserPool.js";
import { PW_SCROLL_HALF, PW_SCROLL_THIRD, PW_EXTRACT_ARTICLE_DOM, PW_WAIT_BODY_MIN_FN } from "../playwrightBrowserScripts.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const JIANSHU_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

export function isArticleFetchFatalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /页面不存在|已删除|404 shell/i.test(msg);
}

const BLOCKED_MARKERS = [
  "验证码登录",
  "打开知乎App",
  "环境异常",
  "完成验证",
  "Access Denied",
  "403 Forbidden",
  "请登录",
];

const ZHIHU_STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
`;

/** 微信正文是否足够（#js_content） */
export function hasWechatArticleHtml(html: string, minChars = 80): boolean {
  if (html.includes("环境异常") || html.includes("完成验证") || html.includes("该内容已被发布者删除")) {
    return false;
  }
  const block =
    html.match(/id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
    html.match(/class=["'][^"']*rich_media_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (block) {
    const plain = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain.length >= minChars;
  }
  return html.includes("js_content") && html.includes("rich_media") && !looksLikeBlockedHtml(html, minChars);
}

/** 小红书正文是否足够 */
export function hasXiaohongshuArticleHtml(html: string, minChars = 80): boolean {
  if (
    html.includes("当前笔记暂时无法浏览") ||
    html.includes("笔记不存在") ||
    html.includes("需要登录") ||
    html.includes("扫码登录")
  ) {
    return false;
  }
  const block =
    html.match(/id=["']detail-desc["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
    html.match(/class=["'][^"']*note-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
    html.match(/class=["'][^"']*desc[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (block) {
    const plain = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain.length >= minChars;
  }
  return !looksLikeBlockedHtml(html, minChars);
}

/** 抖音视频页正文是否足够 */
export function hasDouyinArticleHtml(html: string, minChars = 60): boolean {
  if (html.includes("验证码") || html.includes("请登录") || html.includes("访问过于频繁")) {
    return false;
  }
  const desc =
    html.match(/class=["'][^"']*video-info-desc[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|p|div)>/i)?.[1] ??
    html.match(/data-e2e=["']video-desc["'][^>]*>([\s\S]*?)<\/(?:span|p|div)>/i)?.[1];
  if (desc) {
    const plain = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (plain.length >= minChars) return true;
  }
  if (html.includes("RENDER_DATA") || html.includes("aweme_detail") || html.includes("desc")) {
    return !looksLikeBlockedHtml(html, minChars);
  }
  return false;
}

/** 掘金正文是否足够 */
export function hasJuejinArticleHtml(html: string, minChars = 150): boolean {
  if (html.includes("找不到页面") || html.includes("页面不存在") || html.includes("404 Not Found")) {
    return false;
  }
  const block =
    html.match(/class=["'][^"']*markdown-body[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (block) {
    const plain = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain.length >= minChars;
  }
  return !looksLikeBlockedHtml(html, minChars);
}

/** 知乎正文是否足够（Cookie HTTP / SSR） */
export function hasZhihuArticleHtml(html: string, minChars = 150): boolean {
  if (looksLikeHttp404Shell(html, minChars)) return false;
  if (looksLikeBlockedHtml(html, minChars)) return false;
  if (html.includes("js-initialData") && plainTextLen(html) >= minChars) return true;
  return hasSelectorArticleHtml(
    html,
    [
      /class=["'][^"']*Post-RichTextContainer[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /class=["'][^"']*RichContent-inner[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ],
    minChars,
  );
}

/** 微博正文是否足够 */
export function hasWeiboArticleHtml(html: string, minChars = 100): boolean {
  if (html.includes("请先登录") || html.includes("抱歉，你访问的页面不存在")) return false;
  const block =
    html.match(/class=["'][^"']*detail_text[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)/i)?.[1] ??
    html.match(/class=["'][^"']*wbpro-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)/i)?.[1];
  if (block) {
    const plain = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain.length >= minChars;
  }
  return !looksLikeBlockedHtml(html, minChars);
}

/** CSDN 正文是否足够 */
export function hasCsdnArticleHtml(html: string, minChars = 150): boolean {
  if ((html.includes("404") && html.includes("不存在")) || html.includes("抱歉，您访问的页面不存在")) return false;
  const block = html.match(/id=["']content_views["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (block) {
    const plain = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain.length >= minChars;
  }
  return !looksLikeBlockedHtml(html, minChars);
}

function htmlBlockPlain(html: string, pattern: RegExp): string {
  const block = html.match(pattern)?.[1];
  if (!block) return "";
  return block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function plainTextLen(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

/** 短页 404 / 不存在壳页（正文足够长时不因含 "404" 字样误判） */
function looksLikeHttp404Shell(html: string, minChars: number): boolean {
  if (html.includes("404 页面不存在")) return true;
  if (/<title>[^<]*404[^<]*(页面不存在|not found)/i.test(html)) return true;
  const len = plainTextLen(html);
  if (len >= minChars) return false;
  if (html.includes("页面不存在") || html.includes("抱歉，您访问的页面不存在")) return true;
  if (html.includes("HTTP 404")) return true;
  if (html.includes("404") && (html.includes("Not Found") || html.includes("不存在"))) return true;
  return len < 80 && html.includes("不存在");
}

function hasWrappedArticleHtml(html: string, classHint: string, minChars: number): boolean {
  if (!html.includes(classHint)) return false;
  return plainTextLen(html) >= minChars;
}

function hasSelectorArticleHtml(html: string, patterns: RegExp[], minChars = 150): boolean {
  for (const pattern of patterns) {
    if (htmlBlockPlain(html, pattern).length >= minChars) return true;
  }
  return false;
}

/** InfoQ 正文是否足够 */
export function hasInfoqArticleHtml(html: string, minChars = 150): boolean {
  const len = plainTextLen(html);
  if (len >= minChars && html.includes("ProseMirror")) return true;
  if (hasWrappedArticleHtml(html, "article-content", minChars)) return true;
  if ((html.includes("404") || html.includes("页面不存在")) && len < minChars) return false;
  if (/InfoQ\s*[-–—]\s*促进软件开发/.test(html) && html.includes('id="app"')) return false;
  return hasSelectorArticleHtml(
    html,
    [
      /class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
      /class=["'][^"']*com-article-body[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
      /class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/article>/i,
    ],
    minChars,
  );
}

/** SegmentFault 正文是否足够 */
export function hasSegmentfaultArticleHtml(html: string, minChars = 150): boolean {
  if (looksLikeHttp404Shell(html, minChars)) return false;
  return hasSelectorArticleHtml(
    html,
    [
      /id=["']articleContent["'][^>]*>([\s\S]*?)<\/div>/i,
      /class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
    ],
    minChars,
  );
}

/** 开源中国正文是否足够 */
export function hasOschinaArticleHtml(html: string, minChars = 150): boolean {
  if (looksLikeHttp404Shell(html, minChars)) return false;
  const len = plainTextLen(html);
  if (/OSCHINA\s*[-–—]\s*开源/.test(html) && len < minChars) return false;
  if (hasWrappedArticleHtml(html, "article-content", minChars)) return true;
  return hasSelectorArticleHtml(
    html,
    [
      /id=["']articleContent["'][^>]*>([\s\S]*?)<\/div>/i,
      /class=["'][^"']*news-content[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
      /class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
      /class=["'][^"']*detail-body[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
    ],
    minChars,
  );
}

/** 博客园正文是否足够 */
export function hasCnblogsArticleHtml(html: string, minChars = 150): boolean {
  if (looksLikeHttp404Shell(html, minChars)) return false;
  if (html.includes("404 页面不存在") && plainTextLen(html) < minChars) return false;
  return hasSelectorArticleHtml(html, [/id=["']cnblogs_post_body["'][^>]*>([\s\S]*?)<\/div>/i], minChars);
}

/** 简书正文是否足够 */
export function hasJianshuArticleHtml(html: string, minChars = 150): boolean {
  if (looksLikeHttp404Shell(html, minChars)) return false;
  if (html.includes("抱歉，你访问的页面不存在") && plainTextLen(html) < minChars) return false;
  const len = plainTextLen(html);
  if (len < minChars && html.includes("简书系信息发布平台") && html.includes("著作权归作者所有")) return false;
  return hasSelectorArticleHtml(
    html,
    [
      /class=["'][^"']*show-content-free[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /class=["'][^"']*note-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      /class=["'][^"']*\bshow-content\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
      /class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)/i,
    ],
    minChars,
  );
}

/** 正文过短或命中反爬/登录墙特征 */
export function looksLikeBlockedHtml(html: string, minChars = 200): boolean {
  const plain = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length >= minChars) return false;
  return BLOCKED_MARKERS.some((m) => html.includes(m));
}

/** 从 Cookie 头解析 Playwright cookies */
export function parseCookieHeader(header: string, domain: string) {
  return header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return null;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) return null;
      return { name, value, domain, path: "/" };
    })
    .filter((c): c is { name: string; value: string; domain: string; path: string } => !!c);
}

function envCookieHeader(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Jina Reader → 包装为 HTML 供 parser 消费 */
export async function fetchJinaAsHtml(url: string, timeoutMs = 12000): Promise<string> {
  const jinaUrl = toJinaReaderUrl(url);
  const res = await fetchWithTimeout(jinaUrl, timeoutMs, {
    headers: { Accept: "text/plain", "X-Return-Format": "markdown" },
  });
  if (!res.ok) {
    throw new Error(`Jina Reader HTTP ${res.status}`);
  }
  const md = (await res.text()).trim();
  if (md.length < 80) {
    throw new Error("Jina Reader 正文过短");
  }
  const escaped = md.replace(/</g, "&lt;");
  return `<html><body><article><pre>${escaped}</pre></article></body></html>`;
}

function extractBvid(url: string): string | null {
  const m = url.match(/BV[\w]+/i);
  return m ? m[0] : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectAuthorMeta(rawHtml: string, name: string): string {
  if (!name.trim() || rawHtml.includes('name="author"')) return rawHtml;
  const meta = `<meta name="author" content="${escapeHtml(name.trim())}" />`;
  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }
  return `<head>${meta}</head>${rawHtml}`;
}

/** InfoQ getDetail 响应中提取作者（no_author / author 对象 / publisher） */
export function extractInfoqAuthorFromDetail(data: Record<string, unknown>): string {
  const author = data.author;
  if (author && typeof author === "object") {
    const o = author as Record<string, unknown>;
    const name = String(o.nickname ?? o.name ?? o.author_name ?? "").trim();
    if (name) return name;
  }
  if (typeof author === "string" && author.trim()) return author.trim();

  const publisher = data.publisher;
  if (publisher && typeof publisher === "object") {
    const nick = String((publisher as Record<string, unknown>).nickname ?? "").trim();
    if (nick) return nick;
  }

  const noAuthor = String(data.no_author ?? "").trim();
  if (!noAuthor) return "";
  const prefixed = noAuthor.match(/作者[：:]\s*(.+)/);
  return (prefixed?.[1] ?? noAuthor).trim();
}

function formatBilibiliPubdate(ts?: number): string | undefined {
  if (!ts) return undefined;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function fetchBilibiliTags(bvid: string, timeoutMs?: number): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.bilibili.com/x/tag/archive/tags?bvid=${encodeURIComponent(bvid)}`,
      timeoutMs ?? 8000,
      {
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent": DEFAULT_UA,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ tag_name?: string }> };
    return (json.data ?? []).map((t) => t.tag_name?.trim()).filter(Boolean) as string[];
  } catch {
    return [];
  }
}

async function fetchBilibiliPagelistCid(bvid: string, timeoutMs?: number): Promise<number | undefined> {
  try {
    const res = await fetchWithTimeout(
      `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`,
      timeoutMs ?? 8000,
      {
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent": DEFAULT_UA,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: Array<{ cid?: number }> };
    const cid = json.data?.[0]?.cid;
    return typeof cid === "number" ? cid : undefined;
  } catch {
    return undefined;
  }
}

async function fetchBilibiliAiConclusion(
  bvid: string,
  timeoutMs?: number,
  maxChars = 1500,
): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      `https://api.bilibili.com/x/web-interface/view/conclusion/get?bvid=${encodeURIComponent(bvid)}`,
      timeoutMs ?? 8000,
      {
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent": DEFAULT_UA,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return "";
    const json = (await res.json()) as {
      data?: { conclusion?: string; model_result?: { summary?: string } };
    };
    const text = json.data?.conclusion?.trim() || json.data?.model_result?.summary?.trim() || "";
    if (!text) return "";
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  } catch {
    return "";
  }
}

async function fetchBilibiliSubtitleExcerpt(
  bvid: string,
  cid: number,
  timeoutMs?: number,
  maxChars = 2500,
): Promise<string> {
  try {
    const playerRes = await fetchWithTimeout(
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`,
      timeoutMs ?? 8000,
      {
        headers: {
          Referer: "https://www.bilibili.com",
          "User-Agent": DEFAULT_UA,
          Accept: "application/json",
        },
      },
    );
    if (!playerRes.ok) return "";
    const playerJson = (await playerRes.json()) as {
      data?: { subtitle?: { subtitles?: Array<{ lan?: string; subtitle_url?: string }> } };
    };
    const subtitles = playerJson.data?.subtitle?.subtitles;
    if (!Array.isArray(subtitles) || subtitles.length === 0) return "";
    const sub =
      subtitles.find((s) => /zh|ai|cn/i.test(s.lan ?? "")) ?? subtitles[0];
    const subUrl = sub?.subtitle_url;
    if (!subUrl) return "";
    const fullUrl = subUrl.startsWith("http") ? subUrl : `https:${subUrl}`;
    const subRes = await fetchWithTimeout(fullUrl, timeoutMs ?? 10000);
    if (!subRes.ok) return "";
    const subJson = (await subRes.json()) as { body?: Array<{ content?: string }> };
    if (!Array.isArray(subJson.body)) return "";
    let text = subJson.body
      .map((b) => b.content?.trim())
      .filter(Boolean)
      .join("\n");
    if (text.length > maxChars) text = `${text.slice(0, maxChars)}...`;
    return text;
  } catch {
    return "";
  }
}

/** 从掘金 URL 提取 article_id（预留 API 接入） */
export function extractJuejinArticleId(url: string): string | null {
  const m = url.match(/juejin\.cn\/post\/(\d+)/i) ?? url.match(/\/post\/(\d+)/);
  return m ? m[1] : null;
}

function resolveFetchedMethod(platform: string, html: string, fetcherName: string): string {
  if (platform === "bilibili" && html.includes("window.__INITIAL_STATE__")) return "api";
  if (platform === "juejin" && html.includes("data-juejin-source=\"ssr\"")) return "juejin-ssr";
  if (platform === "juejin" && html.includes("window.__JUEJIN_API__")) return "api";
  if (platform === "zhihu" && html.includes("data-zhihu-source=\"cookie-http\"")) return "zhihu-cookie";
  if (platform === "cnblogs" && html.includes("data-cnblogs-source=\"ssr\"")) return "cnblogs-ssr";
  if (platform === "infoq" && html.includes("ProseMirror")) return "infoq-api";
  if (platform === "oschina" && html.includes("data-oschina-source=\"api\"")) return "oschina-api";
  if (platform === "segmentfault" && html.includes("data-segmentfault-source=\"ssr\"")) return "segmentfault-ssr";
  if (platform === "jianshu" && html.includes("data-jianshu-source=\"mobile\"")) return "jianshu-mobile";
  if (platform === "csdn" && html.includes("data-csdn-source=\"ssr\"")) return "csdn-ssr";
  if (html.includes("<article><pre>") && html.includes("&lt;")) return "jina-reader";
  if (fetcherName === "generic") return "generic";
  return fetcherName;
}

async function fetchBilibiliViaApi(bvid: string, timeoutMs?: number): Promise<string> {
  const effectiveTimeout = timeoutMs ?? 12000;
  const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const res = await fetchWithTimeout(apiUrl, effectiveTimeout, {
    headers: {
      Referer: "https://www.bilibili.com",
      "User-Agent": DEFAULT_UA,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Bilibili API HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    code?: number;
    message?: string;
    data?: {
      title?: string;
      desc?: string;
      tname?: string;
      pubdate?: number;
      owner?: { name?: string };
      duration?: number;
      stat?: { view?: number; danmaku?: number; like?: number; reply?: number };
      pages?: Array<{ part?: string; cid?: number }>;
    };
  };
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || "Bilibili API 返回异常");
  }
  const { title = "", desc = "", tname, pubdate, owner, duration, stat, pages } = json.data;
  const ownerName = owner?.name ?? "";
  let cid = pages?.[0]?.cid;
  if (!cid) {
    cid = await fetchBilibiliPagelistCid(bvid, effectiveTimeout);
  }
  const [tags, subtitle, aiConclusion] = await Promise.all([
    fetchBilibiliTags(bvid, effectiveTimeout),
    cid ? fetchBilibiliSubtitleExcerpt(bvid, cid, effectiveTimeout) : Promise.resolve(""),
    fetchBilibiliAiConclusion(bvid, effectiveTimeout),
  ]);

  const sections: string[] = [];
  const metaLines: string[] = [];
  if (ownerName) metaLines.push(`UP主：${ownerName}`);
  if (tname) metaLines.push(`分区：${tname}`);
  const pub = formatBilibiliPubdate(pubdate);
  if (pub) metaLines.push(`发布：${pub}`);
  if (duration) metaLines.push(`时长：${Math.floor(duration / 60)} 分 ${duration % 60} 秒`);
  if (metaLines.length) sections.push(`## 视频信息\n${metaLines.map((l) => `- ${l}`).join("\n")}`);

  const partTitle = pages?.[0]?.part;
  const introParts: string[] = [];
  if (desc && desc !== "-") introParts.push(desc);
  if (partTitle && partTitle !== title) introParts.push(`分P：${partTitle}`);
  if (introParts.length) sections.push(`## 简介\n${introParts.join("\n\n")}`);

  if (stat) {
    sections.push(
      `## 数据\n播放 ${stat.view ?? 0} · 弹幕 ${stat.danmaku ?? 0} · 点赞 ${stat.like ?? 0} · 评论 ${stat.reply ?? 0}`,
    );
  }
  if (tags.length) sections.push(`## 标签\n${tags.join(" · ")}`);
  if (subtitle) sections.push(`## 字幕摘录\n${subtitle}`);
  else if (aiConclusion) sections.push(`## AI 摘要\n${aiConclusion}`);

  const richDesc = sections.length ? sections.join("\n\n") : title;
  const state = JSON.stringify({
    videoData: { title, desc: richDesc, owner: { name: ownerName } },
  });
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(richDesc);
  const headInner = ownerName
    ? `<title>${safeTitle}</title><meta name="author" content="${escapeHtml(ownerName)}" />`
    : `<title>${safeTitle}</title>`;
  return `<!DOCTYPE html><html><head>${headInner}</head><body><h1>${safeTitle}</h1><article class="desc"><pre>${safeDesc}</pre></article><script>window.__INITIAL_STATE__=${state};(function(){})</script></body></html>`;
}

// ============================================
// 基础工具
// ============================================

async function fetchWithTimeout(url: string, timeoutMs = 15000, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Jina Reader 目标 URL（避免重复 http:// 前缀） */
export function toJinaReaderUrl(url: string): string {
  const bare = url.trim().replace(/^https?:\/\//i, "");
  return `https://r.jina.ai/https://${bare}`;
}

async function fetchHtml(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<string> {
  const effectiveTimeout = timeoutMs ?? 15000;
  const res = await fetchWithTimeout(url, effectiveTimeout, {
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 || looksLikeHttp404Shell(text, 80)) {
      throw new Error(`页面不存在或已删除 (${new URL(url).hostname})`);
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return text;
}

function throwIfUnreadableHttp(url: string, status: number, html: string): void {
  if (status === 404 || looksLikeHttp404Shell(html, 80)) {
    throw new Error(`页面不存在或已删除 (${new URL(url).hostname})`);
  }
  if (!status.toString().startsWith("2")) {
    throw new Error(`HTTP ${status}`);
  }
}

/** CSDN SSR 页在 recommend-box 之后为侧栏/脚本，可早停下载 */
export function isCsdnFetchComplete(html: string): boolean {
  return hasCsdnArticleHtml(html) && html.includes("recommend-box");
}

/** SegmentFault SSR 正文在 #articleContent，位于 __NEXT_DATA__ 之前 */
export function isSegmentfaultFetchComplete(html: string, pageUrl?: string): boolean {
  if (!hasSegmentfaultArticleHtml(html)) return false;
  if (extractSegmentfaultAuthorFromPartialNextData(html, pageUrl)) return true;
  return /<script id="__NEXT_DATA__"[^>]*>[\s\S]*?<\/script>/i.test(html);
}

/** 从流式/截断 __NEXT_DATA__ 片段提取作者（无需等 script 闭合） */
export function extractSegmentfaultAuthorFromPartialNextData(html: string, pageUrl?: string): string {
  const nextChunk = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*)/i)?.[1] ?? "";
  if (!nextChunk || nextChunk.length < 40) return "";
  const articleId = pageUrl ? extractSegmentfaultArticleId(pageUrl) : null;
  if (articleId) {
    const scoped = new RegExp(
      `"${articleId}"\\s*:\\s*\\{[\\s\\S]*?"user"\\s*:\\s*\\{[\\s\\S]*?"name"\\s*:\\s*"([^"]+)"`,
    );
    const m = nextChunk.match(scoped);
    if (m?.[1]) return m[1].trim();
  }
  const generic = nextChunk.match(/"artDetail"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]{2,40})"/);
  return generic?.[1]?.trim() ?? "";
}

/** 掘金 SSR 正文在 article-suspended / __NUXT__ 之前 */
export function isJuejinFetchComplete(html: string): boolean {
  return hasJuejinArticleHtml(html) && (html.includes("article-suspended") || html.includes("__NUXT__"));
}

/**
 * 流式 HTTP：正文足够且命中页尾标记时 abort，减少 CSDN/简书等大页下载量。
 * 若未早停则与 fetchHtml 等价（读完整个 body）。
 */
async function fetchHtmlPartial(
  url: string,
  headers: Record<string, string> | undefined,
  timeoutMs: number | undefined,
  opts: { isComplete: (html: string) => boolean; maxBytes?: number },
): Promise<string> {
  const effectiveTimeout = timeoutMs ?? 15000;
  const maxBytes = opts.maxBytes ?? 600_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...headers,
      },
    });
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      throwIfUnreadableHttp(url, res.status, text);
      return text;
    }

    const decoder = new TextDecoder("utf-8");
    let html = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (html.length >= maxBytes || opts.isComplete(html)) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    } catch (err: unknown) {
      if (!html || !opts.isComplete(html)) throw err;
    }
    html += decoder.decode();
    throwIfUnreadableHttp(url, res.status, html);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================
// Playwright 渲染器(复用)
// ============================================

/**
 * 获取WithPlaywright数据
 *
 * @param url - 参数(string)
 * @param opts - 参数({ isZhihu?: boolean; timeout?: number } = {})
 * @returns 返回值(Promise<string>)
 */
export async function fetchWithPlaywright(
  url: string,
  opts: {
    isZhihu?: boolean;
    isWechat?: boolean;
    isXiaohongshu?: boolean;
    isDouyin?: boolean;
    timeout?: number;
    visible?: boolean;
    waitSelector?: string;
  } = {},
): Promise<string> {
  const isZhihu = opts.isZhihu ?? false;
  const isWechat = opts.isWechat ?? false;
  const isXiaohongshu = opts.isXiaohongshu ?? false;
  const isDouyin = opts.isDouyin ?? false;
  const timeout = opts.timeout ?? 30000;
  const visible = opts.visible ?? false;

  if (isDouyin) {
    const cookieHeader = process.env.DOUYIN_COOKIE?.trim();
    const cookies = cookieHeader ? parseCookieHeader(cookieHeader, ".douyin.com") : [];
    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: DEFAULT_UA,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    if (cookies.length) await context.addCookies(cookies);
    await context.addInitScript(ZHIHU_STEALTH_SCRIPT);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      try {
        await page.waitForSelector(".video-info-desc, [data-e2e='video-desc'], .desc", { timeout: 12000 });
      } catch {
        /* ignore */
      }
      await page.evaluate(PW_SCROLL_THIRD);
      await page.waitForTimeout(1500);
      return await page.content();
    } finally {
      await context.close();
    }
  }

  if (isXiaohongshu) {
    const cookieHeader = (process.env.XHS_COOKIE || process.env.XIAOHONGSHU_COOKIE)?.trim();
    const cookies = cookieHeader ? parseCookieHeader(cookieHeader, ".xiaohongshu.com") : [];
    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: DEFAULT_UA,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    if (cookies.length) await context.addCookies(cookies);
    await context.addInitScript(ZHIHU_STEALTH_SCRIPT);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      try {
        await page.waitForSelector("#detail-desc, .note-content, .desc, .content", { timeout: 12000 });
      } catch {
        /* ignore */
      }
      await page.evaluate(PW_SCROLL_HALF);
      await page.waitForTimeout(1500);
      return await page.content();
    } finally {
      await context.close();
    }
  }

  if (isWechat) {
    const cookieHeader = process.env.WECHAT_COOKIE?.trim();
    const cookies = cookieHeader ? parseCookieHeader(cookieHeader, ".weixin.qq.com") : [];
    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: DEFAULT_UA,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    if (cookies.length) await context.addCookies(cookies);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      try {
        await page.waitForSelector("#js_content, .rich_media_content", { timeout: 12000 });
      } catch {
        /* ignore */
      }
      await page.evaluate(PW_SCROLL_HALF);
      await page.waitForTimeout(1200);
      return await page.content();
    } finally {
      await context.close();
    }
  }

  if (isZhihu) {
    const cookieHeader = process.env.ZHIHU_COOKIE?.trim();
    const cookies = cookieHeader ? parseCookieHeader(cookieHeader, ".zhihu.com") : [];

    const runZhihuContext = async (headless: boolean) => {
      if (headless) {
        const browser = await getSharedBrowser();
        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          userAgent: DEFAULT_UA,
          locale: "zh-CN",
          timezoneId: "Asia/Shanghai",
        });
        if (cookies.length) await context.addCookies(cookies);
        await context.addInitScript(ZHIHU_STEALTH_SCRIPT);
        try {
          const page = await context.newPage();
          await page.goto(url, { waitUntil: "domcontentloaded", timeout });
          try {
            await page.waitForSelector(".Post-RichTextContainer, .RichContent-inner, #js-initialData", {
              timeout: 12000,
            });
          } catch {
            /* ignore */
          }
          await page.waitForTimeout(headless ? 1500 : 3000);
          return await page.content();
        } finally {
          await context.close();
        }
      }

      const { chromium } = await import("playwright");
      const browser = await launchPlaywrightBrowser(chromium, { isZhihu: true });
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: DEFAULT_UA,
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
      });
      if (cookies.length) await context.addCookies(cookies);
      await context.addInitScript(ZHIHU_STEALTH_SCRIPT);
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        try {
          await page.waitForSelector(".Post-RichTextContainer, .RichContent-inner, #js-initialData", {
            timeout: 15000,
          });
        } catch {
          /* ignore */
        }
        await page.waitForTimeout(3000);
        return await page.content();
      } finally {
        await context.close();
        await browser.close();
      }
    };

    if (!visible) {
      const headlessHtml = await runZhihuContext(true);
      if (!looksLikeBlockedHtml(headlessHtml, 150)) return headlessHtml;
      console.warn("[ZhihuFetcher] headless 正文过短，降级 visible Chrome…");
    }
    return runZhihuContext(false);
  }

  const browser = await getSharedBrowser();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: DEFAULT_UA,
    locale: "zh-CN",
  });

  try {
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeout, opts.waitSelector ? 45000 : timeout),
    });
    if (opts.waitSelector) {
      for (const sel of opts.waitSelector.split(",").map((s) => s.trim()).filter(Boolean)) {
        try {
          await page.waitForSelector(sel, { timeout: 12000 });
          break;
        } catch {
          /* try next selector */
        }
      }
      await waitForSpaRender(page);
      await page.evaluate(PW_SCROLL_HALF);
      await page.waitForTimeout(2000);
    } else {
      await page.waitForTimeout(800);
    }
    return await page.content();
  } finally {
    await context.close();
  }
}

function parseWaitSelectors(waitSelector?: string): string[] {
  if (!waitSelector) return [".article-content", "article", "#articleContent", ".markdown-body"];
  return waitSelector.split(",").map((s) => s.trim()).filter(Boolean);
}

/** 等待 SPA 正文渲染（不用 networkidle，避免 OSChina/InfoQ 长连接挂起） */
async function waitForSpaRender(page: import("playwright").Page, minTextLen = 400, timeoutMs = 20000): Promise<void> {
  await page.waitForFunction(PW_WAIT_BODY_MIN_FN, minTextLen, { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForTimeout(800);
}

/** Playwright 直接抽取正文 DOM（应对 InfoQ / OSChina 等 SPA） */
async function fetchWithPlaywrightDomExtractOnce(
  url: string,
  timeout: number,
  selectors: string[],
  opts?: { minBodyText?: number; spaWaitMs?: number; userAgent?: string; viewport?: { width: number; height: number } },
): Promise<string> {
  const minBodyText = opts?.minBodyText ?? 500;
  const spaWaitMs = opts?.spaWaitMs ?? Math.min(timeout, 25000);
  const browser = await getSharedBrowser();
  const viewport = opts?.viewport ?? { width: 1920, height: 1080 };
  const context = await browser.newContext({
    viewport,
    userAgent: opts?.userAgent ?? DEFAULT_UA,
    locale: "zh-CN",
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeout, 45000) });
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 12000 });
        break;
      } catch {
        /* try next */
      }
    }
    await waitForSpaRender(page, minBodyText, spaWaitMs);
    await page.evaluate(PW_SCROLL_HALF);
    await page.waitForTimeout(2000);
    const payload = (await page.evaluate(`${PW_EXTRACT_ARTICLE_DOM}(${JSON.stringify(selectors)})`)) as {
      title?: string;
      innerHtml?: string;
      textLen?: number;
    } | null;
    if (!payload?.innerHtml || (payload.textLen ?? 0) < 120) return "";
    const safeTitle = escapeHtml(payload.title || "文章");
    return `<!DOCTYPE html><html><head><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><article class="article-content">${payload.innerHtml}</article></body></html>`;
  } finally {
    await context.close();
  }
}

async function fetchWithPlaywrightDomExtract(
  url: string,
  timeout: number,
  selectors: string[],
  opts?: { minBodyText?: number; spaWaitMs?: number },
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const html = await fetchWithPlaywrightDomExtractOnce(url, timeout, selectors, opts);
    if (html) return html;
    if (attempt === 0) {
      console.warn(`[DOM extract] 首次未取到正文，1.5s 后重试: ${url}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return "";
}

// ============================================
// 平台专用获取器
// ============================================

/** 知乎：Cookie HTTP → Playwright stealth → Jina */
class ZhihuFetcher implements ContentFetcher {
  name = "zhihu";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const http = await fetchZhihuViaHttp(url, Math.min(effective, 15000));
    if (http) return http;
    const html = await fetchWithPlaywright(url, { isZhihu: true, timeout: effective });
    if (!looksLikeBlockedHtml(html, 150)) return html;
    console.warn(`[ZhihuFetcher] Playwright 疑似拦截，尝试 Jina Reader: ${url}`);
    return fetchJinaAsHtml(url, Math.min(effective, 20000));
  }
}

/** 微信：HTTP → Playwright(#js_content) → Jina */
class WechatFetcher implements ContentFetcher {
  name = "wechat";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const cookie = envCookieHeader("WECHAT_COOKIE");
    try {
      const html = await fetchHtml(
        url,
        { Referer: "https://mp.weixin.qq.com/", ...(cookie ? { Cookie: cookie } : {}) },
        effective,
      );
      if (hasWechatArticleHtml(html)) return html;
      if (html.includes("环境异常") || html.includes("完成验证")) {
        throw new Error("wechat anti-bot detected");
      }
    } catch {
      /* HTTP 失败或正文不足，继续 Playwright */
    }

    console.warn(`[WechatFetcher] HTTP 正文不足，降级 Playwright: ${url}`);
    const rendered = await fetchWithPlaywright(url, { isWechat: true, timeout: effective });
    if (hasWechatArticleHtml(rendered)) return rendered;

    console.warn(`[WechatFetcher] Playwright 仍不足，尝试 Jina Reader: ${url}`);
    return fetchJinaAsHtml(url, Math.min(effective, 20000));
  }
}

/** 小红书：HTTP → Playwright → Jina */
class XiaohongshuFetcher implements ContentFetcher {
  name = "xiaohongshu";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const cookie = envCookieHeader("XHS_COOKIE", "XIAOHONGSHU_COOKIE");
    try {
      const html = await fetchHtml(
        url,
        { Referer: "https://www.xiaohongshu.com/", ...(cookie ? { Cookie: cookie } : {}) },
        effective,
      );
      if (hasXiaohongshuArticleHtml(html)) return html;
    } catch {
      /* continue */
    }

    console.warn(`[XiaohongshuFetcher] HTTP 正文不足，降级 Playwright: ${url}`);
    const rendered = await fetchWithPlaywright(url, { isXiaohongshu: true, timeout: effective });
    if (hasXiaohongshuArticleHtml(rendered)) return rendered;

    console.warn(`[XiaohongshuFetcher] Playwright 仍不足，尝试 Jina Reader: ${url}`);
    return fetchJinaAsHtml(url, Math.min(effective, 20000));
  }
}

/** 抖音：HTTP → Playwright → Jina */
class DouyinFetcher implements ContentFetcher {
  name = "douyin";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const cookie = envCookieHeader("DOUYIN_COOKIE");
    try {
      const html = await fetchHtml(
        url,
        { Referer: "https://www.douyin.com/", ...(cookie ? { Cookie: cookie } : {}) },
        effective,
      );
      if (hasDouyinArticleHtml(html)) return html;
    } catch {
      /* continue */
    }

    console.warn(`[DouyinFetcher] HTTP 正文不足，降级 Playwright: ${url}`);
    const rendered = await fetchWithPlaywright(url, { isDouyin: true, timeout: effective });
    if (hasDouyinArticleHtml(rendered)) return rendered;

    console.warn(`[DouyinFetcher] Playwright 仍不足，尝试 Jina Reader: ${url}`);
    return fetchJinaAsHtml(url, Math.min(effective, 20000));
  }
}

/** B站：公开 API → HTTP → Playwright */
class BilibiliFetcher implements ContentFetcher {
  name = "bilibili";
  async fetch(url: string, timeout?: number): Promise<string> {
    const bvid = extractBvid(url);
    if (bvid) {
      try {
        return await fetchBilibiliViaApi(bvid, timeout);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[BilibiliFetcher] API 失败 (${msg})，降级 HTML/Playwright…`);
      }
    }
    try {
      const html = await fetchHtml(url, { Referer: "https://www.bilibili.com" }, timeout);
      if (html.includes("__INITIAL_STATE__") || html.includes("videoData")) {
        return html;
      }
    } catch {
      /* continue */
    }
    return fetchWithPlaywright(url, { timeout });
  }
}

/** 技术博客通用：HTTP → Playwright → DOM → Jina */
async function fetchTechArticle(
  url: string,
  timeout: number | undefined,
  opts: {
    referer: string;
    hasContent: (html: string) => boolean;
    label: string;
    waitSelector?: string;
    /** SPA 站点优先 DOM 提取，跳过耗时的 Playwright HTML 整页步骤 */
    domFirst?: boolean;
    domExtract?: { minBodyText?: number; spaWaitMs?: number; userAgent?: string; viewport?: { width: number; height: number } };
  },
): Promise<string> {
  const effective = timeout ?? 30000;
  const selectors = parseWaitSelectors(opts.waitSelector);
  const domOpts = opts.domExtract;

  try {
    const html = await fetchHtml(url, { Referer: opts.referer }, effective);
    if (opts.hasContent(html)) return html;
    if (looksLikeHttp404Shell(html, 80)) {
      throw new Error(`页面不存在或已删除 (${new URL(url).hostname})`);
    }
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw err;
    /* continue */
  }

  const tryDomExtract = async () => {
    console.warn(`[${opts.label}] HTTP 正文不足，尝试 DOM 提取: ${url}`);
    const domHtml = await fetchWithPlaywrightDomExtract(url, effective, selectors, domOpts);
    if (domHtml && opts.hasContent(domHtml)) return domHtml;
    return "";
  };

  const tryPlaywrightHtml = async () => {
    console.warn(`[${opts.label}] HTTP 正文不足，降级 Playwright: ${url}`);
    const rendered = await fetchWithPlaywright(url, { timeout: effective, waitSelector: opts.waitSelector });
    if (opts.hasContent(rendered)) return rendered;
    return "";
  };

  if (opts.domFirst) {
    const domHtml = await tryDomExtract();
    if (domHtml) return domHtml;
    const rendered = await tryPlaywrightHtml();
    if (rendered) return rendered;
  } else {
    const rendered = await tryPlaywrightHtml();
    if (rendered) return rendered;
    console.warn(`[${opts.label}] Playwright HTML 仍不足，尝试 DOM 提取: ${url}`);
    const domHtml = await fetchWithPlaywrightDomExtract(url, effective, selectors, domOpts);
    if (domHtml && opts.hasContent(domHtml)) return domHtml;
  }

  await closeSharedBrowser().catch(() => undefined);
  console.warn(`[${opts.label}] 重置浏览器后重试 DOM: ${url}`);
  const retryDom = await fetchWithPlaywrightDomExtract(url, effective, selectors, domOpts);
  if (retryDom && opts.hasContent(retryDom)) return retryDom;

  console.warn(`[${opts.label}] Playwright 仍不足，尝试 Jina Reader: ${url}`);
  return fetchJinaAsHtml(url, Math.min(effective, 20000));
}

/** 微博：HTTP → Playwright → Jina */
class WeiboFetcher implements ContentFetcher {
  name = "weibo";
  async fetch(url: string, timeout?: number): Promise<string> {
    return fetchTechArticle(url, timeout, {
      referer: "https://weibo.com/",
      hasContent: hasWeiboArticleHtml,
      label: "WeiboFetcher",
    });
  }
}

class JuejinFetcher implements ContentFetcher {
  name = "juejin";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const ssr = await fetchJuejinViaHttp(url, Math.min(effective, 12000));
    if (ssr) return ssr;
    return fetchTechArticle(url, timeout, {
      referer: "https://juejin.cn/",
      hasContent: hasJuejinArticleHtml,
      label: "JuejinFetcher",
      waitSelector: ".markdown-body, .article-content, article",
      domFirst: true,
      domExtract: { minBodyText: 300, spaWaitMs: 8000 },
    });
  }
}

class CnblogsFetcher implements ContentFetcher {
  name = "cnblogs";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const ssr = await fetchCnblogsViaHttp(url, Math.min(effective, 12000));
    if (ssr) return ssr;
    return fetchTechArticle(url, timeout, {
      referer: "https://www.cnblogs.com/",
      hasContent: hasCnblogsArticleHtml,
      label: "CnblogsFetcher",
      waitSelector: "#cnblogs_post_body",
      domFirst: false,
      domExtract: { minBodyText: 300, spaWaitMs: 8000 },
    });
  }
}

class CsdnFetcher implements ContentFetcher {
  name = "csdn";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const ssr = await fetchCsdnViaHttp(url, Math.min(effective, 12000));
    if (ssr) return ssr;
    return fetchTechArticle(url, timeout, {
      referer: "https://blog.csdn.net/",
      hasContent: hasCsdnArticleHtml,
      label: "CsdnFetcher",
      waitSelector: "#content_views, .blog-content-box",
      domFirst: false,
      domExtract: { minBodyText: 300, spaWaitMs: 8000 },
    });
  }
}

/** 从 InfoQ 文章 URL 提取 uuid */
export function extractInfoqArticleUuid(url: string): string | null {
  const match = url.match(/infoq\.cn\/article\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

/** 从 OSChina 新闻 URL 提取 id（/news/291686/...） */
export function extractOschinaNewsId(url: string): string | null {
  const match = url.match(/oschina\.net\/news\/(\d+)/i);
  return match?.[1] ?? null;
}

/** 从 SegmentFault 文章 URL 提取 id（/a/1190000046145001） */
export function extractSegmentfaultArticleId(url: string): string | null {
  const match = url.match(/segmentfault\.com\/a\/(\d+)/i);
  return match?.[1] ?? null;
}

function tagSegmentfaultSsrHtml(rawHtml: string, pageUrl?: string): string {
  let html = rawHtml;
  if (!html.includes('data-segmentfault-source="ssr"')) {
    if (/<body[\s>]/i.test(html)) {
      html = html.replace(/<body([^>]*)>/i, '<body data-segmentfault-source="ssr"$1>');
    } else {
      html = `<!DOCTYPE html><html><body data-segmentfault-source="ssr">${html}</body></html>`;
    }
  }
  return injectSegmentfaultAuthorMeta(html, pageUrl);
}

function injectSegmentfaultAuthorMeta(rawHtml: string, pageUrl?: string): string {
  if (rawHtml.includes('name="author"')) return rawHtml;
  let name = extractSegmentfaultAuthorFromPartialNextData(rawHtml, pageUrl);
  const nextData = rawHtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!name && nextData) {
    try {
      const data = JSON.parse(nextData) as {
        props?: {
          pageProps?: {
            initialState?: {
              articleDetail?: {
                artDetail?: Record<string, { article?: { user?: { name?: string; nickname?: string } } }>;
              };
            };
          };
        };
      };
      const artDetail = data.props?.pageProps?.initialState?.articleDetail?.artDetail ?? {};
      const articleId = pageUrl ? extractSegmentfaultArticleId(pageUrl) : null;
      const entry = (articleId && artDetail[articleId]) || Object.values(artDetail)[0];
      name = entry?.article?.user?.name || entry?.article?.user?.nickname || "";
    } catch {
      /* partial JSON — 已在上方 regex 尝试 */
    }
  }
  if (!name) return rawHtml;
  return injectAuthorMeta(rawHtml, name);
}

async function fetchSegmentfaultViaHttp(url: string, timeout: number): Promise<string | null> {
  try {
    const html = await fetchHtmlPartial(
      url,
      { Referer: "https://segmentfault.com/" },
      timeout,
      { isComplete: (html) => isSegmentfaultFetchComplete(html, url) },
    );
    if (!hasSegmentfaultArticleHtml(html)) return null;
    return tagSegmentfaultSsrHtml(html, url);
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw err;
    return null;
  }
}

function tagJuejinSsrHtml(rawHtml: string): string {
  if (rawHtml.includes('data-juejin-source="ssr"')) return rawHtml;
  if (/<body[\s>]/i.test(rawHtml)) {
    return rawHtml.replace(/<body([^>]*)>/i, '<body data-juejin-source="ssr"$1>');
  }
  return `<!DOCTYPE html><html><body data-juejin-source="ssr">${rawHtml}</body></html>`;
}

async function fetchJuejinViaHttp(url: string, timeout: number): Promise<string | null> {
  try {
    const html = await fetchHtmlPartial(
      url,
      { Referer: "https://juejin.cn/" },
      timeout,
      { isComplete: isJuejinFetchComplete },
    );
    if (!hasJuejinArticleHtml(html)) return null;
    return tagJuejinSsrHtml(html);
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw err;
    return null;
  }
}

function tagZhihuHttpHtml(rawHtml: string): string {
  if (rawHtml.includes('data-zhihu-source="cookie-http"')) return rawHtml;
  if (/<body[\s>]/i.test(rawHtml)) {
    return rawHtml.replace(/<body([^>]*)>/i, '<body data-zhihu-source="cookie-http"$1>');
  }
  return `<!DOCTYPE html><html><body data-zhihu-source="cookie-http">${rawHtml}</body></html>`;
}

async function fetchZhihuViaHttp(url: string, timeout: number): Promise<string | null> {
  const cookie = envCookieHeader("ZHIHU_COOKIE");
  if (!cookie) return null;
  try {
    const html = await fetchHtml(url, { Referer: "https://www.zhihu.com/", Cookie: cookie }, timeout);
    if (!hasZhihuArticleHtml(html)) return null;
    return tagZhihuHttpHtml(html);
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw err;
    return null;
  }
}

function tagCnblogsSsrHtml(rawHtml: string): string {
  if (rawHtml.includes('data-cnblogs-source="ssr"')) return rawHtml;
  if (/<body[\s>]/i.test(rawHtml)) {
    return rawHtml.replace(/<body([^>]*)>/i, '<body data-cnblogs-source="ssr"$1>');
  }
  return `<!DOCTYPE html><html><body data-cnblogs-source="ssr">${rawHtml}</body></html>`;
}

async function fetchCnblogsViaHttp(url: string, timeout: number): Promise<string | null> {
  try {
    const html = await fetchHtml(url, { Referer: "https://www.cnblogs.com/" }, timeout);
    if (!hasCnblogsArticleHtml(html)) return null;
    return tagCnblogsSsrHtml(html);
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw err;
    return null;
  }
}

function tagJianshuMobileHtml(rawHtml: string): string {
  if (rawHtml.includes('data-jianshu-source="mobile"')) return rawHtml;
  if (/<body[\s>]/i.test(rawHtml)) {
    return rawHtml.replace(/<body([^>]*)>/i, '<body data-jianshu-source="mobile"$1>');
  }
  return `<!DOCTYPE html><html><body data-jianshu-source="mobile">${rawHtml}</body></html>`;
}

async function fetchJianshuViaMobileHttp(url: string, timeout: number): Promise<string | null> {
  try {
    // 简书 Mobile 正文在 HTML 末段 show-content-free，流式早停易截断，保持全量 HTTP
    const html = await fetchHtml(
      url,
      { Referer: "https://www.jianshu.com/", "User-Agent": JIANSHU_MOBILE_UA },
      timeout,
    );
    if (looksLikeHttp404Shell(html, 80)) {
      throw new Error(`页面不存在或已删除 (jianshu.com)`);
    }
    if (!hasJianshuArticleHtml(html)) return null;
    return tagJianshuMobileHtml(html);
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw err;
    return null;
  }
}

/** CSDN SSR 页 head 内 var nickName，sidebar profile 在 recommend-box 之后会被早停截断 */
export function extractCsdnAuthorFromHtml(html: string): string {
  const nick = html.match(/var\s+nickName\s*=\s*"([^"]+)"/)?.[1]?.trim();
  if (nick) return nick;
  const uidTitle = html.match(/id=["']uid["'][^>]*title=["']([^"']+)["']/i)?.[1]?.trim();
  if (uidTitle) return uidTitle;
  const profile = html.match(/profile-intro-name[^>]*>([^<]{2,40})</i)?.[1]?.trim();
  return profile ?? "";
}

function injectCsdnAuthorMeta(rawHtml: string): string {
  const name = extractCsdnAuthorFromHtml(rawHtml);
  return name ? injectAuthorMeta(rawHtml, name) : rawHtml;
}

function tagCsdnSsrHtml(rawHtml: string): string {
  let html = rawHtml;
  if (!html.includes('data-csdn-source="ssr"')) {
    if (/<body[\s>]/i.test(html)) {
      html = html.replace(/<body([^>]*)>/i, '<body data-csdn-source="ssr"$1>');
    } else {
      html = `<!DOCTYPE html><html><body data-csdn-source="ssr">${html}</body></html>`;
    }
  }
  return injectCsdnAuthorMeta(html);
}

async function fetchCsdnViaHttp(url: string, timeout: number): Promise<string | null> {
  try {
    const html = await fetchHtmlPartial(
      url,
      { Referer: "https://blog.csdn.net/" },
      timeout,
      { isComplete: isCsdnFetchComplete },
    );
    if (!hasCsdnArticleHtml(html)) return null;
    return tagCsdnSsrHtml(html);
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) throw err;
    return null;
  }
}

export function parseOschinaNewsDetailXml(xml: string): { title: string; body: string; author?: string } | null {
  const title =
    xml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]?.trim() ??
    xml.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ??
    "";
  const body =
    xml.match(/<body><!\[CDATA\[([\s\S]*?)\]\]><\/body>/i)?.[1]?.trim() ??
    xml.match(/<body>([\s\S]*?)<\/body>/i)?.[1]?.trim() ??
    "";
  const author =
    xml.match(/<author><!\[CDATA\[([\s\S]*?)\]\]><\/author>/i)?.[1]?.trim() ??
    xml.match(/<author>([^<]+)<\/author>/i)?.[1]?.trim() ??
    "";
  if (!body) return null;
  return { title: title || "OSChina 新闻", body, author: author || undefined };
}

/** OSChina 官方 API：/action/api/news_detail（~1s，无需 Playwright） */
export async function fetchOschinaNewsViaApi(url: string, timeout: number): Promise<string | null> {
  const id = extractOschinaNewsId(url);
  if (!id) return null;
  try {
    const apiUrl = `https://www.oschina.net/action/api/news_detail?id=${encodeURIComponent(id)}`;
    const res = await fetchWithTimeout(apiUrl, timeout, {
      headers: { Referer: "https://www.oschina.net/", "User-Agent": DEFAULT_UA, Accept: "application/xml,text/xml,*/*" },
    });
    if (!res.ok) return null;
    const parsed = parseOschinaNewsDetailXml(await res.text());
    if (!parsed) return null;
    let html = `<!DOCTYPE html><html><head><title>${escapeHtml(parsed.title)}</title></head><body data-oschina-source="api"><h1>${escapeHtml(parsed.title)}</h1><article class="news-content article-content">${parsed.body}</article></body></html>`;
    if (parsed.author) html = injectAuthorMeta(html, parsed.author);
    const plainLen = parsed.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
    if (plainLen < 40) return null;
    return hasOschinaArticleHtml(html, 40) ? html : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[oschinaFetcher] API 失败: ${msg}`);
    return null;
  }
}

type ProseMirrorNode = {
  type?: string;
  text?: string;
  content?: ProseMirrorNode[];
  attrs?: Record<string, unknown>;
};

function proseMirrorNodeToHtml(node: ProseMirrorNode): string {
  if (!node) return "";
  if (node.type === "text") return escapeHtml(node.text ?? "");
  const inner = (node.content ?? []).map(proseMirrorNodeToHtml).join("");
  switch (node.type) {
    case "paragraph":
      return `<p>${inner}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 4)));
      return `<h${level}>${inner}</h${level}>`;
    }
    case "image": {
      const src = String(node.attrs?.src ?? node.attrs?.href ?? "");
      return src ? `<img src="${escapeHtml(src)}" alt="" />` : inner;
    }
    case "codeinline":
      return `<code>${inner}</code>`;
    case "link":
      return inner;
    case "bulletlist":
    case "orderedlist":
      return `<ul>${inner}</ul>`;
    case "listitem":
      return `<li>${inner}</li>`;
    case "doc":
      return inner;
    default:
      return inner;
  }
}

function proseMirrorJsonToArticleHtml(doc: unknown, title: string, author?: string): string {
  const body = proseMirrorNodeToHtml(doc as ProseMirrorNode);
  const safeTitle = escapeHtml(title);
  let html = `<!DOCTYPE html><html><head><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><article class="article-content ProseMirror">${body}</article></body></html>`;
  if (author) html = injectAuthorMeta(html, author);
  return html;
}

/** InfoQ 官方 API：getDetail + content_url（~2s，无需 Playwright） */
export async function fetchInfoqArticleViaApi(url: string, timeout: number): Promise<string | null> {
  const uuid = extractInfoqArticleUuid(url);
  if (!uuid) return null;
  try {
    const detailRes = await fetchWithTimeout("https://www.infoq.cn/public/v1/article/getDetail", timeout, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://www.infoq.cn/",
        "User-Agent": DEFAULT_UA,
      },
      body: JSON.stringify({ uuid }),
    });
    if (!detailRes.ok) return null;
    const detail = (await detailRes.json()) as { code?: number; data?: Record<string, unknown> };
    if (detail.code !== 0 || !detail.data) return null;

    const contentUrl = String(detail.data.content_url ?? "");
    if (!contentUrl.startsWith("http")) return null;
    const title = String(detail.data.article_title ?? detail.data.article_sharetitle ?? "InfoQ 文章");
    const author = extractInfoqAuthorFromDetail(detail.data);

    const contentRes = await fetchWithTimeout(contentUrl, timeout, {
      headers: { Referer: "https://www.infoq.cn/", "User-Agent": DEFAULT_UA },
    });
    if (!contentRes.ok) return null;
    const doc = await contentRes.json();
    const html = proseMirrorJsonToArticleHtml(doc, title, author || undefined);
    return hasInfoqArticleHtml(html) ? html : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[infoqFetcher] API 失败: ${msg}`);
    return null;
  }
}

class InfoqFetcher implements ContentFetcher {
  name = "infoq";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const apiHtml = await fetchInfoqArticleViaApi(url, Math.min(effective, 15000));
    if (apiHtml) return apiHtml;
    return fetchTechArticle(url, timeout, {
      referer: "https://www.infoq.cn/",
      hasContent: hasInfoqArticleHtml,
      label: "infoqFetcher",
      waitSelector: ".ProseMirror, [article-preview-content], .article-content, article.main, main",
      domFirst: true,
      domExtract: { minBodyText: 300, spaWaitMs: 15000 },
    });
  }
}

class SegmentfaultFetcher implements ContentFetcher {
  name = "segmentfault";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const ssr = await fetchSegmentfaultViaHttp(url, Math.min(effective, 12000));
    if (ssr) return ssr;
    return fetchTechArticle(url, timeout, {
      referer: "https://segmentfault.com/",
      hasContent: hasSegmentfaultArticleHtml,
      label: "segmentfaultFetcher",
      waitSelector: "#articleContent, .article-content",
      domFirst: false,
      domExtract: { minBodyText: 300, spaWaitMs: 8000 },
    });
  }
}

class OschinaFetcher implements ContentFetcher {
  name = "oschina";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const apiHtml = await fetchOschinaNewsViaApi(url, Math.min(effective, 12000));
    if (apiHtml) return apiHtml;
    return fetchTechArticle(url, timeout, {
      referer: "https://www.oschina.net/",
      hasContent: hasOschinaArticleHtml,
      label: "oschinaFetcher",
      waitSelector: ".news-content, .article-content, #articleContent, .detail-body, article",
      domFirst: true,
      domExtract: { minBodyText: 300, spaWaitMs: 12000 },
    });
  }
}

function createTechFetcher(
  name: string,
  referer: string,
  hasContent: (html: string) => boolean,
  waitSelector?: string,
): ContentFetcher {
  return {
    name,
    async fetch(url: string, timeout?: number) {
      return fetchTechArticle(url, timeout, { referer, hasContent, label: `${name}Fetcher`, waitSelector });
    },
  };
}

class JianshuFetcher implements ContentFetcher {
  name = "jianshu";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 30000;
    const mobile = await fetchJianshuViaMobileHttp(url, Math.min(effective, 12000));
    if (mobile) return mobile;
    await closeSharedBrowser().catch(() => undefined);
    return fetchTechArticle(url, timeout, {
      referer: "https://www.jianshu.com/",
      hasContent: hasJianshuArticleHtml,
      label: "jianshuFetcher",
      waitSelector: "article .show-content, .show-content, #note .show-content, article",
      domFirst: false,
      domExtract: {
        minBodyText: 200,
        spaWaitMs: 8000,
        userAgent: JIANSHU_MOBILE_UA,
        viewport: { width: 390, height: 844 },
      },
    });
  }
}

// ============================================
// 通用获取链路：HTTP → Jina → Playwright
// ============================================

class GenericFetcher implements ContentFetcher {
  name = "generic";

  async fetch(url: string, timeout?: number): Promise<string> {
    const total = timeout ?? 10000;
    const httpTimeout = Math.min(total, 8000);
    const jinaTimeout = Math.min(total, 12000);
    const isPlainRemote =
      url.includes("raw.githubusercontent.com") ||
      url.includes("gist.githubusercontent.com") ||
      /\.(md|txt|markdown)(\?|$)/i.test(url);
    // L1: HTTP fetch(最快)
    try {
      const html = await fetchHtml(
        url,
        isPlainRemote ? { Accept: "text/plain,text/markdown,*/*" } : undefined,
        isPlainRemote ? Math.max(httpTimeout, 20000) : httpTimeout,
      );
      return html;
    } catch {
      // continue
    }

    // L2: Jina Reader(云端渲染)
    try {
      return await fetchJinaAsHtml(url, jinaTimeout);
    } catch {
      if (isPlainRemote) {
        throw new Error("纯文本远程资源 HTTP/Jina 获取失败");
      }
      // continue to Playwright
    }

    // L3: Playwright 兜底(本地浏览器) — networkidle 易卡住，改用 domcontentloaded
    return fetchWithPlaywright(url, { timeout: total });
  }
}

export interface GithubContentParts {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

/** 解析 raw.githubusercontent.com 或 github.com blob/raw 链接 */
export function parseGithubContentUrl(url: string): GithubContentParts | null {
  try {
    const u = new URL(url);
    if (u.hostname === "raw.githubusercontent.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length < 4) return null;
      const [owner, repo, ref, ...rest] = parts;
      return { owner, repo, ref, path: rest.join("/") };
    }
    if (u.hostname === "github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 4 && (parts[2] === "blob" || parts[2] === "raw")) {
        const [owner, repo, , ref, ...rest] = parts;
        return { owner, repo, ref, path: rest.join("/") };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function buildGithubRawUrl(parts: GithubContentParts): string {
  return `https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${parts.ref}/${parts.path}`;
}

export function buildJsDelivrGithubUrl(parts: GithubContentParts): string {
  return `https://cdn.jsdelivr.net/gh/${parts.owner}/${parts.repo}@${parts.ref}/${parts.path}`;
}

export function buildGithubApiContentsUrl(parts: GithubContentParts): string {
  return `https://api.github.com/repos/${parts.owner}/${parts.repo}/contents/${parts.path}?ref=${encodeURIComponent(parts.ref)}`;
}

/** 将 github.com/blob 转为 raw 链接；已是 raw 则返回 null */
export function normalizeGithubReadUrl(url: string): string | null {
  const parts = parseGithubContentUrl(url);
  if (!parts) return null;
  if (url.includes("raw.githubusercontent.com")) return null;
  return buildGithubRawUrl(parts);
}

function wrapGithubRawAsHtml(sourceUrl: string, text: string): string {
  const title = decodeURIComponent(sourceUrl.split("/").pop() || "README");
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(text);
  return `<!DOCTYPE html><html><head><title>${safeTitle}</title></head><body><article class="markdown-body"><pre>${safeBody}</pre></article></body></html>`;
}

async function fetchGithubApiFileText(apiUrl: string, token: string | undefined, timeoutMs: number): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": DEFAULT_UA,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchWithTimeout(apiUrl, timeoutMs, { headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const json = JSON.parse(body) as { content?: string; encoding?: string };
  if (json.encoding !== "base64" || !json.content) throw new Error("GitHub API 无 base64 内容");
  return Buffer.from(json.content.replace(/\n/g, ""), "base64").toString("utf-8");
}

/** GitHub raw / gist 纯文本：jsDelivr + raw + GitHub API 并行竞速，不走 Playwright */
class GithubRawFetcher implements ContentFetcher {
  name = "github-raw";
  async fetch(url: string, timeout?: number): Promise<string> {
    const effective = timeout ?? 25000;
    const httpTry = Math.min(effective, 12000);
    const apiTry = Math.min(effective, 15000);
    const token = process.env.GITHUB_TOKEN?.trim() || process.env.VITE_GITHUB_TOKEN?.trim();
    const parts = parseGithubContentUrl(url);

    type Candidate = { label: string; fetch: () => Promise<string> };
    const candidates: Candidate[] = [];

    if (parts) {
      candidates.push({
        label: "jsdelivr",
        fetch: () =>
          fetchHtml(buildJsDelivrGithubUrl(parts), { Accept: "text/plain,text/markdown,*/*" }, httpTry),
      });
      candidates.push({
        label: "raw",
        fetch: () =>
          fetchHtml(buildGithubRawUrl(parts), { Accept: "text/plain,text/markdown,*/*" }, httpTry),
      });
      candidates.push({
        label: "github-api",
        fetch: () => fetchGithubApiFileText(buildGithubApiContentsUrl(parts), token, apiTry),
      });
    } else {
      candidates.push({
        label: "raw",
        fetch: () => fetchHtml(url, { Accept: "text/plain,text/markdown,*/*" }, httpTry),
      });
    }

    const tasks = candidates.map((c) =>
      c
        .fetch()
        .then((text) => {
          if (text.trim().length < 20) throw new Error(`${c.label} 正文过短`);
          return wrapGithubRawAsHtml(url, text);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Fetcher] github-raw ${c.label} failed: ${msg}`);
          throw err instanceof Error ? err : new Error(msg);
        }),
    );

    try {
      return await Promise.any(tasks);
    } catch (err: unknown) {
      if (err instanceof AggregateError && err.errors.length > 0) {
        const last = err.errors[err.errors.length - 1];
        throw last instanceof Error ? last : new Error("GitHub raw 获取失败");
      }
      throw err instanceof Error ? err : new Error("GitHub raw 获取失败");
    }
  }
}

// ============================================
// 获取器注册表(按 platform 映射)
// ============================================

const FETCHER_MAP: Record<string, ContentFetcher> = {
  "github-raw": new GithubRawFetcher(),
  zhihu: new ZhihuFetcher(),
  ZhihuCollection: new ZhihuFetcher(),
  wechat: new WechatFetcher(),
  xiaohongshu: new XiaohongshuFetcher(),
  douyin: new DouyinFetcher(),
  bilibili: new BilibiliFetcher(),
  weibo: new WeiboFetcher(),
  juejin: new JuejinFetcher(),
  csdn: new CsdnFetcher(),
  infoq: new InfoqFetcher(),
  segmentfault: new SegmentfaultFetcher(),
  oschina: new OschinaFetcher(),
  cnblogs: new CnblogsFetcher(),
  jianshu: new JianshuFetcher(),
};

/** 根据 URL 解析 hostname */
/**
 * detectPlatform 函数
 *
 * @param hostname - 参数(string)
 * @returns 返回值(string)
 */
export function detectPlatform(hostname: string): string {
  if (hostname.includes("raw.githubusercontent.com") || hostname.includes("gist.githubusercontent.com")) {
    return "github-raw";
  }
  if (hostname.includes("github.com") || hostname.includes("github.io")) return "github";
  if (hostname.includes("stackoverflow.com")) return "stackoverflow";
  if (hostname.includes("zhihu.com")) return "zhihu";
  if (hostname.includes("mp.weixin.qq.com")) return "wechat";
  if (hostname.includes("xiaohongshu.com") || hostname.includes("xhslink.com")) return "xiaohongshu";
  if (hostname.includes("douyin.com") || hostname.includes("iesdouyin.com")) return "douyin";
  if (hostname.includes("bilibili.com") || hostname.includes("b23.tv")) return "bilibili";
  if (hostname.includes("weibo.com") || hostname.includes("weibo.cn")) return "weibo";
  if (hostname.includes("juejin.cn")) return "juejin";
  if (hostname.includes("csdn.net")) return "csdn";
  if (hostname.includes("cnblogs.com")) return "cnblogs";
  if (hostname.includes("jianshu.com")) return "jianshu";
  if (hostname.includes("infoq.cn")) return "infoq";
  if (hostname.includes("segmentfault.com")) return "segmentfault";
  if (hostname.includes("oschina.net")) return "oschina";
  return "unknown";
}

/** 根据 platform 标识获取原始 HTML */
export async function fetchContent(
  url: string,
  platform: string,
  timeout?: number
): Promise<FetchedContent> {
  const fetcher = FETCHER_MAP[platform];

  if (fetcher) {
    try {
      const html = await fetcher.fetch(url, timeout);
      return {
        html,
        fetcher: fetcher.name,
        method: resolveFetchedMethod(platform, html, fetcher.name),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isArticleFetchFatalError(err)) throw err;
      if (platform === "github-raw") throw err instanceof Error ? err : new Error(msg);
      console.warn(`[Fetcher] ${fetcher.name} failed for ${url}: ${msg}. Falling back to generic...`);
    }
  }

  // 兜底：通用获取器
  const generic = new GenericFetcher();
  const html = await generic.fetch(url, timeout);
  return {
    html,
    fetcher: generic.name,
    method: generic.name,
  };
}
