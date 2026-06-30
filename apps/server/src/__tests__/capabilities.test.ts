import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getServerCapabilities, getEnrichedServerCapabilities } from "../infra/capabilities.js";
import { getAppConfig, loadRootEnv } from "../infra/config.js";
import { READ_ARTICLE_PLATFORMS } from "../infra/metablog/index.js";

loadRootEnv();

describe("getServerCapabilities", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["ZHIHU_COOKIE", "WECHAT_COOKIE", "XHS_COOKIE"]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("返回搜索/OCR/浏览器/readArticle 结构", () => {
    const config = getAppConfig();
    const caps = getServerCapabilities(config);
    expect(Array.isArray(caps.search.engines)).toBe(true);
    expect(typeof caps.search.priority).toBe("string");
    expect(typeof caps.ocr.modelsReady).toBe("boolean");
    expect(typeof caps.browser.poolReady).toBe("boolean");
    expect(caps.readArticle.platforms).toEqual([...READ_ARTICLE_PLATFORMS]);
  });

  it("readArticle.cookies 反映 env 是否配置（不暴露值）", () => {
    delete process.env.ZHIHU_COOKIE;
    delete process.env.WECHAT_COOKIE;
    let caps = getServerCapabilities(getAppConfig());
    expect(caps.readArticle.cookies.zhihu).toBe(false);
    expect(caps.readArticle.cookies.wechat).toBe(false);

    process.env.ZHIHU_COOKIE = "z_c0=test";
    caps = getServerCapabilities(getAppConfig());
    expect(caps.readArticle.cookies.zhihu).toBe(true);
    expect(caps.readArticle.cookies.wechat).toBe(false);
  });

  it("getEnrichedServerCapabilities 附带 infoSources 计数", async () => {
    const enriched = await getEnrichedServerCapabilities(getAppConfig(), async () => ({
      total: 7,
      items: [],
      page: 1,
      pageSize: 1,
      totalPages: 7,
    }));
    expect(enriched.infoSources.enabled).toBe(7);
    expect(Array.isArray(enriched.search.engines)).toBe(true);
  });
});
