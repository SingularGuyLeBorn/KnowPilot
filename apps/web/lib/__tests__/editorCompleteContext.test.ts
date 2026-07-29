import { describe, expect, it } from "vitest";
import {
  detectEditorAgentAtTrigger,
  extractEditorCompleteContext,
  findParagraphBounds,
} from "@/lib/editorCompleteContext";

describe("editorCompleteContext", () => {
  it("按空行切段落", () => {
    const doc = "第一段\n仍是第一段\n\n第二段";
    const a = findParagraphBounds(doc, 3);
    expect(doc.slice(a.start, a.end)).toBe("第一段\n仍是第一段");
    const b = findParagraphBounds(doc, doc.length - 1);
    expect(doc.slice(b.start, b.end)).toBe("第二段");
  });

  it("默认带上当前段落", () => {
    const doc = "前文\n\n这里应该是 LoRA 例子\n\n后文";
    const ctx = extractEditorCompleteContext(doc, 10, 10);
    expect(ctx.paragraph).toContain("这里应该是");
    expect(ctx.before).toContain("前文");
    expect(ctx.after).toContain("后文");
  });

  it("只识别 @agent 前缀", () => {
    expect(detectEditorAgentAtTrigger("hello @", 7)).toBeNull();
    expect(detectEditorAgentAtTrigger("hello @agent", 12)).toEqual({
      token: "@agent",
      query: "",
      tokenStart: 6,
    });
    expect(detectEditorAgentAtTrigger("x @agent写作", 10)?.query).toBe("写作");
  });
});
