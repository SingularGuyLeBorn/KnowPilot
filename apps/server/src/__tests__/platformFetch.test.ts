import { describe, expect, it } from "vitest";
import { looksLikeBlockedHtml, parseCookieHeader, hasWechatArticleHtml, hasXiaohongshuArticleHtml, hasDouyinArticleHtml, hasJuejinArticleHtml, hasZhihuArticleHtml, hasInfoqArticleHtml, hasCsdnArticleHtml, hasSegmentfaultArticleHtml, hasOschinaArticleHtml, hasCnblogsArticleHtml, hasJianshuArticleHtml, isCsdnFetchComplete, isSegmentfaultFetchComplete, extractSegmentfaultAuthorFromPartialNextData, extractCsdnAuthorFromHtml, extractInfoqAuthorFromDetail, isJuejinFetchComplete, extractJuejinArticleId, detectPlatform, extractInfoqArticleUuid, extractOschinaNewsId, extractSegmentfaultArticleId, parseOschinaNewsDetailXml, parseGithubContentUrl, buildGithubRawUrl, buildJsDelivrGithubUrl, buildGithubApiContentsUrl, normalizeGithubReadUrl } from "../infra/metablog/platform/fetcher.js";
import { needsSpaWait } from "../infra/metablog/playwrightBrowserScripts.js";
import { parseHtmlToMarkdown } from "../infra/metablog/platform/parser.js";

describe("platform fetch helpers", () => {
  it("needsSpaWait 识别 SPA 技术站", () => {
    expect(needsSpaWait("www.infoq.cn")).toBe(true);
    expect(needsSpaWait("blog.csdn.net")).toBe(true);
    expect(needsSpaWait("api-docs.deepseek.com")).toBe(false);
  });

  it("detectPlatform 识别 GitHub raw", () => {
    expect(detectPlatform("raw.githubusercontent.com")).toBe("github-raw");
    expect(detectPlatform("github.com")).toBe("github");
  });

  it("parseGithubContentUrl 解析 raw 与 blob 链接", () => {
    const raw = parseGithubContentUrl(
      "https://raw.githubusercontent.com/deepseek-ai/DeepSeek-V3/main/README.md",
    );
    expect(raw).toEqual({
      owner: "deepseek-ai",
      repo: "DeepSeek-V3",
      ref: "main",
      path: "README.md",
    });
    expect(buildGithubRawUrl(raw!)).toBe(
      "https://raw.githubusercontent.com/deepseek-ai/DeepSeek-V3/main/README.md",
    );
    expect(buildJsDelivrGithubUrl(raw!)).toBe(
      "https://cdn.jsdelivr.net/gh/deepseek-ai/DeepSeek-V3@main/README.md",
    );
    expect(buildGithubApiContentsUrl(raw!)).toBe(
      "https://api.github.com/repos/deepseek-ai/DeepSeek-V3/contents/README.md?ref=main",
    );

    const blob = parseGithubContentUrl("https://github.com/deepseek-ai/DeepSeek-V3/blob/main/README.md");
    expect(blob?.path).toBe("README.md");
    expect(normalizeGithubReadUrl("https://github.com/deepseek-ai/DeepSeek-V3/blob/main/README.md")).toBe(
      "https://raw.githubusercontent.com/deepseek-ai/DeepSeek-V3/main/README.md",
    );
    expect(
      normalizeGithubReadUrl("https://raw.githubusercontent.com/deepseek-ai/DeepSeek-V3/main/README.md"),
    ).toBeNull();
  });
  it("looksLikeBlockedHtml 识别登录墙", () => {
    expect(looksLikeBlockedHtml("<html>验证码登录</html>", 200)).toBe(true);
    expect(looksLikeBlockedHtml("<html>" + "x".repeat(300) + "</html>", 200)).toBe(false);
  });

  it("parseCookieHeader 解析 ZHIHU_COOKIE", () => {
    const cookies = parseCookieHeader("z_c0=abc; _xsrf=def", ".zhihu.com");
    expect(cookies).toEqual([
      { name: "z_c0", value: "abc", domain: ".zhihu.com", path: "/" },
      { name: "_xsrf", value: "def", domain: ".zhihu.com", path: "/" },
    ]);
  });

  it("hasInfoqArticleHtml 识别 ProseMirror 正文", () => {
    const ok = `<html><article class="article-content ProseMirror"><p>${"Agent".repeat(40)}</p></article></html>`;
    expect(hasInfoqArticleHtml(ok)).toBe(true);
  });

  it("hasInfoqArticleHtml 正文含 404 字样不误判", () => {
    const ok = `<html><article class="article-content ProseMirror"><p>${"HTTP 404 错误".repeat(30)}</p></article></html>`;
    expect(hasInfoqArticleHtml(ok)).toBe(true);
  });

  it("extractInfoqArticleUuid 解析文章链接", () => {
    expect(extractInfoqArticleUuid("https://www.infoq.cn/article/d6oe4ghorgrfotcuxxhf")).toBe("d6oe4ghorgrfotcuxxhf");
    expect(extractInfoqArticleUuid("https://example.com/foo")).toBeNull();
  });

  it("extractOschinaNewsId 与 XML 解析", () => {
    expect(extractOschinaNewsId("https://www.oschina.net/news/291686/deepseek-v3")).toBe("291686");
    const xml = `<?xml version="1.0"?><oschina><news><title><![CDATA[ReZero 1.0.44]]></title><author><![CDATA[Gitee快讯]]></author><body><![CDATA[<p>正文内容足够长</p>]]></body></news></oschina>`;
    const parsed = parseOschinaNewsDetailXml(xml);
    expect(parsed?.title).toBe("ReZero 1.0.44");
    expect(parsed?.author).toBe("Gitee快讯");
    expect(parsed?.body).toContain("正文内容");
  });

  it("extractInfoqAuthorFromDetail 解析 no_author 前缀", () => {
    expect(extractInfoqAuthorFromDetail({ no_author: "作者：向邦宇" })).toBe("向邦宇");
    expect(extractInfoqAuthorFromDetail({ author: { nickname: "InfoQ 编辑" } })).toBe("InfoQ 编辑");
  });

  it("infoq-api HTML 保留作者 meta", async () => {
    const body = "InfoQ".repeat(80);
    const html = `<html><head><meta name="author" content="向邦宇" /></head><body><h1>标题</h1><article class="article-content ProseMirror"><p>${body}</p></article></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://www.infoq.cn/article/d6oe4ghorgrfotcuxxhf", "infoq", {
      fetcher: "infoq",
      method: "infoq-api",
    });
    expect(parsed.author).toBe("向邦宇");
    expect(parsed.method).toBe("infoq-api");
  });

  it("extractSegmentfaultArticleId 与 segmentfault-ssr method", async () => {
    expect(extractSegmentfaultArticleId("https://segmentfault.com/a/1190000046145001")).toBe("1190000046145001");
    const body = "DeepSeek".repeat(80);
    const html = `<html><body data-segmentfault-source="ssr"><h1>SF 标题</h1><article id="articleContent"><p>${body}</p></article></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://segmentfault.com/a/1190000046145001", "segmentfault", {
      fetcher: "segmentfault",
      method: "segmentfault-ssr",
    });
    expect(parsed.method).toBe("segmentfault-ssr");
    expect(parsed.content.length).toBeGreaterThan(150);
  });

  it("parseHtmlToMarkdown 保留 jianshu-mobile 与 csdn-ssr method", async () => {
    const jsBody = "简书".repeat(80);
    const jsHtml = `<html><body data-jianshu-source="mobile"><h1>标题</h1><article class="show-content"><p>${jsBody}</p></article></body></html>`;
    const js = await parseHtmlToMarkdown(jsHtml, "https://www.jianshu.com/p/abc", "jianshu", {
      fetcher: "jianshu",
      method: "jianshu-mobile",
    });
    expect(js.method).toBe("jianshu-mobile");

    const csdnBody = "CSDN".repeat(80);
    const csdnHtml = `<html><body data-csdn-source="ssr"><h1>标题</h1><article id="content_views"><p>${csdnBody}</p></article></body></html>`;
    const csdn = await parseHtmlToMarkdown(csdnHtml, "https://blog.csdn.net/x/article/details/1", "csdn", {
      fetcher: "csdn",
      method: "csdn-ssr",
    });
    expect(csdn.method).toBe("csdn-ssr");
  });

  it("hasOschinaArticleHtml 短 API 正文不误判", () => {
    const shortApi = `<html><body data-oschina-source="api"><article class="news-content article-content"><p>${"ReZero".repeat(20)}</p></article></body></html>`;
    expect(hasOschinaArticleHtml(shortApi, 40)).toBe(true);
  });

  it("技术站正文检测", () => {
    expect(
      hasCsdnArticleHtml(`<html><div id="content_views"><p>${"CSDN".repeat(40)}</p></div></html>`),
    ).toBe(true);
    expect(
      hasSegmentfaultArticleHtml(`<html><div id="articleContent"><p>${"SF".repeat(80)}</p></div></html>`),
    ).toBe(true);
    expect(
      hasOschinaArticleHtml(`<html><div id="articleContent"><p>${"OSChina".repeat(30)}</p></div></html>`),
    ).toBe(true);
    expect(
      hasCnblogsArticleHtml(`<html><div id="cnblogs_post_body"><p>${"博客园".repeat(60)}</p></div></html>`),
    ).toBe(true);
    expect(
      hasJianshuArticleHtml(`<html><article class="show-content"><p>${"简书".repeat(80)}</p></article></html>`),
    ).toBe(true);
  });

  it("hasJuejinArticleHtml 识别 markdown 正文", () => {
    const ok = `<html><article class="markdown-body"><p>${"掘金正文".repeat(40)}</p></article></html>`;
    expect(hasJuejinArticleHtml(ok)).toBe(true);
    expect(hasJuejinArticleHtml("<html>找不到页面</html>")).toBe(false);
  });

  it("hasDouyinArticleHtml 识别视频描述", () => {
    const ok = `<html><span class="video-info-desc">${"抖音描述".repeat(15)}</span></html>`;
    expect(hasDouyinArticleHtml(ok)).toBe(true);
    expect(hasDouyinArticleHtml("<html>访问过于频繁</html>")).toBe(false);
  });

  it("hasXiaohongshuArticleHtml 识别正文与拦截页", () => {
    const ok = `<html><div id="detail-desc"><p>${"小红书笔记".repeat(20)}</p></div></html>`;
    expect(hasXiaohongshuArticleHtml(ok)).toBe(true);
    expect(hasXiaohongshuArticleHtml("<html>当前笔记暂时无法浏览</html>")).toBe(false);
  });

  it("hasWechatArticleHtml 识别正文与拦截页", () => {
    const ok = `<html><div id="js_content"><p>${"微信正文".repeat(30)}</p></div></div></html>`;
    expect(hasWechatArticleHtml(ok)).toBe(true);
    expect(hasWechatArticleHtml("<html>环境异常，完成验证</html>")).toBe(false);
  });

  it("B站 API 短简介时合成 stats 正文", async () => {
    const state = JSON.stringify({
      videoData: {
        title: "Never Gonna Give You Up",
        desc: "## 视频信息\n- UP主：索尼音乐中国\n\n## 数据\n播放 100000 · 弹幕 1000 · 点赞 2000 · 评论 100",
        owner: { name: "索尼音乐中国" },
      },
    });
    const html = `<html><body><script>window.__INITIAL_STATE__=${state};(function(){})</script></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://www.bilibili.com/video/BV1GJ411x7h7", "bilibili", {
      fetcher: "bilibili",
      method: "api",
    });
    expect(parsed.content).toContain("播放 100000");
    expect(parsed.method).toBe("api");
    expect(parsed.content.length).toBeGreaterThan(30);
  });

  it("B站 plain-text 正文保留 Markdown 换行", async () => {
    const desc = "## 简介\n第一行\n\n第二行";
    const html = `<html><body><article class="desc"><pre>${desc}</pre></article></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://www.bilibili.com/video/BVtest", "bilibili", {
      fetcher: "bilibili",
      method: "api",
    });
    expect(parsed.content).toContain("第一行");
    expect(parsed.content).toContain("第二行");
  });

  it("extractJuejinArticleId 与 juejin-ssr method", async () => {
    expect(extractJuejinArticleId("https://juejin.cn/post/6844904066419277829")).toBe("6844904066419277829");
    const body = "掘金".repeat(100);
    const html = `<html><body data-juejin-source="ssr"><h1 class="article-title">测试标题</h1><article class="markdown-body"><p>${body}</p></article></body></html>`;
    expect(hasJuejinArticleHtml(html)).toBe(true);
    const parsed = await parseHtmlToMarkdown(html, "https://juejin.cn/post/6844904066419277829", "juejin", {
      fetcher: "juejin",
      method: "juejin-ssr",
    });
    expect(parsed.method).toBe("juejin-ssr");
    expect(parsed.title).toContain("测试标题");
    expect(parsed.content.length).toBeGreaterThan(150);
  });

  it("sanitizeAuthor 过滤简书 CTA 误识别", async () => {
    const body = "正文".repeat(80);
    const html = `<html><head><meta name="author" content="真实作者" /></head><body data-jianshu-source="mobile"><h1>标题</h1><article class="show-content"><p>${body}</p><div class="name">下载简书App 你也可以写文章赚赞赏</div></article></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://www.jianshu.com/p/abc", "jianshu", {
      fetcher: "jianshu",
      method: "jianshu-mobile",
    });
    expect(parsed.author).toBe("真实作者");
  });

  it("简书 show-content-free DOM 优先于 Readability", async () => {
    const body = "DeepSeek".repeat(400);
    const html = `<html><body data-jianshu-source="mobile"><div class="show-content-free"><div class="note-content"><p>${body}</p></div></div></body></html>`;
    expect(hasJianshuArticleHtml(html)).toBe(true);
    const parsed = await parseHtmlToMarkdown(html, "https://www.jianshu.com/p/abc", "jianshu", {
      fetcher: "jianshu",
      method: "jianshu-mobile",
    });
    expect(parsed.method).toBe("jianshu-mobile");
    expect(parsed.content.length).toBeGreaterThan(1500);
    expect(parsed.content).not.toContain("readability-js");
  });

  it("简书 title 后缀提取作者并 normalizeTitle 去重", async () => {
    const body = "正文".repeat(80);
    const html = `<html><body data-jianshu-source="mobile"><h1 class="title">deepseek v3 中文翻译 - 老吴学技术</h1><article class="show-content"><p>${body}</p></article></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://www.jianshu.com/p/abc", "jianshu", {
      fetcher: "jianshu",
      method: "jianshu-mobile",
    });
    expect(parsed.author).toBe("老吴学技术");
    expect(parsed.title).toBe("deepseek v3 中文翻译");
  });

  it("简书 .note 首链提取作者", async () => {
    const body = "正文".repeat(80);
    const html = `<html><body data-jianshu-source="mobile"><div class="note"><a href="/u/abc">老吴学技术简书作者</a><div class="show-content-free"><div class="note-content"><p>${body}</p></div></div></div></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://www.jianshu.com/p/abc", "jianshu", {
      fetcher: "jianshu",
      method: "jianshu-mobile",
    });
    expect(parsed.author).toBe("老吴学技术");
  });

  it("hasZhihuArticleHtml 与 zhihu-cookie / cnblogs-ssr method", async () => {
    const zhBody = "知乎".repeat(80);
    const zhHtml = `<html><body data-zhihu-source="cookie-http"><script id="js-initialData" type="application/json">{}</script><div class="Post-RichTextContainer"><p>${zhBody}</p></div></body></html>`;
    expect(hasZhihuArticleHtml(zhHtml)).toBe(true);
    const zh = await parseHtmlToMarkdown(zhHtml, "https://zhuanlan.zhihu.com/p/1", "zhihu", {
      fetcher: "zhihu",
      method: "zhihu-cookie",
    });
    expect(zh.method).toBe("zhihu-cookie");

    const cbBody = "博客园".repeat(80);
    const cbHtml = `<html><body data-cnblogs-source="ssr"><div id="cnblogs_post_body"><p>${cbBody}</p></div></body></html>`;
    const cb = await parseHtmlToMarkdown(cbHtml, "https://www.cnblogs.com/x/p/1.html", "cnblogs", {
      fetcher: "cnblogs",
      method: "cnblogs-ssr",
    });
    expect(cb.method).toBe("cnblogs-ssr");
  });

  it("cnblogs-ssr 从 postDesc 链接提取作者", async () => {
    const body = "博客园".repeat(80);
    const html = `<html><body data-cnblogs-source="ssr"><div id="cnblogs_post_body"><p>${body}</p></div><div class="postDesc">posted @ <span>2022-10-17 18:54</span> <a href="https://www.cnblogs.com/metaz">MetaZ</a> 阅读(347)</div></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://www.cnblogs.com/metaz/p/1.html", "cnblogs", {
      fetcher: "cnblogs",
      method: "cnblogs-ssr",
    });
    expect(parsed.author).toBe("MetaZ");
  });

  it("csdn-ssr 从 var nickName 注入作者（早停不含 sidebar）", async () => {
    const body = "CSDN".repeat(80);
    const raw = `<html><head><script>var nickName = "一位安分的码农";</script></head><body><div id="content_views"><p>${body}</p></div><div class="recommend-box"></div></body></html>`;
    expect(extractCsdnAuthorFromHtml(raw)).toBe("一位安分的码农");
    const html = `<html><head><meta name="author" content="一位安分的码农" /></head><body data-csdn-source="ssr"><div id="content_views"><p>${body}</p></div></body></html>`;
    const parsed = await parseHtmlToMarkdown(html, "https://blog.csdn.net/x/article/details/1", "csdn", {
      fetcher: "csdn",
      method: "csdn-ssr",
    });
    expect(parsed.author).toBe("一位安分的码农");
  });

  it("大页 HTTP 早停 isComplete 谓词", () => {
    const csdnBody = "CSDN".repeat(80);
    const csdnHtml = `<html><div id="content_views"><p>${csdnBody}</p></div><div class="recommend-box"></div>`;
    expect(isCsdnFetchComplete(csdnHtml)).toBe(true);

    const sfBody = "SF".repeat(80);
    const sfHtml = `<html><div id="articleContent"><p>${sfBody}</p></div><script id="__NEXT_DATA__">{}</script></html>`;
    expect(isSegmentfaultFetchComplete(sfHtml)).toBe(true);
    const sfPartial = `<html><div id="articleContent"><p>${sfBody}</p></div><script id="__NEXT_DATA__">{"props":{"pageProps":{"initialState":{"articleDetail":{"artDetail":{"1190000046145001":{"article":{"user":{"name":"京东云开发者"}}}}}}}}}`;
    expect(extractSegmentfaultAuthorFromPartialNextData(sfPartial, "https://segmentfault.com/a/1190000046145001")).toBe("京东云开发者");
    expect(isSegmentfaultFetchComplete(sfPartial, "https://segmentfault.com/a/1190000046145001")).toBe(true);
    expect(isSegmentfaultFetchComplete(`<html><div id="articleContent"><p>${sfBody}</p></div><script id="__NEXT_DATA__">`)).toBe(false);
    expect(isSegmentfaultFetchComplete(`<html><div id="articleContent"><p>短</p></div>`)).toBe(false);

    const jjBody = "掘金".repeat(80);
    const jjHtml = `<html><article class="markdown-body"><p>${jjBody}</p></article><div class="article-suspended"></div>`;
    expect(isJuejinFetchComplete(jjHtml)).toBe(true);
  });

  it("parseHtmlToMarkdown 保留 github-raw 与 oschina-api fetcher method", async () => {
    const ghHtml = `<html><body><article class="markdown-body"><pre>${"# Title".repeat(80)}</pre></article></body></html>`;
    const gh = await parseHtmlToMarkdown(ghHtml, "https://raw.githubusercontent.com/o/r/main/README.md", "github", {
      fetcher: "github-raw",
      method: "github-raw",
    });
    expect(gh.method).toBe("github-raw");

    const osHtml = `<html><body data-oschina-source="api"><article class="news-content"><p>${"OSChina".repeat(40)}</p></article></body></html>`;
    const os = await parseHtmlToMarkdown(osHtml, "https://www.oschina.net/news/285000/x", "oschina", {
      fetcher: "oschina",
      method: "oschina-api",
    });
    expect(os.method).toBe("oschina-api");
  });

  it("hasSegmentfaultArticleHtml 正文含 404 字样不误判", () => {
    const ok = `<html><div id="articleContent"><p>${"HTTP 404 错误".repeat(30)}</p></div></html>`;
    expect(hasSegmentfaultArticleHtml(ok)).toBe(true);
  });

  it("hasOschinaArticleHtml 正文含 404 字样不误判", () => {
    const ok = `<html><div id="articleContent"><p>${"HTTP 404 错误".repeat(30)}</p></div></html>`;
    expect(hasOschinaArticleHtml(ok)).toBe(true);
  });

  it("hasJianshuArticleHtml 拒绝免责声明壳页", () => {
    expect(
      hasJianshuArticleHtml(
        "<html><body>著作权归作者所有 简书系信息发布平台 平台声明：文章内容由作者上传</body></html>",
      ),
    ).toBe(false);
  });

  it("hasJianshuArticleHtml 正文含 404 字样不误判", () => {
    const ok = `<html><article class="show-content"><p>${"HTTP 404 错误".repeat(30)}</p></article></html>`;
    expect(hasJianshuArticleHtml(ok)).toBe(true);
  });

  it("hasCnblogsArticleHtml 拒绝 404 壳页", () => {
    expect(hasCnblogsArticleHtml("<html>404 页面不存在 - 博客园</html>")).toBe(false);
  });

  it("looksLikeHttp404Shell 短页 404 标题", () => {
    expect(hasCnblogsArticleHtml("<html><title>404</title>抱歉，您访问的页面不存在</html>")).toBe(false);
  });

  it("hasCsdnArticleHtml 拒绝 404 页", () => {
    expect(hasCsdnArticleHtml("<html><title>404</title>抱歉，您访问的页面不存在</html>")).toBe(false);
  });
});
