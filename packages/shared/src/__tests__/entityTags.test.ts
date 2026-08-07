import { describe, expect, it } from "vitest";
import {
  buildTagFacets,
  canonicalListTag,
  compareByHighValueTags,
  formatTagsCsv,
  hasHighValueTag,
  parseTags,
  suggestTags,
  tagsFromCsv,
} from "../entityTags.js";

describe("entityTags", () => {
  it("同义词归并 useful / 很有用 → 非常有用", () => {
    expect(parseTags(["useful", "很有用", "必装"])).toEqual(["非常有用", "必装"]);
    expect(formatTagsCsv(["useful", "must-install"])).toBe("非常有用,必装");
    expect(parseTags("useful, must-install")).toEqual(["非常有用", "必装"]);
  });

  it("CSV roundtrip 去重", () => {
    expect(tagsFromCsv("非常有用, 必装, 非常有用")).toEqual(["非常有用", "必装"]);
  });

  it("canonicalListTag 供 list 筛选", () => {
    expect(canonicalListTag("useful")).toBe("非常有用");
    expect(canonicalListTag("  ")).toBeUndefined();
  });

  it("高价值排序置顶", () => {
    const items = [
      { name: "b", tags: ["教程"] },
      { name: "a", tags: ["非常有用"] },
      { name: "c", tags: [] },
    ];
    const sorted = [...items].sort((a, b) =>
      compareByHighValueTags(a, b, (x) => x.tags, (x) => x.name),
    );
    expect(sorted.map((x) => x.name)).toEqual(["a", "b", "c"]);
    expect(hasHighValueTag(["必装"])).toBe(true);
  });

  it("suggestTags 优先高价值并排除已选", () => {
    const s = suggestTags("", ["非常有用"], [], 8);
    expect(s).not.toContain("非常有用");
    expect(s[0]).toBe("必装");
  });

  it("buildTagFacets 排除 Inbox 噪音并按高价值优先", () => {
    const facets = buildTagFacets([
      { tags: ["like", "非常有用"] },
      { tags: "fav,教程" },
      { tags: ["非常有用"] },
    ]);
    expect(facets.find((f) => f.tag === "like")).toBeUndefined();
    expect(facets[0]?.tag).toBe("非常有用");
    expect(facets[0]?.count).toBe(2);
  });
});
