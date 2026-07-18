import { describe, it, expect } from "vitest";

/** 内容路由中文 slug 必须编解码，避免 Link/router 丢字或 404 */
describe("中文 slug URL 编解码", () => {
  it("encodeURIComponent / decodeURIComponent 往返", () => {
    const slug = "推测解码-speculative-decoding-全面解析";
    const href = `/posts/${encodeURIComponent(slug)}`;
    expect(href).toContain("%");
    const encoded = href.replace("/posts/", "");
    expect(decodeURIComponent(encoded)).toBe(slug);
  });

  it("分类/标签路径同样编码", () => {
    const tag = "机器学习";
    expect(decodeURIComponent(encodeURIComponent(tag))).toBe(tag);
    expect(`/tags/${encodeURIComponent(tag)}`).toBe(`/tags/${encodeURIComponent("机器学习")}`);
  });
});
