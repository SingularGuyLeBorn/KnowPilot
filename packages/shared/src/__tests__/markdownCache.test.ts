import { describe, it, expect, beforeEach } from "vitest";
import { memoizeMarkdownTransform, clearMarkdownCache } from "../markdownCache.js";

describe("memoizeMarkdownTransform", () => {
  beforeEach(() => {
    clearMarkdownCache();
  });

  it("应缓存 transform 结果", () => {
    let calls = 0;
    const transform = (input: string) => {
      calls++;
      return input.toUpperCase();
    };

    expect(memoizeMarkdownTransform("hello", transform)).toBe("HELLO");
    expect(memoizeMarkdownTransform("hello", transform)).toBe("HELLO");
    expect(calls).toBe(1);
  });
});
