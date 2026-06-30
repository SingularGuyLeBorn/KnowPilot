/**
 * 搜索引擎优先级 — 有 Tavily Key 时跳过慢/不稳定的 DuckDuckGo 前置
 */

import type { SearchEngineName } from "./types.js";

export const DEFAULT_SEARCH_PRIORITY: SearchEngineName[] = [
  "bing_crawler",
  "duckduckgo",
  "baidu_qianfan",
  "tavily",
  "metaso",
  "bocha",
  "langsearch",
  "serpapi",
  "brave",
  "bing",
  "searxng",
];

export interface SearchPriorityOptions {
  /** SEARCH_ENGINE_PRIORITY 原始字符串 */
  envPriority?: string;
  hasTavily?: boolean;
  hasSerpApi?: boolean;
  hasBaiduQianfan?: boolean;
}

/** 解析最终引擎尝试顺序（env 多值优先；单值原样；无 env 则智能默认） */
export function resolveSearchEnginePriority(opts: SearchPriorityOptions): SearchEngineName[] {
  const raw = (opts.envPriority ?? "").trim();
  if (raw.includes(",")) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as SearchEngineName[];
  }
  if (raw) {
    return [raw as SearchEngineName];
  }

  if (opts.hasTavily) {
    const boosted: SearchEngineName[] = [
      "bing_crawler",
      "tavily",
      "serpapi",
      "duckduckgo",
      "baidu_qianfan",
      "metaso",
      "bocha",
      "langsearch",
      "brave",
      "bing",
      "searxng",
    ];
    return dedupePriority(boosted);
  }

  if (opts.hasSerpApi) {
    return dedupePriority(["bing_crawler", "serpapi", "duckduckgo", ...DEFAULT_SEARCH_PRIORITY.slice(2)]);
  }

  return [...DEFAULT_SEARCH_PRIORITY];
}

function dedupePriority(list: SearchEngineName[]): SearchEngineName[] {
  const seen = new Set<string>();
  const out: SearchEngineName[] = [];
  for (const name of list) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** integration:smoke / 诊断用：单引擎 env 时扩展降级链 */
export function expandSmokeSearchPriority(envPriority: string, hasTavily: boolean): string {
  if (envPriority.includes(",")) return envPriority;
  if (hasTavily) return "bing_crawler,tavily,serpapi,duckduckgo";
  return "bing_crawler,duckduckgo,tavily,serpapi";
}

export interface SearchKeyFlags {
  envPriority?: string;
  tavilyApiKey?: string;
  serpApiKey?: string;
  baiduQianfanApiKey?: string;
}

/** 从 AppConfig.search 生成运行时 SEARCH_ENGINE_PRIORITY 字符串 */
export function buildEffectiveSearchPriorityString(flags: SearchKeyFlags): string {
  const envRaw = (flags.envPriority ?? "").trim();
  if (envRaw.includes(",")) return envRaw;

  const hasTavily = !!(flags.tavilyApiKey && flags.tavilyApiKey.length > 5);
  if (envRaw && !envRaw.includes(",")) {
    return expandSmokeSearchPriority(envRaw, hasTavily);
  }

  return resolveSearchEnginePriority({
    hasTavily,
    hasSerpApi: !!(flags.serpApiKey && flags.serpApiKey.length > 5),
    hasBaiduQianfan: !!(flags.baiduQianfanApiKey && flags.baiduQianfanApiKey.length > 5),
  }).join(",");
}
