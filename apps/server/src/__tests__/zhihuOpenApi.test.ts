/**
 * 知乎开放平台客户端 — 鉴权头与信封解析（mock fetch，不打真实网）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhihuHotList, zhihuSearch, zhihuUserFavlists } from "../infra/zhihuOpenApi.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("zhihuOpenApi", () => {
  it("成功信封 Code=0 返回 Data，并带 Bearer + Timestamp", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("/api/v1/content/zhihu_search");
      expect(url).toContain("Query=");
      expect(url).toContain("Count=3");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer test-secret");
      expect(headers.get("X-Request-Timestamp")).toMatch(/^\d+$/);
      return new Response(
        JSON.stringify({
          Code: 0,
          Message: "success",
          Data: { Items: [{ Title: "t", Url: "https://zhihu.com/p/1" }], HasMore: false },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await zhihuSearch("test-secret", "人工智能", 3);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.Items).toHaveLength(1);
    }
  });

  it("Code=20001 鉴权失败映射为 ok:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ Code: 20001, Message: "Authorization failed", Data: null }), {
          status: 200,
        }),
      ),
    );
    const res = await zhihuHotList("bad", 3);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(20001);
      expect(res.message).toMatch(/Authorization|鉴权|failed/i);
    }
  });

  it("favlists 使用 Limit 查询参数", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("Limit=5");
      return new Response(
        JSON.stringify({
          Code: 0,
          Message: "success",
          Data: { Items: [{ UrlToken: 1, Url: "https://www.zhihu.com/collection/1", Title: "a" }] },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await zhihuUserFavlists("test-secret", 5);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.Items?.[0]?.UrlToken).toBe(1);
  });
});
