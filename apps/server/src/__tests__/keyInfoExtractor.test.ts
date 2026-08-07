import { describe, it, expect } from "vitest";
import {
  compressKeyInfo,
  deriveExpectKeywordsFromArgs,
  injectExpectPropsIntoParameters,
  peelExpectControls,
  sampleChunkEdges,
} from "../infra/keyInfoExtractor.js";

describe("keyInfoExtractor", () => {
  it("命中关键词时保留前后上下文并合并重叠窗", () => {
    const body =
      "前言 ".repeat(50) +
      "PyTorch 2.4 introduces torch.compile improvements with 30% less overhead. " +
      "中段 ".repeat(80) +
      "The inductor backend also improved. " +
      "结尾 ".repeat(40);
    const { compressed, hits, missedKeywords } = compressKeyInfo(
      body,
      ["torch.compile", "inductor", "speedup"],
      [String.raw`\d+%`],
      { contextWindow: 40, maxTotalOutput: 4000 },
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(compressed).toContain("torch.compile");
    expect(compressed).toContain("30%");
    expect(missedKeywords).toContain("speedup");
    expect(compressed.length).toBeLessThan(body.length);
  });

  it("未命中时按每 1000 字符切块取头尾各 100", () => {
    // 块0: A×1000；块1: A×500 + MIDDLE + B×494；块2: B×1000；块3: B×11 → 覆盖 MIDDLE 附近
    const text = "A".repeat(1500) + "MIDDLE" + "B".repeat(1505);
    const { compressed, hits } = compressKeyInfo(text, ["not-here"], [], {
      chunkStride: 1000,
      chunkEdge: 100,
      maxTotalOutput: 20_000,
    });
    expect(hits).toHaveLength(0);
    expect(compressed).toContain("未命中关键词");
    expect(compressed).toContain("块 1/");
    expect(compressed).toContain("A".repeat(100));
    expect(compressed).toContain("B".repeat(100));
    // 每块只取 200 字级，不应把整段 MIDDLE 两侧的大片原样留下
    expect(compressed.length).toBeLessThan(text.length / 2);
  });

  it("sampleChunkEdges 均匀覆盖", () => {
    const text = "0123456789".repeat(200); // 2000 chars
    const sampled = sampleChunkEdges(text, 1000, 100);
    expect(sampled).toContain("块 1/2");
    expect(sampled).toContain("块 2/2");
    expect(sampled).toContain("[+800 字符]");
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
