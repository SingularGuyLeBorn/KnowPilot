import { describe, expect, it } from "vitest";
import {
  applyLatexCompletion,
  latexGhostSuffix,
  matchLatexCompletion,
} from "@/components/editor/latexCompletions";

describe("latexCompletions", () => {
  it("\\fr 补全为 \\frac{}{}", () => {
    const c = matchLatexCompletion("\\fr");
    expect(c).not.toBeNull();
    expect(c!.insert).toBe("\\frac{}{}");
    expect(latexGhostSuffix(c!)).toBe("ac{}{}");
    const applied = applyLatexCompletion("\\fr", 3, c!);
    expect(applied.next).toBe("\\frac{}{}");
    expect(applied.next.slice(0, applied.cursor)).toBe("\\frac{");
  });

  it("无反斜杠 frac 也能补全", () => {
    const c = matchLatexCompletion("frac");
    expect(c).not.toBeNull();
    expect(c!.insert).toBe("\\frac{}{}");
    const applied = applyLatexCompletion("frac", 4, c!);
    expect(applied.next).toBe("\\frac{}{}");
  });

  it("中文别名 分数", () => {
    const c = matchLatexCompletion("分数");
    expect(c).not.toBeNull();
    expect(c!.insert).toBe("\\frac{}{}");
  });

  it("完整 \\sum 补结构", () => {
    const c = matchLatexCompletion("\\sum");
    expect(c).not.toBeNull();
    expect(c!.insert).toContain("\\sum_");
  });

  it("单字母不误触", () => {
    expect(matchLatexCompletion("\\a")).toBeNull();
  });
});
