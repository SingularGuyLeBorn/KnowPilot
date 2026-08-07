import { describe, it, expect } from "vitest";
import {
  deriveExpectKeywordsFromArgs,
  extractKeyInfoSpans,
  injectExpectPropsIntoParameters,
  peelExpectControls,
} from "../infra/keyInfoExtractor.js";

describe("keyInfoExtractor", () => {
  it("命中关键词时保留前后上下文并合并重叠窗", () => {
    const body =
      "前言 ".repeat(50) +
      "PyTorch 2.4 introduces torch.compile improvements with 30% less overhead. " +
      "中段 ".repeat(80) +
      "The inductor backend also improved. " +
      "结尾 ".repeat(40);
    const hits = extractKeyInfoSpans(
      body,
      ["torch.compile", "inductor", "speedup"],
      [String.raw`\d+%`],
      { contextWindow: 40 },
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((h) => h.context.includes("torch.compile"))).toBe(true);
    expect(hits.some((h) => h.context.includes("30%"))).toBe(true);
  });

  it("未命中时返回空 hits（采样偏移由 metadata.sampleOffsets 负责）", () => {
    const text = "A".repeat(3000);
    const hits = extractKeyInfoSpans(text, ["not-here"], []);
    expect(hits).toHaveLength(0);
  });

  it("peelExpectControls 剥离控制参数并保留业务 args", () => {
    const { keywords, patterns, contextWindow, cleanArgs } = peelExpectControls({
      url: "https://example.com",
      expect_keywords: ["alpha", "beta"],
      expect_patterns: [String.raw`\d+`],
      expect_context_chars: 300,
      maxChars: 8000,
    });
    expect(keywords).toEqual(["alpha", "beta"]);
    expect(patterns).toEqual([String.raw`\d+`]);
    expect(contextWindow).toBe(300);
    expect(cleanArgs).toEqual({ url: "https://example.com", maxChars: 8000 });
  });

  it("无 expect 时从 query 推导关键词", () => {
    const kws = deriveExpectKeywordsFromArgs({ query: "torch.compile dynamic shapes" });
    expect(kws.some((k) => k.toLowerCase().includes("torch.compile"))).toBe(true);
    expect(kws.length).toBeGreaterThan(0);
  });

  it("injectExpectPropsIntoParameters 注入三字段且不覆盖已有", () => {
    const params = injectExpectPropsIntoParameters({
      type: "object",
      properties: {
        url: { type: "string" },
        expect_keywords: { type: "array", description: "custom" },
      },
      required: ["url"],
    });
    const props = params.properties as Record<string, Record<string, unknown>>;
    expect(props.url).toEqual({ type: "string" });
    expect(props.expect_keywords?.description).toBe("custom");
    expect(props.expect_patterns).toBeTruthy();
    expect(props.expect_context_chars).toBeTruthy();
    expect(params.required).toEqual(["url"]);
  });
});
