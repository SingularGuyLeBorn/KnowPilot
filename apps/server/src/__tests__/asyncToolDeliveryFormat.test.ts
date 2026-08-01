import { describe, expect, it } from "vitest";
import { formatAsyncToolDelivery } from "../infra/asyncToolDeliveryFormat.js";

describe("formatAsyncToolDelivery", () => {
  it("read_article → 可读信封 + structured，禁止裸 JSON dump", () => {
    const formatted = formatAsyncToolDelivery(
      "read_article",
      {
        title: "Deep Dive into LLMs",
        author: "OpenDocCN",
        platform: "zhihu",
        url: "https://zhuanlan.zhihu.com/p/1",
        method: "readability-js",
        content: "正文第一段。",
        totalChars: 6,
        elapsedMs: 1200,
      },
      { taskLabel: "抓取笔记1" },
    );

    expect(formatted.textForLlm).toContain("[异步工具结果 · read_article · 抓取笔记1]");
    expect(formatted.textForLlm).toContain("Deep Dive into LLMs");
    expect(formatted.textForLlm).toContain("正文第一段。");
    expect(formatted.textForLlm).toContain("请根据以上结果继续推进用户目标");
    expect(formatted.textForLlm.trimStart().startsWith("{")).toBe(false);
    expect(formatted.structured.kind).toBe("read_article");
    expect(formatted.structured.title).toBe("Deep Dive into LLMs");
    expect(formatted.structured.platform).toBe("zhihu");
  });

  it("generic 工具也带继续指令", () => {
    const formatted = formatAsyncToolDelivery("web_search", { results: [{ title: "a" }] });
    expect(formatted.textForLlm).toContain("[异步工具结果 · web_search]");
    expect(formatted.textForLlm).toContain("请根据以上结果继续推进用户目标");
    expect(formatted.structured.kind).toBe("generic");
  });
});
