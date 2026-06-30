/**
 * ============================================================================
 * 平台解析路由 - types
 * ============================================================================
 *
 * 本文件属于 MetaBlog 项目,遵循项目注释规范. 
 *
 * @module server/routes/platform
 */



/**
 * RouteContext 接口定义
 *
 */
export interface RouteContext {
  system: any;
  structuredLog: any;
  gitCommit: (files: string | string[], message: string) => void;
  triggerReload: () => void;
}

/** 正文内容最大长度(字符),超过则截断 */
export const MAX_CONTENT_CHARS = 200_000;

/**
 * ParseResult 接口定义
 *
 */
export interface ParseResult {
  title: string;
  author: string;
  content: string;
  images: string[];
  /** Kimi file_id 列表(vision 模型通过 ms:// 协议引用) */
  imageFiles?: Array<{ file_id: string; url: string }>;
  videos: string[];
  comments: any[];
  metadata: Record<string, any>;
  method: string;
  platform: string;
  url: string;
}

/** 获取器接口: 输入 platform 标识,输出原始 HTML */
export interface ContentFetcher {
  name: string;
  /** 获取原始 HTML */
  fetch(url: string, timeout?: number): Promise<string>;
}

/** 通用获取链路配置 */
export interface GenericFetchStrategy {
  /** 各策略超时时间(ms) */
  timeouts: {
    http: number;
    jina: number;
    playwright: number;
  };
}

/** 平台适配配置(不是"专用解析器",而是统一解析器的适配插件) */
export interface PlatformExtractConfig {
  /** 从 script#id 标签提取 JSON 的 patterns */
  jsonScriptPatterns?: Array<{
    selector: string;
    contentPath: string; // dot path, e.g. "initialState.entities.articles.*.content"
    titlePath?: string;
    authorPath?: string;
  }>;
  /** 从 inline script 变量提取 JSON */
  inlineScriptPatterns?: Array<{
    regex: string;
    flags?: string;
    contentPath: string;
    titlePath?: string;
    authorPath?: string;
  }>;
  /** DOM 内容选择器(按优先级) */
  contentSelectors?: string[];
  /** 标题选择器(按优先级) */
  titleSelectors?: string[];
  /** 作者选择器(按优先级) */
  authorSelectors?: string[];
  /** 图片属性(按优先级) */
  imageAttributes?: string[];
  /** HTML 预处理钩子(平台特有标签处理) */
  preprocess?: (html: string) => string;
  /** 是否需要 Playwright 渲染(给获取层提示) */
  requiresPlaywright?: boolean;
}

/**
 * ParseOptions 接口定义
 *
 */
export interface ParseOptions {
  /** 知乎问题页面: 最多提取几个回答,默认 1 */
  maxAnswers?: number;
  /** 是否对文章中的图片进行 OCR 并将结果嵌入 Markdown(非 vision 模型建议开启) */
  embedOcr?: boolean;
  /** 是否将文章图片下载并上传到 Kimi 获取 file_id(vision 模型建议开启,让 Kimi 能直接"看"原图) */
  fetchImageFiles?: boolean;
}

/**
 * FetchedContent 接口定义
 *
 */
export interface FetchedContent {
  html: string;
  fetcher: string; // 哪个获取器拿到的
  method: string;  // 获取手段
}
