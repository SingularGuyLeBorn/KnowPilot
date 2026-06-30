/**
 * ============================================================================
 * 搜索路由 - types
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/routes/search
 */


export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

/**
 * SearchResponse 接口定义
 *
 */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
  engine: string;
  total?: number;
  /** 本次搜索耗时（毫秒） */
  elapsedMs?: number;
  /** 依次尝试过的引擎（含最终成功者） */
  enginesAttempted?: string[];
}

/**
 * SearchEngineConfig 接口定义
 *
 */
export interface SearchEngineConfig {
  name: SearchEngineName;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  priority: number;
  failCount: number;
  lastFailTime: number;
  disabledUntil: number;
}

/**
 * SearchEngineName 类型别名
 *
 */
export type SearchEngineName =
  | "baidu_qianfan"
  | "metaso"
  | "bocha"
  | "langsearch"
  | "tavily"
  | "brave"
  | "bing"
  | "bing_crawler"
  | "duckduckgo"
  | "searxng"
  | "serpapi";
