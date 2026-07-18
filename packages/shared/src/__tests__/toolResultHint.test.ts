import { describe, expect, it } from "vitest";
import { formatToolErrorHint, formatToolResultHint, formatToolTimingHint } from "../toolResultHint.js";

describe("formatToolTimingHint", () => {
  it("web_search 摘要", () => {
    const hint = formatToolTimingHint({
      elapsedMs: 120,
      engine: "tavily",
      enginesAttempted: ["bing_crawler", "tavily"],
      searchPhase: "smart-search",
      query: "test",
      total: 3,
    });
    expect(hint).toContain("120ms");
    expect(hint).toContain("tavily");
    expect(hint).toContain("bing_crawler→tavily");
  });

  it("web_search 信息源 scoped 摘要", () => {
    const hint = formatToolTimingHint({
      elapsedMs: 200,
      provider: "tavily",
      searchPhase: "infoSource-scoped",
      infoSourcesUsed: [{ name: "DeepSeek 官方" }, { name: "掘金" }],
      total: 2,
    });
    expect(hint).toContain("2 信息源");
    expect(hint).toContain("infoSource-scoped");
  });

  it("错误结果生成失败摘要", () => {
    expect(formatToolErrorHint({ error: "url 不能为空", elapsedMs: 5 })).toContain("失败");
    expect(formatToolTimingHint({ error: "fail" })).toBeNull();
  });

  it("formatToolResultHint 成功与失败", () => {
    expect(formatToolResultHint({ elapsedMs: 10, engine: "tavily" })).toContain("10ms");
    expect(formatToolResultHint({ error: "timeout" })).toContain("失败");
  });

  it("todo_write 结果优先用 summary", () => {
    expect(
      formatToolResultHint({
        summary: "待办 3项 · 1进行中 · 1完成",
        total: 3,
        todos: [],
      }),
    ).toBe("待办 3项 · 1进行中 · 1完成");
  });

  it("read_article 摘要含平台、作者与方法", () => {
    const hint = formatToolTimingHint({
      elapsedMs: 890,
      platform: "jianshu",
      author: "老吴学技术",
      method: "jianshu-mobile",
      contentChars: 8502,
    });
    expect(hint).toContain("890ms");
    expect(hint).toContain("jianshu");
    expect(hint).toContain("老吴学技术");
    expect(hint).toContain("jianshu-mobile");
    expect(hint).toContain("8502 字");
  });

  it("read_article 摘要含平台与方法（无作者）", () => {
    const hint = formatToolTimingHint({
      elapsedMs: 890,
      platform: "juejin",
      method: "http",
      contentChars: 4200,
      contentTruncated: true,
    });
    expect(hint).toContain("890ms");
    expect(hint).toContain("juejin");
    expect(hint).toContain("http");
    expect(hint).toContain("4200 字");
    expect(hint).toContain("已截断");
  });

  it("read_article 短正文 warning 与 suggestedTool", () => {
    const hint = formatToolTimingHint({
      elapsedMs: 500,
      platform: "bilibili",
      contentChars: 120,
      contentWarning: "正文较短",
      suggestedTool: "scrape_web_page",
    });
    expect(hint).toContain("120 字");
    expect(hint).toContain("正文较短");
    expect(hint).toContain("→scrape_web_page");
  });

  it("scrape_web_page 摘要含 textChars", () => {
    const hint = formatToolTimingHint({ elapsedMs: 900, textChars: 3500, textTruncated: false });
    expect(hint).toContain("900ms");
    expect(hint).toContain("3500 字");
  });

  it("scrape_web_page 摘要含 method 与 platform", () => {
    const hint = formatToolTimingHint({
      elapsedMs: 1100,
      method: "playwright",
      platform: "unknown",
      textChars: 2899,
    });
    expect(hint).toContain("1100ms");
    expect(hint).toContain("playwright");
    expect(hint).toContain("2899 字");
  });

  it("sleep 结果摘要含等待时长", () => {
    const hint = formatToolTimingHint({
      waitedMs: 20000,
      waitedSeconds: 20,
      message: "定时时间20s到了，请继续完成任务",
    });
    expect(hint).toContain("等待");
    expect(hint).toMatch(/20s|20\.0s/);
  });
});
