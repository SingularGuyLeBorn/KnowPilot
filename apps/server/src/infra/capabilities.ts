/**
 * 服务器运行时能力摘要 — /health 与 tRPC native.capabilities 共用
 */

import type { AppConfig } from "./config.js";
import { getEngineStatus, READ_ARTICLE_PLATFORMS } from "./metablog/index.js";
import { getScraperStatus } from "./metablog/webScraper.js";
import { isSharedBrowserReady } from "./metablog/browserPool.js";
import { hasSystemChrome } from "./metablog/playwrightChrome.js";
import { getOcrStatus } from "./ocrService.js";

export interface ServerCapabilities {
  chrome: boolean;
  search: {
    priority: string;
    engines: string[];
  };
  ocr: {
    modelsReady: boolean;
    paddleCli: boolean;
    ocrSpace: boolean;
  };
  browser: {
    chromeInstalled: boolean;
    poolReady: boolean;
    scraper: ReturnType<typeof getScraperStatus>;
  };
  readArticle: {
    platforms: string[];
    /** 已配置 Cookie 的平台（仅布尔，不暴露值） */
    cookies: {
      zhihu: boolean;
      wechat: boolean;
      xhs: boolean;
      douyin: boolean;
    };
  };
  /** tRPC native.capabilities 附加：已启用信息源总数 */
  infoSources?: {
    enabled: number;
  };
}

function readArticleCookieFlags(): ServerCapabilities["readArticle"]["cookies"] {
  const has = (key: string) => Boolean(process.env[key]?.trim());
  return {
    zhihu: has("ZHIHU_COOKIE"),
    wechat: has("WECHAT_COOKIE"),
    xhs: has("XHS_COOKIE") || has("XIAOHONGSHU_COOKIE"),
    douyin: has("DOUYIN_COOKIE"),
  };
}

export function getServerCapabilities(config: AppConfig): ServerCapabilities {
  const ocr = getOcrStatus(config);
  return {
    chrome: hasSystemChrome(),
    search: {
      priority: config.search.enginePriority,
      engines: getEngineStatus()
        .filter((e) => e.available)
        .map((e) => e.name),
    },
    ocr: {
      modelsReady: ocr.models.det && ocr.models.rec,
      paddleCli: ocr.paddleCli,
      ocrSpace: ocr.ocrSpaceConfigured,
    },
    browser: {
      chromeInstalled: hasSystemChrome(),
      poolReady: isSharedBrowserReady(),
      scraper: getScraperStatus(),
    },
    readArticle: {
      platforms: [...READ_ARTICLE_PLATFORMS],
      cookies: readArticleCookieFlags(),
    },
  };
}

/** 附带 DB 信息源计数 — /health 与 tRPC native.capabilities 共用 */
export async function getEnrichedServerCapabilities(
  config: AppConfig,
  listEnabledInfoSources: () => Promise<{ total: number }>,
): Promise<ServerCapabilities & { infoSources: { enabled: number } }> {
  const base = getServerCapabilities(config);
  const enabledSources = await listEnabledInfoSources();
  return {
    ...base,
    infoSources: { enabled: enabledSources.total },
  };
}
