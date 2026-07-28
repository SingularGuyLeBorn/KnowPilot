import { describe, expect, it } from "vitest";
import { FORMULA_COPILOT_CONTEXT_LINES } from "@knowpilot/shared";

describe("mathFormulaCopilot constants", () => {
  it("上下文默认 10 行", () => {
    expect(FORMULA_COPILOT_CONTEXT_LINES).toBe(10);
  });
});
