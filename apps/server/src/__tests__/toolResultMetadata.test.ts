import { describe, it, expect } from "vitest";
import { buildToolResultMetadata } from "../infra/toolResultMetadata.js";

describe("toolResultMetadata", () => {
  it("网页类结果抽出 contentType / shortFields / urls / topics", () => {
    const result = {
      title: "PyTorch 2.4 Release Notes",
      url: "https://pytorch.org/blog/pytorch-2-4/",
      platform: "web",
      content: "noise ".repeat(200) + "torch.compile improves by 30%. " + "tail ".repeat(200),
    };
    const meta = buildToolResultMetadata(result, {
      toolName: "read_article",
      originalChars: JSON.stringify(result).length,
      keywords: ["torch.compile", "missing"],
    });
    expect(meta.contentType).toBe("web_page");
    expect(meta.title).toContain("PyTorch");
    expect(meta.url).toContain("pytorch.org");
    expect(meta.shortFields.title).toBeTruthy();
    expect(meta.fieldSizes.content).toBeGreaterThan(100);
    expect(meta.hitCount).toBeGreaterThanOrEqual(1);
    expect(meta.missedKeywords).toContain("missing");
    expect(meta.hitOffsets[0]?.keyword).toContain("torch.compile");
    expect(meta.topics.some((t) => /torch|PyTorch|compile/i.test(t))).toBe(true);
    expect(meta.recommendedRead.length).toBeGreaterThan(0);
    // metadata 不含正文片段
    expect(JSON.stringify(meta)).not.toContain("improves by 30%");
  });

  it("错误结果标 contentType=error", () => {
    const meta = buildToolResultMetadata(
      { error: "TIMEOUT", message: "tool timed out" },
      { toolName: "web_search", originalChars: 40 },
    );
    expect(meta.contentType).toBe("error");
    expect(meta.hasError).toBe(true);
    expect(meta.shortFields.error).toBe("TIMEOUT");
  });
});
