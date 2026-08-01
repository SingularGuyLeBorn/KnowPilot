import { describe, expect, it } from "vitest";
import { shouldDeleteEmptyBlock } from "@/components/editor/emptyCodeBlockDelete";

describe("shouldDeleteEmptyBlock", () => {
  it("empty code_block and math_display → delete", () => {
    expect(shouldDeleteEmptyBlock("code_block", "")).toBe(true);
    expect(shouldDeleteEmptyBlock("code_block", "  \n")).toBe(true);
    expect(shouldDeleteEmptyBlock("math_display", "")).toBe(true);
  });

  it("empty paragraph → delete", () => {
    expect(shouldDeleteEmptyBlock("paragraph", "")).toBe(true);
    expect(shouldDeleteEmptyBlock("paragraph", "hello")).toBe(false);
  });

  it("non-empty code_block → keep", () => {
    expect(shouldDeleteEmptyBlock("code_block", "const x = 1")).toBe(false);
  });
});
