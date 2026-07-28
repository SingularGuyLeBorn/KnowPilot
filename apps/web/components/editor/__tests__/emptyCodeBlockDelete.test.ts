import { describe, expect, it } from "vitest";
import { shouldDeleteEmptyCodeBlock } from "@/components/editor/emptyCodeBlockDelete";

describe("shouldDeleteEmptyCodeBlock", () => {
  it("empty code_block → delete", () => {
    expect(shouldDeleteEmptyCodeBlock("code_block", "")).toBe(true);
    expect(shouldDeleteEmptyCodeBlock("code_block", "  \n")).toBe(true);
  });

  it("non-empty code_block → keep", () => {
    expect(shouldDeleteEmptyCodeBlock("code_block", "const x = 1")).toBe(false);
  });

  it("other nodes → ignore", () => {
    expect(shouldDeleteEmptyCodeBlock("paragraph", "")).toBe(false);
    expect(shouldDeleteEmptyCodeBlock("math_block", "")).toBe(false);
  });
});
