/**
 * ============================================================================
 * 搜索路由 - router
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/routes/search
 */


import { getEnv } from "../env.js";
import type { SearchEngineConfig, SearchEngineName, SearchResponse, SearchResult } from "./types";
import {
  searchBaiduQianfan,
  searchBocha,
  searchBrave,
  searchBing,
  searchBingCrawler,
  searchDuckDuckGo,
  searchLangSearch,
  searchMetaso,
  searchSearXNG,
  searchSerpApi,
  searchTavily,
} from "./engines";
import { filterRelevantResults } from "./relevance.js";
import { resolveSearchEnginePriority } from "./priority.js";

// ==================== 配置读取 ====================

/** 默认引擎优先级(国内优先：无 Key 爬虫 → 有 Key API → 备用) */
const DEFAULT_PRIORITY = resolveSearchEnginePriority({});

/** 无需 API Key 即可尝试的引擎 */
const KEYLESS_ENGINES = new Set<SearchEngineName>(["bing_crawler", "duckduckgo", "searxng"]);

/** 仅对 HTML 爬虫结果做相关性过滤（API 引擎自身已排序） */
const RELEVANCE_FILTER_ENGINES = new Set<SearchEngineName>(["bing_crawler", "duckduckgo"]);

function isEngineConfigured(cfg: SearchEngineConfig): boolean {
  if (KEYLESS_ENGINES.has(cfg.name)) return true;
  return !!cfg.apiKey;
}

/** 读取环境变量 */
function env(key: string, fallback = ""): string {
  return getEnv(key) || getEnv(key.replace("SEARCH_", "")) || fallback;
}

/** 初始化引擎配置 */
function initEngineConfigs(): Map<SearchEngineName, SearchEngineConfig> {
  const customPriority = env("SEARCH_ENGINE_PRIORITY");
  const priorityList = resolveSearchEnginePriority({
    envPriority: customPriority,
    hasTavily: !!getApiKeyForEngine("tavily"),
    hasSerpApi: !!getApiKeyForEngine("serpapi"),
    hasBaiduQianfan: !!getApiKeyForEngine("baidu_qianfan"),
  });

  if (priorityList.length === 0) {
    return initEngineConfigsFallback(DEFAULT_PRIORITY);
  }

  return initEngineConfigsFallback(priorityList);
}

function initEngineConfigsFallback(priorityList: SearchEngineName[]): Map<SearchEngineName, SearchEngineConfig> {
  const configs = new Map<SearchEngineName, SearchEngineConfig>();

  for (let i = 0; i < priorityList.length; i++) {
    const name = priorityList[i];
    const apiKey = getApiKeyForEngine(name);

    configs.set(name, {
      name,
      enabled: true,
      apiKey: apiKey || undefined,
      priority: i,
      failCount: 0,
      lastFailTime: 0,
      disabledUntil: 0,
    });
  }

  return configs;
}

/** 获取引擎对应的 API Key */
function getApiKeyForEngine(name: SearchEngineName): string {
  const keyMap: Record<SearchEngineName, string[]> = {
    baidu_qianfan: ["SEARCH_BAIDU_QIANFAN_API_KEY", "BAIDU_QIANFAN_API_KEY", "QIANFAN_API_KEY"],
    metaso: ["SEARCH_METASO_API_KEY", "METASO_API_KEY"],
    bocha: ["SEARCH_BOCHA_API_KEY", "BOCHA_API_KEY"],
    langsearch: ["SEARCH_LANGSEARCH_API_KEY", "LANGSEARCH_API_KEY"],
    tavily: ["SEARCH_TAVILY_API_KEY", "TAVILY_API_KEY"],
    brave: ["SEARCH_BRAVE_API_KEY", "BRAVE_API_KEY"],
    bing: ["SEARCH_BING_API_KEY", "BING_API_KEY"],
    bing_crawler: [],
    duckduckgo: [],
    searxng: [],
    serpapi: ["SEARCH_SERPAPI_API_KEY", "SERPAPI_API_KEY"],
  };

  for (const key of keyMap[name] || []) {
    const value = env(key);
    if (value && value.length > 5 && !value.includes("your-")) {
      return value;
    }
  }
  return "";
}

// ==================== 引擎执行器 ====================

/** 执行单个引擎搜索 */
async function executeEngine(
  name: SearchEngineName,
  query: string,
  limit: number,
  apiKey?: string
): Promise<SearchResult[]> {
  switch (name) {
    case "baidu_qianfan":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchBaiduQianfan(query, limit, apiKey);
    case "metaso":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchMetaso(query, limit, apiKey);
    case "bocha":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchBocha(query, limit, apiKey);
    case "langsearch":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchLangSearch(query, limit, apiKey);
    case "tavily":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchTavily(query, limit, apiKey);
    case "brave":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchBrave(query, limit, apiKey);
    case "bing":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchBing(query, limit, apiKey);
    case "bing_crawler":
      return await searchBingCrawler(query, limit);
    case "duckduckgo":
      return await searchDuckDuckGo(query, limit);
    case "searxng":
      return await searchSearXNG(query, limit);
    case "serpapi":
      if (!apiKey) throw new Error("API Key not configured");
      return await searchSerpApi(query, limit, apiKey);
    default:
      throw new Error(`Unknown engine: ${name}`);
  }
}

// ==================== 健康度管理 ====================

const MAX_FAIL_COUNT = 3;
const DISABLE_DURATION_MS = 10 * 60 * 1000; // 禁用 10 分钟

/** 更新引擎健康状态 */
function recordSuccess(config: SearchEngineConfig): void {
  config.failCount = 0;
  config.disabledUntil = 0;
}

function recordFailure(config: SearchEngineConfig, error: string): void {
  config.failCount++;
  config.lastFailTime = Date.now();

  if (config.failCount >= MAX_FAIL_COUNT) {
    config.disabledUntil = Date.now() + DISABLE_DURATION_MS;
    console.warn(
      `[SearchRouter] 引擎 ${config.name} 连续失败 ${MAX_FAIL_COUNT} 次,临时禁用 ${DISABLE_DURATION_MS / 60000} 分钟. 错误: ${error}`
    );
  }
}

function isAvailable(config: SearchEngineConfig): boolean {
  if (!config.enabled) return false;
  if (config.disabledUntil > Date.now()) return false;
  return true;
}

// ==================== 主路由器 ====================

/** 整体搜索 deadline：必须小于外层 withToolTimeout 默认 30s。
 * 到点即抛带引擎明细的汇总错误，避免挂起被外层 race 截胡（错误无明细、LLM 盲目原样重试） */
const SMART_SEARCH_DEADLINE_MS = 25000;

/**
 * 给单次引擎尝试套整体 deadline 闸门：超时即 reject（走 catch 记失败换下一引擎），
 * 底层请求由引擎自身的 fetchWithTimeout 收敛中止。
 */
function withOverallDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`整体搜索 deadline（${SMART_SEARCH_DEADLINE_MS}ms）已到，放弃等待该引擎`)),
        remainingMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

let engineConfigs: Map<SearchEngineName, SearchEngineConfig> | null = null;

function getEngineConfigs(): Map<SearchEngineName, SearchEngineConfig> {
  if (!engineConfigs) {
    engineConfigs = initEngineConfigs();
  }
  return engineConfigs;
}

/** 测试或运行时更新 env 后重建引擎配置 */
export function resetSearchEngineConfigs(): void {
  engineConfigs = null;
}

/**
 * 智能搜索 - 多引擎路由
 *
 * @param query 搜索关键词
 * @param limit 返回结果数量上限
 * @param preferredEngine 优先使用的引擎(可选)
 * @returns 搜索结果
 */
export async function smartSearch(
  query: string,
  limit: number = 10,
  preferredEngine?: SearchEngineName
): Promise<SearchResponse> {
  if (!query || query.trim() === "") {
    throw new Error("query is required");
  }

  // 构建候选引擎列表
  const candidates: SearchEngineConfig[] = [];

  // 如果指定了优先引擎,先尝试
  const configs = getEngineConfigs();

  if (preferredEngine && configs.has(preferredEngine)) {
    const cfg = configs.get(preferredEngine)!;
    if (isAvailable(cfg) && isEngineConfigured(cfg)) {
      candidates.push(cfg);
    }
  }

  // 按优先级添加其他可用引擎
  const sorted = Array.from(configs.values()).sort((a, b) => a.priority - b.priority);
  for (const cfg of sorted) {
    if (cfg.name !== preferredEngine && isAvailable(cfg) && isEngineConfigured(cfg)) {
      candidates.push(cfg);
    }
  }

  if (candidates.length === 0) {
    throw new Error("所有搜索引擎均不可用,请检查网络连接或 API Key 配置");
  }

  // 依次尝试每个引擎
  const errors: string[] = [];
  const enginesAttempted: string[] = [];
  const started = Date.now();
  const deadlineAt = started + SMART_SEARCH_DEADLINE_MS;
  let deadlineHit = false;

  for (const cfg of candidates) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      deadlineHit = true;
      break;
    }
    enginesAttempted.push(cfg.name);
    try {
      console.log(`[SearchRouter] 尝试引擎: ${cfg.name} (优先级 ${cfg.priority})`);
      const rawResults = await withOverallDeadline(
        executeEngine(cfg.name, query, limit, cfg.apiKey),
        remainingMs,
      );
      const results = RELEVANCE_FILTER_ENGINES.has(cfg.name)
        ? filterRelevantResults(query, rawResults)
        : rawResults;

      if (results.length > 0) {
        recordSuccess(cfg);
        if (rawResults.length > results.length) {
          console.log(
            `[SearchRouter] ✓ 引擎 ${cfg.name} 返回 ${results.length}/${rawResults.length} 条相关结果`,
          );
        } else {
          console.log(`[SearchRouter] ✓ 引擎 ${cfg.name} 返回 ${results.length} 条结果`);
        }
        return {
          query,
          results,
          engine: cfg.name,
          total: results.length,
          elapsedMs: Date.now() - started,
          enginesAttempted,
        };
      } else if (rawResults.length > 0) {
        errors.push(`${cfg.name}: ${rawResults.length} 条结果均与查询无关`);
        recordFailure(cfg, "irrelevant results");
      } else {
        errors.push(`${cfg.name}: 返回空结果`);
        recordFailure(cfg, "empty results");
      }
    } catch (error: any) {
      const msg = error.message || String(error);
      errors.push(`${cfg.name}: ${msg}`);
      recordFailure(cfg, msg);
      console.warn(`[SearchRouter] ✗ 引擎 ${cfg.name} 失败: ${msg}`);
    }
  }

  // 所有引擎都失败了（错误一行一个引擎明细，喂回 LLM 可换 engine 参数重试）
  const deadlineNote = deadlineHit ? `（整体 deadline ${SMART_SEARCH_DEADLINE_MS / 1000}s 已到）` : "";
  throw new Error(`搜索失败,所有引擎均不可用${deadlineNote}:\n${errors.join("\n")}`);
}

/**
 * 获取当前搜索引擎状态(用于调试)
 */
export function getEngineStatus(): Array<{
  name: string;
  enabled: boolean;
  hasKey: boolean;
  available: boolean;
  failCount: number;
  disabledUntil?: string;
}> {
  return Array.from(getEngineConfigs().values())
    .sort((a, b) => a.priority - b.priority)
    .map((cfg) => ({
      name: cfg.name,
      enabled: cfg.enabled,
      hasKey: !!cfg.apiKey,
      available: isAvailable(cfg),
      failCount: cfg.failCount,
      disabledUntil: cfg.disabledUntil > Date.now() ? new Date(cfg.disabledUntil).toISOString() : undefined,
    }));
}
