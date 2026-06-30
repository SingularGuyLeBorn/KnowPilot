import { describe, expect, it } from "vitest";
import { extractQueryTerms, filterRelevantResults, scoreResultRelevance } from "../infra/metablog/search/relevance.js";

describe("search relevance", () => {
  it("extracts latin and cjk terms", () => {
    expect(extractQueryTerms("KnowPilot 本地知识库")).toEqual(["knowpilot", "本地知识库"]);
  });

  it("filters irrelevant bing-style junk", () => {
    const query = "KnowPilot 本地知识库";
    const raw = [
      { title: "腾讯视频", url: "https://v.qq.com/x", snippet: "热门综艺", source: "bing_crawler" },
      { title: "KnowPilot 文档", url: "https://example.com/knowpilot", snippet: "本地知识库", source: "tavily" },
    ];
    const filtered = filterRelevantResults(query, raw);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toContain("KnowPilot");
  });

  it("scores matching snippets higher", () => {
    const query = "DeepSeek API 文档";
    const good = { title: "DeepSeek API", url: "https://api-docs.deepseek.com", snippet: "官方文档", source: "tavily" };
    const bad = { title: "无关", url: "https://example.com", snippet: "其他", source: "bing" };
    expect(scoreResultRelevance(query, good)).toBeGreaterThan(scoreResultRelevance(query, bad));
  });
});
