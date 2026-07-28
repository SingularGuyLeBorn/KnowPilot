/**
 * 回归：mdast-util-math@3 的 inlineMath 序列化依赖
 * mdast-util-to-markdown ≥2.1 的 state.compilePattern。
 * 若被降回 2.0.0，Milkdown EditorState.create 会抛
 *「state.compilePattern is not a function」，含行内公式的文章整页空白。
 */
import { describe, expect, it } from "vitest";
import { toMarkdown } from "mdast-util-to-markdown";
import { mathToMarkdown } from "mdast-util-math";

describe("mdast math serialize (compilePattern)", () => {
  it("serializes inlineMath without throwing", () => {
    const tree = {
      type: "root" as const,
      children: [
        {
          type: "paragraph" as const,
          children: [
            { type: "text" as const, value: "ratio " },
            { type: "inlineMath" as const, value: "r_i" },
            { type: "text" as const, value: " ok" },
          ],
        },
      ],
    };
    const out = toMarkdown(tree, { extensions: [mathToMarkdown()] });
    expect(out).toContain("$r_i$");
  });
});
