import { describe, expect, it } from "vitest";
import { resolveSearchEnginePriority, expandSmokeSearchPriority, buildEffectiveSearchPriorityString } from "../infra/metablog/search/priority.js";
import { toJinaReaderUrl } from "../infra/metablog/platform/fetcher.js";

describe("search priority", () => {
  it("boosts tavily when key configured", () => {
    const list = resolveSearchEnginePriority({ hasTavily: true });
    expect(list[0]).toBe("bing_crawler");
    expect(list[1]).toBe("tavily");
    expect(list.indexOf("duckduckgo")).toBeGreaterThan(list.indexOf("tavily"));
  });

  it("respects comma-separated env override", () => {
    expect(resolveSearchEnginePriority({ envPriority: "tavily,bing_crawler" })).toEqual([
      "tavily",
      "bing_crawler",
    ]);
  });

  it("expands smoke priority when only bing_crawler in env", () => {
    expect(expandSmokeSearchPriority("bing_crawler", true)).toBe("bing_crawler,tavily,serpapi,duckduckgo");
  });

  it("buildEffectiveSearchPriorityString boosts tavily when no env", () => {
    const s = buildEffectiveSearchPriorityString({ tavilyApiKey: "tv-test-key-12345" });
    expect(s.startsWith("bing_crawler,tavily")).toBe(true);
  });

  it("buildEffectiveSearchPriorityString expands single-engine env", () => {
    expect(
      buildEffectiveSearchPriorityString({ envPriority: "bing_crawler", tavilyApiKey: "tv-test-key-12345" }),
    ).toBe("bing_crawler,tavily,serpapi,duckduckgo");
  });
});

describe("toJinaReaderUrl", () => {
  it("normalizes https url", () => {
    expect(toJinaReaderUrl("https://api-docs.deepseek.com/")).toBe(
      "https://r.jina.ai/https://api-docs.deepseek.com/",
    );
  });

  it("adds https for bare host", () => {
    expect(toJinaReaderUrl("example.com/page")).toBe("https://r.jina.ai/https://example.com/page");
  });
});
