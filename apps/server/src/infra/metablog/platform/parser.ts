/**
 * ============================================================================
 * 平台解析路由 - parser
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/routes/platform
 */


import type { ParseResult, PlatformExtractConfig, ParseOptions } from "./types";
import { MAX_CONTENT_CHARS } from "./types";
import { ocrRemoteImage, downloadImageToTemp } from "../ocrBridge.js";
import { uploadFileToKimi } from "../kimiStub.js";
import fs from "fs";

// ============================================
// 基础工具
// ============================================

/**
 * 提取Meta
 *
 * @param html - 参数(string)
 * @param name - 参数(string)
 * @returns 返回值(string)
 */
export function extractMeta(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]*(?:property|name)="${name}"[^>]*content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

/**
 * cleanHtml 函数
 *
 * @param html - 参数(string)
 * @returns 返回值(string)
 */
export function cleanHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从对象按路径取值,支持 * 通配符(取第一个匹配) */
function getByPath(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    if (part === "*") {
      if (Array.isArray(current)) {
        current = current[0];
      } else if (typeof current === "object") {
        const keys = Object.keys(current);
        current = keys.length > 0 ? current[keys[0]] : undefined;
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }
  return current;
}

/** 从 HTML 中提取图片 URL */
function extractImagesFromHtml(html: string, attributes: string[] = ["src"]): string[] {
  const attrPattern = attributes.join("|");
  const regex = new RegExp(`<img[^>]*(?:${attrPattern})="([^"]+)"`, "g");
  const matches = Array.from(html.matchAll(regex));
  return matches
    .map((m) => m[1])
    .filter((src) => !isNoiseImageUrl(src))
    .slice(0, 20);
}

function isNoiseImageUrl(src: string): boolean {
  return (
    !src.startsWith("http") ||
    src.includes("avatar") ||
    src.includes("favicon") ||
    src.includes("prodtouch") ||
    src.includes("touch-icon") ||
    /\/icon[^/]*\.(png|jpe?g|gif|webp)/i.test(src)
  );
}

// ============================================
// HTML → Markdown(核心)
// ============================================

/**
 * htmlToMarkdown 函数
 *
 * @param html - 参数(string)
 * @returns 返回值(string)
 */
export function htmlToMarkdown(html: string): string {
  try {
    const TurndownService = require("turndown");
    const turndownService = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });

    // figure 处理
    turndownService.addRule("figure", {
      filter: ["figure"],
      replacement: (content: string, node: any) => {
        const img = node.querySelector("img");
        const caption = node.querySelector("figcaption");
        if (img) {
          const src = img.getAttribute("src") || img.getAttribute("data-actualsrc") || "";
          const capText = caption ? caption.textContent.trim() : "";
          return capText
            ? `\n\n![${capText}](${src})\n\n*${capText}*\n\n`
            : `\n\n![](${src})\n\n`;
        }
        return content;
      },
    });

    // noscript 懒加载图片
    turndownService.addRule("noscriptImg", {
      filter: ["noscript"],
      replacement: (content: string) => {
        const imgMatch = content.match(/<img[^>]*src="([^"]+)"/);
        if (imgMatch) {
          return `\n\n![](${imgMatch[1]})\n\n`;
        }
        return "";
      },
    });

    return turndownService.turndown(html).trim();
  } catch {
    return cleanHtml(html);
  }
}

// ============================================
// 平台预处理钩子(配置化,非独立解析器)
// ============================================

function preprocessZhihuHtml(html: string): string {
  // 知乎图片懒加载：data-actualsrc → src
  return html.replace(
    /<img([^>]*)data-actualsrc="([^"]+)"([^>]*)>/g,
    '<img$1src="$2"$3>'
  );
}

function preprocessWechatHtml(html: string): string {
  // 微信图片：data-src → src
  return html.replace(
    /<img([^>]*)data-src="([^"]+)"([^>]*)>/g,
    '<img$1src="$2"$3>'
  );
}

// ============================================
// 平台适配配置(不是"专用解析器")
// ============================================

const PLATFORM_CONFIGS: Record<string, PlatformExtractConfig> = {
  zhihu: {
    jsonScriptPatterns: [
      // 专栏文章
      {
        selector: '#js-initialData',
        contentPath: 'initialState.entities.articles.*.content',
        titlePath: 'initialState.entities.articles.*.title',
        authorPath: 'initialState.entities.articles.*.author.name',
      },
      // 问题/回答页面
      {
        selector: '#js-initialData',
        contentPath: 'initialState.entities.answers.*.content',
        titlePath: 'initialState.entities.answers.*.question.title',
        authorPath: 'initialState.entities.answers.*.author.name',
      },
    ],
    inlineScriptPatterns: [
      // 专栏文章
      {
        regex: 'window\\._INITIAL_STATE_\\s*=\\s*({.+?});\\s*</script>',
        flags: 's',
        contentPath: 'entities.articles.*.content',
        titlePath: 'entities.articles.*.title',
        authorPath: 'entities.articles.*.author.name',
      },
      // 问题/回答页面
      {
        regex: 'window\\._INITIAL_STATE_\\s*=\\s*({.+?});\\s*</script>',
        flags: 's',
        contentPath: 'entities.answers.*.content',
        titlePath: 'entities.questions.*.title',
        authorPath: 'entities.answers.*.author.name',
      },
    ],
    contentSelectors: ['.Post-RichTextContainer', '.RichContent-inner'],
    titleSelectors: ['.Post-Title', '.QuestionHeader-title', 'h1'],
    authorSelectors: ['.AuthorInfo-name', 'a.UserLink-link'],
    imageAttributes: ['src', 'data-actualsrc'],
    preprocess: preprocessZhihuHtml,
  },
  wechat: {
    contentSelectors: ['#js_content'],
    titleSelectors: ['h1.rich_media_title'],
    authorSelectors: ['#js_name'],
    imageAttributes: ['src', 'data-src'],
    preprocess: preprocessWechatHtml,
  },
  xiaohongshu: {
    contentSelectors: ['#detail-desc', '.desc', 'span.desc'],
    titleSelectors: ['h1', '.title'],
    authorSelectors: ['.author', '.nickname'],
  },
  bilibili: {
    inlineScriptPatterns: [
      {
        regex: 'window\\.__INITIAL_STATE__=([\\s\\S]*?);\\(function\\(\\)',
        contentPath: 'videoData.desc',
        titlePath: 'videoData.title',
        authorPath: 'videoData.owner.name',
      },
    ],
    contentSelectors: ['article.desc pre', 'article.desc', '.desc'],
    titleSelectors: ['h1'],
  },
  weibo: {},
  douyin: {
    contentSelectors: ['.desc'],
    titleSelectors: ['h1', '.title'],
    authorSelectors: ['.author', '.nickname'],
  },
  // ─── 技术文章平台 ───
  juejin: {
    contentSelectors: ['.markdown-body', '.article-content', '.main-area article'],
    titleSelectors: ['.article-title', 'h1'],
    authorSelectors: ['.author-info-box .username', '.username'],
    imageAttributes: ['src', 'data-src'],
  },
  csdn: {
    contentSelectors: ['#content_views', '.blog_container', '.article-content'],
    titleSelectors: ['#articleContentId', 'h1', '.title-article'],
    authorSelectors: ['meta[name="author"]', '.profile-intro-name', '.name', '.user-name'],
    imageAttributes: ['src', 'data-src'],
  },
  cnblogs: {
    contentSelectors: ['#cnblogs_post_body', '#post_detail', '.postBody'],
    titleSelectors: ['#cb_post_title_url', '#topics .postTitle', 'h1'],
    authorSelectors: ['#blog_post_info_block a', '.postDesc a', '.author'],
    imageAttributes: ['src'],
  },
  jianshu: {
    contentSelectors: ['.show-content-free', '.note-content', '[class*="show-content"]', '.show-content', 'article'],
    titleSelectors: ['h1.title', '.article-title', 'h1', '.note'],
    authorSelectors: ['meta[name="author"]', '.author-link .name', '.follow-detail .name', '.author .name'],
    imageAttributes: ['src', 'data-original-src'],
  },
  infoq: {
    contentSelectors: ['.article-content', '.content', 'article'],
    titleSelectors: ['h1', '.article-title'],
    authorSelectors: ['meta[name="author"]', '.author-name', '.author'],
    imageAttributes: ['src', 'data-src'],
  },
  segmentfault: {
    contentSelectors: ['#articleContent', '.article-content', '.article'],
    titleSelectors: ['h1', '.article-title'],
    authorSelectors: ['.author-card__name', '.user-info-name', '.username', '.author'],
    imageAttributes: ['src', 'data-src'],
  },
  oschina: {
    contentSelectors: ['.news-content', '.article-content', '.content', '#articleContent', '.detail-body'],
    titleSelectors: ['h1', '.article-title', '.news-title'],
    authorSelectors: ['meta[name="author"]', '.user-name', '.author-name'],
    imageAttributes: ['src', 'data-src'],
  },
  github: {
    contentSelectors: ['article.markdown-body', '.markdown-body', '#readme'],
    titleSelectors: ['h1', '.gh-header-title'],
    authorSelectors: ['.author', 'a.author'],
    imageAttributes: ['src', 'data-src'],
  },
  stackoverflow: {
    contentSelectors: ['#content', '.s-prose', '.post-text'],
    titleSelectors: ['#question-header h1', 'h1'],
    authorSelectors: ['.user-details a', '.owner .user-details'],
    imageAttributes: ['src'],
  },
  'ZhihuCollection': {
    contentSelectors: [],
    titleSelectors: ['h1'],
    authorSelectors: [],
  },
};

// ============================================
// Markdown 行号辅助函数
// ============================================

function addLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line, index) => `${index + 1} | ${line}`)
    .join("\n");
}

/** 过滤平台侧栏/CTA 误识别的作者名 */
function sanitizeAuthor(raw: string): string {
  const author = raw.replace(/\s+/g, " ").trim();
  if (!author) return "";
  if (/下载简书App|你也可以写文章赚赞赏|关注作者|写评论|登录后查看/i.test(author)) return "";
  if (/^posted\s*@/i.test(author) || /阅读\s*\(\d+\)/.test(author)) return "";
  if (/简书作者$/i.test(author)) return author.replace(/简书作者$/i, "").trim();
  if (author.length > 80) return "";
  return author;
}

async function extractCnblogsAuthorFromHtml(html: string): Promise<string> {
  try {
    const { JSDOM } = await import("jsdom");
    const doc = new JSDOM(html).window.document;
    for (const sel of ["#blog_post_info_block a", ".postDesc a", ".postDesc a[href*='cnblogs.com']"]) {
      const el = doc.querySelector(sel);
      const text = el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const cleaned = sanitizeAuthor(text);
      if (cleaned && !/^(收藏|举报)$/i.test(cleaned)) return cleaned;
    }
    const postDesc = doc.querySelector(".postDesc")?.textContent?.replace(/\s+/g, " ") ?? "";
    const m = postDesc.match(/@\s*[\d-]+\s+[\d:]+\s+(\S+)\s+阅读/i);
    if (m?.[1]) return sanitizeAuthor(m[1]);
  } catch {
    /* ignore */
  }
  return "";
}

async function extractJianshuAuthorFromHtml(html: string): Promise<string> {
  try {
    const { JSDOM } = await import("jsdom");
    const note = new JSDOM(html).window.document.querySelector(".note");
    if (!note) return "";
    for (const a of note.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      let text = a.textContent?.replace(/\s+/g, " ").trim() ?? "";
      text = text.replace(/简书作者$/i, "").trim();
      if (!text || /^(上一篇|下一篇)$/i.test(text)) continue;
      if (/^https?:\/\//i.test(href) && !href.includes("jianshu.com")) continue;
      const cleaned = sanitizeAuthor(text);
      if (cleaned) return cleaned;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 掘金等站点 title 重复拼接时去重 */
function normalizeTitle(raw: string): string {
  const title = raw.replace(/\s+/g, " ").trim();
  if (title.length < 20) return title;
  const half = Math.floor(title.length / 2);
  if (title.slice(0, half) === title.slice(half, half + half)) {
    return title.slice(0, half).trim();
  }
  for (let i = Math.floor(title.length / 2); i >= 10; i--) {
    const seg = title.slice(0, i);
    if (title.slice(i, i + seg.length) === seg) return seg.trim();
  }
  return title;
}

// ============================================
// OCR 嵌入辅助函数
// ============================================

const MAX_OCR_IMAGES = 5;
const OCR_CONCURRENCY = 3;
const OCR_TIMEOUT_MS = 20000;
const MAX_OCR_TEXT_LENGTH = 500;

/**
 * 对文章中的图片进行 OCR,并将结果嵌入 Markdown 对应位置. 
 * 用于非 vision 模型场景,让 AI 能"看到"图片中的文字内容. 
 */
async function embedOcrIntoMarkdown(content: string, images: string[]): Promise<string> {
  const targetImages = images.slice(0, MAX_OCR_IMAGES);
  const results = new Map<string, string>();

  // 分批并行 OCR,避免一次性触发太多请求
  for (let i = 0; i < targetImages.length; i += OCR_CONCURRENCY) {
    const batch = targetImages.slice(i, i + OCR_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          // 修复：原 Promise.race + setTimeout 模式在 OCR 成功后未 clearTimeout，
          // timer 持有 reject 闭包 20s 不被 GC。改为手动清除。
          const result = await new Promise<{ success: boolean; text: string }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("OCR 超时")), OCR_TIMEOUT_MS);
            ocrRemoteImage(url, "auto").then(
              (r) => { clearTimeout(timer); resolve(r); },
              (err) => { clearTimeout(timer); reject(err); },
            );
          });
          return { url, text: result.success ? result.text : "" };
        } catch (err: any) {
          console.error(`[OCR Embed] 图片 OCR 失败 ${url}: ${err.message}`);
          return { url, text: "" };
        }
      })
    );
    for (const { url, text } of batchResults) {
      if (text.trim()) results.set(url, text.trim());
    }
  }

  if (results.size === 0) return content;

  // 将 OCR 结果嵌入 Markdown 对应图片位置
  let result = content;
  const replacedUrls = new Set<string>();

  for (const [url, text] of results) {
    // 限制单张图片 OCR 结果长度,避免文章暴增
    const truncated =
      text.length > MAX_OCR_TEXT_LENGTH
        ? text.slice(0, MAX_OCR_TEXT_LENGTH) + "..."
        : text;

    // 转义 URL 中的正则特殊字符
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedUrl}\\)`, "g");

    result = result.replace(regex, (match) => {
      replacedUrls.add(url);
      const lines = truncated.split("\n").filter((line) => line.trim());
      if (lines.length === 0) return match;
      const formatted = lines.map((line) => `> ${line}`).join("\n");
      return `${match}\n\n> **图片内容：**\n${formatted}`;
    });
  }

  // 对于未能在正文中精确定位的图片,在文末追加
  const missedUrls = Array.from(results.keys()).filter((url) => !replacedUrls.has(url));
  if (missedUrls.length > 0) {
    const missedParts = missedUrls.map((url) => {
      const text = results.get(url)!;
      const truncated =
        text.length > MAX_OCR_TEXT_LENGTH
          ? text.slice(0, MAX_OCR_TEXT_LENGTH) + "..."
          : text;
      const lines = truncated.split("\n").filter((line) => line.trim());
      const formatted = lines.map((line) => `> ${line}`).join("\n");
      return `> **图片 [${url.slice(0, 60)}...]：**\n${formatted}`;
    });
    result += `\n\n---\n\n> **以下图片 OCR 结果(未在正文中定位到精确位置)：**\n\n${missedParts.join("\n\n")}`;
  }

  return result;
}

// ============================================
// Vision 图片上传辅助函数(Kimi file_id)
// ============================================

const MAX_VISION_IMAGES = 10;
const VISION_UPLOAD_CONCURRENCY = 3;

/**
 * 下载文章中的图片并上传到 Kimi,获取 file_id. 
 * 同时将 Markdown 中的图片 URL 替换为 ms://file_id,供消息层识别并转成 vision 输入. 
 * Vision 模型通过 ms://file_id 协议引用原图,不受 100MB 请求体限制. 
 */
async function fetchImageFilesForVision(
  content: string,
  images: string[]
): Promise<{ content: string; imageFiles: Array<{ file_id: string; url: string }> }> {
  const targetImages = images.slice(0, MAX_VISION_IMAGES);
  const results: Array<{ file_id: string; url: string }> = [];

  for (let i = 0; i < targetImages.length; i += VISION_UPLOAD_CONCURRENCY) {
    const batch = targetImages.slice(i, i + VISION_UPLOAD_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const tempPath = await downloadImageToTemp(url);
          try {
            const uploadResult = await uploadFileToKimi(tempPath, "image");
            return { file_id: uploadResult.fileId, url };
          } finally {
            fs.unlink(tempPath, (err) => {
              if (err) console.error("[Vision] 清理临时文件失败:", err.message);
            });
          }
        } catch (err: any) {
          console.error(`[Vision] 图片上传失败 ${url}: ${err.message}`);
          return null;
        }
      })
    );
    for (const result of batchResults) {
      if (result) results.push(result);
    }
  }

  // 不再替换 content 中的图片 URL(前端通过 /api/image-proxy 代理加载)
  // imageFiles 仅用于 vision 模型的 ms://file_id 引用
  return { content, imageFiles: results };
}

function prefersDedicatedDomExtract(method: string, html: string): boolean {
  if (
    method.endsWith("-ssr") ||
    method.endsWith("-mobile") ||
    method.endsWith("-api") ||
    method.endsWith("-cookie") ||
    method === "github-raw"
  ) {
    return true;
  }
  return /data-(?:jianshu|csdn|juejin|segmentfault|cnblogs|oschina|zhihu)-source=/i.test(html);
}

export async function parseHtmlToMarkdown(
  html: string,
  url: string,
  platform: string,
  fetcherMeta: { fetcher: string; method: string },
  options?: ParseOptions
): Promise<ParseResult> {
  if (platform === "github-raw") platform = "github";
  const config = PLATFORM_CONFIGS[platform] || {};

  let title = "";
  let author = "";
  let contentHtml = "";
  let content = "";
  let images: string[] = [];
  let extractMethod = "";
  let method = fetcherMeta.method;
  let videos: string[] = [];

  // 预处理 HTML
  if (config.preprocess) {
    html = config.preprocess(html);
  }

  // ====== 知乎收藏夹特殊处理 ======
  if (platform === "ZhihuCollection") {
    // 提取收藏夹标题
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "知乎收藏夹";

    // 提取收藏项 — 用通用正则匹配列表项
    const items: Array<{ title: string; url: string; excerpt: string; author: string }> = [];

    // 方式1: 匹配 Card 块
    const cardRegex = /<div[^>]*class="[^"]*(?:Card|List-item)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*(?:Card|List-item)|<\/div>\s*<\/div>\s*$)/gi;
    let cardMatch: RegExpExecArray | null;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const block = cardMatch[1];
      // 提取标题链接
      const linkMatch = block.match(/<h[23][^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[23]>/i);
      if (!linkMatch) continue;
      const href = linkMatch[1].trim();
      let itemTitle = linkMatch[2].replace(/<[^>]+>/g, "").trim();
      itemTitle = itemTitle.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

      // 提取摘要
      const excerptMatch = block.match(/<div[^>]*class="[^"]*(?:RichContent-inner|RichContent)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      let excerpt = excerptMatch ? excerptMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      excerpt = excerpt.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (excerpt.length > 200) excerpt = excerpt.slice(0, 200) + "...";

      // 提取作者
      const authorMatch = block.match(/<span[^>]*class="[^"]*(?:AuthorInfo-name|author)[^"]*"[^>]*>([^<]+)<\/span>/i);
      const itemAuthor = authorMatch ? authorMatch[1].trim() : "";

      const fullUrl = href.startsWith("http") ? href : `https://zhihu.com${href}`;
      items.push({ title: itemTitle, url: fullUrl, excerpt, author: itemAuthor });
    }

    // 方式2: 如果 Card 方式没匹配到,尝试匹配 ContentItem
    if (items.length === 0) {
      const itemRegex = /<div[^>]*class="[^"]*ContentItem[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(html)) !== null) {
        const block = itemMatch[1];
        const linkMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) continue;
        const href = linkMatch[1].trim();
        let itemTitle = linkMatch[2].replace(/<[^>]+>/g, "").trim();
        itemTitle = itemTitle.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const excerptMatch = block.match(/<div[^>]*class="[^"]*RichContent[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        let excerpt = excerptMatch ? excerptMatch[1].replace(/<[^>]+>/g, "").trim() : "";
        excerpt = excerpt.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        if (excerpt.length > 200) excerpt = excerpt.slice(0, 200) + "...";
        const authorMatch = block.match(/<span[^>]*class="[^"]*AuthorInfo[^"]*"[^>]*>([^<]+)<\/span>/i);
        const itemAuthor = authorMatch ? authorMatch[1].trim() : "";
        const fullUrl = href.startsWith("http") ? href : `https://zhihu.com${href}`;
        items.push({ title: itemTitle, url: fullUrl, excerpt, author: itemAuthor });
      }
    }

    // 格式化为 Markdown
    if (items.length > 0) {
      const mdParts: string[] = [];
      mdParts.push(`# ${title}`);
      mdParts.push(`\n共 ${items.length} 条收藏\n`);
      for (const item of items) {
        mdParts.push(`## ${item.title}`);
        if (item.author) mdParts.push(`- 作者: ${item.author}`);
        mdParts.push(`- 链接: ${item.url}`);
        if (item.excerpt) mdParts.push(`- 摘要: ${item.excerpt}`);
        mdParts.push("");
      }
      content = mdParts.join("\n");
    } else {
      content = `# ${title}\n\n未能解析到收藏内容. 可能原因:\n- 收藏夹需要登录才能查看\n- 页面结构发生变化\n- 该收藏夹为空\n\n建议: 确认收藏夹为公开状态,或提供单篇文章链接直接用 readArticle 读取.`;
    }

    return {
      title,
      author: "",
      content,
      images,
      videos,
      comments: [],
      metadata: { collectionUrl: url, itemCount: items.length },
      method: `${method}-collection`,
      platform,
      url,
    };
  }

  // ====== L1: 从 script#id 标签提取 JSON ======
  if (config.jsonScriptPatterns && !contentHtml) {
    for (const pattern of config.jsonScriptPatterns) {
      const regex = new RegExp(`<script[^>]*id="${pattern.selector.replace('#', '')}"[^>]*>[\\s\\S]*?</script>`, "i");
      const match = html.match(regex);
      if (match) {
        try {
          const jsonStr = match[0].replace(/<script[^>]*>/, "").replace(/<\/script>/, "").trim();
          const data = JSON.parse(jsonStr);

          // 知乎特殊处理：提取多个回答
          if (platform === "zhihu" && options?.maxAnswers && options.maxAnswers > 1) {
            const entities = data?.initialState?.entities;
            const answers = entities?.answers || {};
            const answerValues = Object.values(answers) as any[];
            if (answerValues.length > 0) {
              const max = Math.min(options.maxAnswers, answerValues.length);
              const parts: string[] = [];
              const authors: string[] = [];
              for (let i = 0; i < max; i++) {
                const ans = answerValues[i];
                if (ans?.content) {
                  parts.push(`<h3>回答 ${i + 1}${ans.author?.name ? `(${ans.author.name})` : ""}</h3>`);
                  parts.push(ans.content);
                  if (ans.author?.name) authors.push(ans.author.name);
                }
              }
              if (parts.length > 0) {
                contentHtml = parts.join("\n");
                title = title || getByPath(data, pattern.titlePath || "") || "";
                author = authors.join(", ") || getByPath(data, pattern.authorPath || "") || "";
                method = `zhihu-${max}-answers`;
                break; // 成功提取多个回答,跳出 pattern 循环
              }
            }
          }

          const extractedContent = getByPath(data, pattern.contentPath);
          if (extractedContent) {
            contentHtml = extractedContent;
            title = title || getByPath(data, pattern.titlePath || "") || "";
            author = author || getByPath(data, pattern.authorPath || "") || "";
            method = `${pattern.selector}-json`;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // ====== L2: 从 inline script 变量提取 JSON ======
  if (config.inlineScriptPatterns && !contentHtml) {
    for (const pattern of config.inlineScriptPatterns) {
      const regex = new RegExp(pattern.regex, pattern.flags || "");
      const match = html.match(regex);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          const extractedContent = getByPath(data, pattern.contentPath);
          if (extractedContent) {
            contentHtml = extractedContent;
            title = title || getByPath(data, pattern.titlePath || "") || "";
            author = author || getByPath(data, pattern.authorPath || "") || "";
            extractMethod = "inline-script-json";
            break;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  const tryPlatformDomSelectors = async () => {
    if (!config.contentSelectors || contentHtml) return;
    try {
      const { JSDOM } = await import("jsdom");
      const dom = new JSDOM(html, { url });
      const doc = dom.window.document;
      for (const selector of config.contentSelectors) {
        const el = doc.querySelector(selector);
        if (el && el.innerHTML.trim().length > 50) {
          contentHtml = el.innerHTML;
          extractMethod = extractMethod || `dom-selector-${selector}`;
          break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Parser] jsdom querySelector failed for ${platform}: ${msg}, falling back to regex`);
    }

    if (!contentHtml) {
      for (const selector of config.contentSelectors) {
        const className = selector.startsWith(".") ? selector.slice(1) : selector;
        const idName = selector.startsWith("#") ? selector.slice(1) : "";
        const attr = idName ? `id="${idName}"` : `class="[^"]*${className}[^"]*"`;
        const regex = new RegExp(`<[^>]*${attr}[^>]*>([\\s\\S]*?)</[^>]+>`, "i");
        const match = html.match(regex);
        if (match && match[1].trim().length > 50) {
          contentHtml = match[1];
          extractMethod = extractMethod || `dom-selector-${selector}`;
          break;
        }
      }
    }
  };

  // SSR/API/Mobile 快路径：DOM 选择器优先于 Readability，避免正文被截断
  if (prefersDedicatedDomExtract(fetcherMeta.method, html)) {
    await tryPlatformDomSelectors();
  }

  // ====== L3: Readability.js(通用最强去噪) ======
  if (!contentHtml) {
    try {
      const { JSDOM } = await import("jsdom");
      const { Readability } = await import("@mozilla/readability");
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article) {
        title = title || article.title || "";
        contentHtml = article.content || "";
        extractMethod = extractMethod || "readability-js";
        const articleImgMatches = (article.content || "").matchAll(/<img[^>]*src="(https?:\/\/[^"]+)"/g);
        images = Array.from(articleImgMatches, (m) => m[1]).filter(Boolean).slice(0, 10);
      }
    } catch {
      // ignore
    }
  }

  // ====== L4: DOM 选择器(平台适配配置) ======
  if (!contentHtml) {
    await tryPlatformDomSelectors();
  }

  // 标题选择器
  if (config.titleSelectors && !title) {
    try {
      const { JSDOM } = await import("jsdom");
      const dom = new JSDOM(html, { url });
      const doc = dom.window.document;
      for (const selector of config.titleSelectors) {
        const el = doc.querySelector(selector);
        if (el) {
          title = el.textContent?.trim() || "";
          if (title) break;
        }
      }
    } catch {
      // fallback to regex
      for (const selector of config.titleSelectors) {
        const className = selector.startsWith(".") ? selector.slice(1) : "";
        const tagName = /^[a-zA-Z0-9]+$/.test(selector) ? selector : "";
        let regex: RegExp;
        if (tagName) {
          regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
        } else {
          regex = new RegExp(`<[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</[^>]+>`, "i");
        }
        const match = html.match(regex);
        if (match) {
          title = match[1].replace(/<[^>]+>/g, "").trim();
          if (title) break;
        }
      }
    }
  }

  // 作者选择器
  if (config.authorSelectors && !author) {
    try {
      const { JSDOM } = await import("jsdom");
      const dom = new JSDOM(html, { url });
      const doc = dom.window.document;
      for (const selector of config.authorSelectors) {
        const el = doc.querySelector(selector);
        if (el) {
          if (el.tagName === "META") {
            author = el.getAttribute("content")?.trim() || "";
          } else {
            author = el.textContent?.trim() || "";
          }
          author = sanitizeAuthor(author);
          if (author) break;
        }
      }
    } catch {
      // fallback to regex
      for (const selector of config.authorSelectors) {
        const className = selector.startsWith(".") ? selector.slice(1) : "";
        const idName = selector.startsWith("#") ? selector.slice(1) : "";
        const attr = idName ? `id="${idName}"` : `class="[^"]*${className}[^"]*"`;
        const regex = new RegExp(`<[^>]*${attr}[^>]*>([\\s\\S]*?)</[^>]+>`, "i");
        const match = html.match(regex);
        if (match) {
          author = sanitizeAuthor(match[1].replace(/<[^>]+>/g, "").trim());
          if (author) break;
        }
      }
    }
  }

  // ====== L5: OG 标签兜底 ======
  if (!title) {
    title = extractMeta(html, "og:title")
      || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
      || "未知标题";
  }
  if (!author) {
    author = sanitizeAuthor(
      extractMeta(html, "author")
        || extractMeta(html, "og:article:author")
        || extractMeta(html, "og:author")
        || "",
    );
  }
  title = normalizeTitle(title);
  if (!author && platform === "jianshu") {
    author = await extractJianshuAuthorFromHtml(html);
  }
  if (!author && platform === "cnblogs") {
    author = await extractCnblogsAuthorFromHtml(html);
  }
  if (!author && platform === "jianshu") {
    const suffix = title.match(/\s[-–—]\s*(.+)$/);
    if (suffix) {
      author = sanitizeAuthor(suffix[1]);
      title = title.replace(/\s[-–—]\s*.+$/, "").trim();
    }
  }
  if (!contentHtml) {
    content = extractMeta(html, "og:description") || "";
    extractMethod = extractMethod || "og-extract";
  }

  // ====== 转换为 Markdown ======
  if (contentHtml) {
    if (/<[a-z][^>]*>/i.test(contentHtml)) {
      content = htmlToMarkdown(contentHtml);
      extractMethod = extractMethod || "html-to-markdown";
    } else {
      content = contentHtml.trim();
      extractMethod = extractMethod || "plain-text";
    }
  }

  // 最终兜底
  if (!content || content.trim().length === 0) {
    content = cleanHtml(html);
    extractMethod = extractMethod || "clean-html";
  }

  if (!author && platform === "segmentfault") {
    const plain = (contentHtml || html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const authorMatch = plain.match(/作者[：:]\s*([^\s，,。]{2,40})/);
    if (authorMatch) author = sanitizeAuthor(authorMatch[1]);
  }

  // 提取图片
  if (!images.length) {
    images = extractImagesFromHtml(contentHtml || html, config.imageAttributes);
  }
  const ogImage = extractMeta(html, "og:image");
  if (ogImage && !images.includes(ogImage) && !isNoiseImageUrl(ogImage)) {
    images.unshift(ogImage);
  }

  // 视频(抖音)
  if (platform === "douyin") {
    const videoMatches = html.matchAll(/<video[^>]*src="([^"]+)"/g);
    videos = Array.from(videoMatches).map((m) => m[1]).filter(Boolean).slice(0, 5);
  }

  // ====== 自动 OCR 嵌入 ======
  if (options?.embedOcr && images.length > 0) {
    content = await embedOcrIntoMarkdown(content, images);
  }

  // ====== 下载图片并上传 Kimi(vision 模型场景) ======
  let imageFiles: Array<{ file_id: string; url: string }> | undefined;
  if (options?.fetchImageFiles && images.length > 0) {
    const visionResult = await fetchImageFilesForVision(content, images);
    content = visionResult.content;
    imageFiles = visionResult.imageFiles;
  }

  // ====== 全文加行号(方便 AI 定位) ======
  content = addLineNumbers(content);
  images = images.filter((src) => !isNoiseImageUrl(src)).slice(0, 20);

  const fetchMethod =
    fetcherMeta.method.endsWith("-api") ||
    fetcherMeta.method.endsWith("-ssr") ||
    fetcherMeta.method.endsWith("-mobile") ||
    fetcherMeta.method.endsWith("-cookie") ||
    fetcherMeta.method === "api" ||
    fetcherMeta.method === "github-raw"
      ? fetcherMeta.method
      : extractMethod || method;

  return {
    title: title || `${platform} 内容`,
    author: author || "",
    content: content.slice(0, MAX_CONTENT_CHARS),
    images: images.slice(0, 20),
    imageFiles,
    videos,
    comments: [],
    metadata: { source: platform, method: fetchMethod, fetcher: fetcherMeta.fetcher },
    method: fetchMethod,
    platform,
    url,
  };
}
