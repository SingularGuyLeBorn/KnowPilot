import { describe, expect, it } from "vitest";
import { stripLeadingMarkdownFrontmatter } from "../scripts/sync/utils.js";

describe("stripLeadingMarkdownFrontmatter", () => {
  it("剥掉正文里误嵌的 frontmatter", () => {
    const raw = `---
title: "x"
tags:
  - "a"
published: true
---

# 正文

hello`;
    expect(stripLeadingMarkdownFrontmatter(raw)).toBe("# 正文\n\nhello");
  });

  it("无 frontmatter 原样返回", () => {
    expect(stripLeadingMarkdownFrontmatter("# hi\n")).toBe("# hi\n");
  });

  it("双层 frontmatter 全剥", () => {
    const raw = `---
title: "a"
---
---
title: "b"
---

# body`;
    expect(stripLeadingMarkdownFrontmatter(raw)).toBe("# body");
  });
});
