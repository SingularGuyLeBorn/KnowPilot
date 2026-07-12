/**
 * ============================================================================
 * 搜索路由 - engines
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/routes/search
 */


/**
 * 多搜索引擎实现
 * 支持的引擎: 百度千帆、秘塔、博查、LangSearch、Tavily、Brave、Bing、DuckDuckGo、SearXNG、SerpAPI
 *
 * 设计原则: 
 * 1. 每个引擎独立实现,统一返回 SearchResult[] 格式
 * 2. 失败时抛出错误,由上层路由器处理 fallback
 * 3. 尽量使用国内可访问的端点
 */

import type { SearchResult } from "./types";

// ==================== 工具函数 ====================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 去除 HTML 标签 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解码 Bing 跟踪/跳转链接为真实 URL */
function unwrapBingRedirectUrl(url: string): string {
  try {
    const full = url.startsWith("http") ? url : `https://cn.bing.com${url}`;
    if (!full.includes("bing.com/ck/a") && !full.includes("bing.com/aclick")) {
      return url.startsWith("http") ? url : full;
    }
    const parsed = new URL(full);
    const target = parsed.searchParams.get("u") || parsed.searchParams.get("url");
    if (target) return decodeURIComponent(target);
  } catch {
    /* ignore */
  }
  return url;
}

function isBingInternalUrl(url: string): boolean {
  return /bing\.com\/(search|images|videos|news|maps)/i.test(url);
}

/** 解码 HTML 实体 */
function decodeHtmlEntities(str: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return str.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (match) => entities[match] || match);
}

// ==================== 1. 百度千帆搜索 ====================
/**
 * 百度千帆 AI 搜索
 * 免费额度: 每月 1500 次(约每天 50 次)
 * 文档: https://cloud.baidu.com/doc/qianfan/s/2mh4su4uy
 */
export async function searchBaiduQianfan(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch("https://qianfan.baidubce.com/v2/ai_search/web_search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: [{ content: query, role: "user" }],
      search_source: "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: Math.min(limit, 20) }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`百度千帆搜索失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const references = data.references || [];

  return references
    .filter((ref: any) => ref.url && ref.title)
    .map((ref: any) => ({
      title: ref.title,
      url: ref.url,
      snippet: ref.summary || ref.snippet || "",
      source: "baidu_qianfan",
    }));
}

// ==================== 2. 秘塔搜索 ====================
/**
 * 秘塔 AI 搜索
 * 有免费测试额度,0.03 元/次
 * 文档: https://metaso.cn
 */
export async function searchMetaso(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch("https://metaso.cn/api/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      q: query,
      scope: "webpage",
      includeSummary: false,
      size: String(Math.min(limit, 20)),
      includeRawContent: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`秘塔搜索失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const results = data.data?.searchResults?.results || data.results || [];

  return results
    .filter((r: any) => r.url && r.title)
    .map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content || r.snippet || "",
      source: "metaso",
    }));
}

// ==================== 3. 博查搜索 ====================
/**
 * 博查 AI 搜索
 * DeepSeek 官方合作伙伴,有免费额度
 * 文档: https://open.bochaai.com
 */
export async function searchBocha(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch("https://api.bochaai.com/v1/webSearch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      freshness: "noLimit",
      summary: false,
      count: Math.min(limit, 20),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`博查搜索失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const webPages = data.webPages?.value || data.results || [];

  return webPages
    .filter((r: any) => r.url && (r.name || r.title))
    .map((r: any) => ({
      title: r.name || r.title,
      url: r.url,
      snippet: r.snippet || "",
      source: "bocha",
    }));
}

// ==================== 4. LangSearch ====================
/**
 * LangSearch - 声称完全免费的搜索 API
 * 文档: https://langsearch.com
 */
export async function searchLangSearch(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch("https://api.langsearch.com/v1/webSearch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(limit, 20),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LangSearch 失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const results = data.results || data.data?.results || [];

  return results
    .filter((r: any) => r.url && r.title)
    .map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet || r.content || "",
      source: "langsearch",
    }));
}

// ==================== 5. Tavily ====================
/**
 * Tavily AI 搜索
 * 免费额度: 每月 1000 次
 * 文档: https://tavily.com
 */
export async function searchTavily(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.min(limit, 20),
      search_depth: "basic",
      include_answer: false,
      include_images: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily 搜索失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const results = data.results || [];

  return results
    .filter((r: any) => r.url && r.title)
    .map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content || r.snippet || "",
      source: "tavily",
    }));
}

// ==================== 6. Brave Search ====================
/**
 * Brave Search API
 * 免费额度: 每月 2000 次
 * 文档: https://brave.com/search/api/
 */
export async function searchBrave(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(limit, 20)));
  url.searchParams.set("offset", "0");

  const response = await fetch(url.toString(), {
    headers: {
      "X-Subscription-Token": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave 搜索失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const results = data.web?.results || [];

  return results
    .filter((r: any) => r.url && r.title)
    .map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description || "",
      source: "brave",
    }));
}

// ==================== 7. Bing Search ====================
/**
 * Bing Web Search API v7
 * 免费额度: 每月 1000 次(注意: 2025年8月11日微软宣布下线旧版)
 * 新版: https://www.microsoft.com/en-us/bing/apis/bing-web-search-api
 */
export async function searchBing(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const url = new URL("https://api.bing.microsoft.com/v7.0/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(limit, 20)));
  url.searchParams.set("mkt", "zh-CN");

  const response = await fetch(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bing 搜索失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const results = data.webPages?.value || [];

  return results
    .filter((r: any) => r.url && r.name)
    .map((r: any) => ({
      title: r.name,
      url: r.url,
      snippet: r.snippet || "",
      source: "bing",
    }));
}

// ==================== 8. Bing 爬虫(国内可用,免费兜底)====================
/**
 * Bing 搜索 HTML 爬虫
 * 使用 cn.bing.com,国内可直接访问,无需 API Key
 */
export async function searchBingCrawler(query: string, limit: number): Promise<SearchResult[]> {
  const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 30)}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      throw new Error(`Bing crawler failed: HTTP ${res.status}`)
    }

    const html = await res.text()
    const results = parseBingHtml(html, limit)

    if (results.length === 0) {
      throw new Error('Bing crawler returned no results')
    }

    return results
  } catch (error: any) {
    clearTimeout(timeoutId)
    throw error
  }
}

function parseBingHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []

  // Bing 搜索结果结构(两种可能的结构)
  // 结构 A: <li class="b_algo"><h2><a href="...">标题</a></h2><div class="b_caption"><p>摘要</p></div></li>
  // 结构 B: <div class="b_algo"><h2><a href="...">标题</a></h2><div class="b_caption"><p>摘要</p></div></div>

  const algoBlocks = html.match(/<li class="b_algo"[^>]*>[\s\S]*?<\/li>/gi) || []

  for (const block of algoBlocks) {
    if (results.length >= limit) break

    // 提取标题和链接
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)
    if (!titleMatch) continue

    let url = unwrapBingRedirectUrl(titleMatch[1].trim())
    const title = stripHtml(titleMatch[2]).trim()

    if (url.startsWith("/")) {
      url = unwrapBingRedirectUrl("https://cn.bing.com" + url)
    }

    const snippetMatch = block.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : ""

    if (!url || !title || isBingInternalUrl(url)) continue

    results.push({ title, url, snippet, source: "bing_crawler" })
  }

  // 如果结构 A 没解析到,尝试结构 B
  if (results.length === 0) {
    const divBlocks = html.match(/<div class="b_algo"[^>]*>[\s\S]*?<\/div>\s*(?=<div class="b_algo"|<\/ol>)/gi) || []
    for (const block of divBlocks) {
      if (results.length >= limit) break

      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*target="_blank"[^>]*>([\s\S]*?)<\/a>/i)
      if (!titleMatch) continue

      let url = unwrapBingRedirectUrl(titleMatch[1].trim())
      const title = stripHtml(titleMatch[2]).trim()

      if (url.startsWith("/")) {
        url = unwrapBingRedirectUrl("https://cn.bing.com" + url)
      }

      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : ""

      if (!url || !title || isBingInternalUrl(url)) continue

      results.push({ title, url, snippet, source: "bing_crawler" })
    }
  }

  return results
}

// ==================== 9. DuckDuckGo ====================
/**
 * DuckDuckGo HTML 版搜索(免费,无需 API Key)
 * 国内访问可能不稳定,建议配合代理使用
 */
export async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=zh-cn`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`DuckDuckGo search failed: HTTP ${res.status}`);
    }

    const html = await res.text();
    const results = parseDuckDuckGoHtml(html, limit);

    if (results.length === 0) {
      throw new Error("DuckDuckGo returned no results");
    }

    return results;
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo Lite 的结果结构解析
  const resultBlocks =
    html.match(
      /<div[^>]*class="result[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=<div[^>]*class="result|<\/div>\s*<\/div>\s*<\/body>|$)/gi
    ) || [];

  for (const block of resultBlocks) {
    if (results.length >= limit) break;

    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    let url = decodeHtmlEntities(titleMatch[1].trim());
    const title = stripHtml(titleMatch[2]).trim();

    // 解码 DuckDuckGo 重定向链接
    if (url.startsWith("/l/?")) {
      const uddg = new URLSearchParams(url.slice(3)).get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    }

    const snippetMatch = block.match(/<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]).trim() : "";

    // 过滤无效结果
    if (!url || url.startsWith("/") || !title) continue;
    if (url.includes("duckduckgo.com") || url.includes("duck.co")) continue;

    results.push({ title, url, snippet, source: "duckduckgo" });
  }

  return results;
}

// ==================== 9. SearXNG 公共实例 ====================
/**
 * SearXNG 元搜索引擎(完全免费,无需 API Key)
 * 使用公共实例列表中的可用实例
 * 文档: https://docs.searxng.org/dev/search_api.html
 */

// 国内/亚洲可用的 SearXNG 公共实例(定期更新)
const SEARXNG_INSTANCES = [
  "https://search.sapti.me",
  "https://searx.be",
  "https://search.bus-hit.me",
  "https://searx.tiekoetter.com",
  "https://search.mdosch.de",
];

/**
 * 搜索SearXNG
 *
 * @param query - 参数(string)
 * @param limit - 参数(number)
 * @returns 返回值(Promise<SearchResult[]>)
 */
export async function searchSearXNG(query: string, limit: number): Promise<SearchResult[]> {
  const errors: string[] = [];

  // 随机打乱实例顺序,避免集中访问同一个
  const shuffled = [...SEARXNG_INSTANCES].sort(() => Math.random() - 0.5);

  for (const instance of shuffled) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = new URL(`${instance}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("language", "zh-CN");
      url.searchParams.set("categories", "general");

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        errors.push(`${instance}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const results = data.results || [];

      if (results.length === 0) {
        errors.push(`${instance}: no results`);
        continue;
      }

      return results
        .filter((r: any) => r.url && r.title)
        .slice(0, limit)
        .map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.content || r.snippet || "",
          source: `searxng(${r.engine || "unknown"})`,
        }));
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      errors.push(`${instance}: ${error.message}`);
      continue;
    }
  }

  throw new Error(`SearXNG 所有实例均不可用: ${errors.join("; ")}`);
}


// ==================== 10. SerpAPI ====================
/**
 * SerpAPI 搜索
 * 免费额度: 每月 100 次
 * 文档: https://serpapi.com
 * 注意: SerpAPI 服务器在国外, 国内访问可能需要代理
 */
export async function searchSerpApi(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: apiKey,
    num: String(Math.min(limit, 10)),
    hl: "zh-CN",
  });

  const response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SerpAPI 搜索失败: HTTP ${response.status}, ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const organic = data.organic_results || [];

  return organic
    .filter((r: any) => r.link && r.title)
    .slice(0, limit)
    .map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet || "",
      source: "serpapi",
    }));
}
