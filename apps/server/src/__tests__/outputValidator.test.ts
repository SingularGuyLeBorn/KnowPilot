/**
 * P0 outputValidator 单元测试
 */

import { describe, it, expect } from "vitest";
import {
  validateOutputContent,
  formatValidationErrors,
  type OutputValidationError,
} from "../infra/outputValidator.js";

describe("outputValidator", () => {
  it("合法 Markdown（frontmatter + 正文）通过验证", () => {
    const content = [
      "---",
      'title: "Hello World"',
      "---",
      "",
      "这是一篇合法文章。",
      "",
      "$$E = mc^2$$",
    ].join("\n");
    const result = validateOutputContent("content/posts/hello.md", content);
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("Markdown 含 Unicode 伪公式符号时返回错误与修复建议", () => {
    const content = [
      "---",
      'title: "Bad Math"',
      "---",
      "",
      "注意力分数 = √d_k",
    ].join("\n");
    const result = validateOutputContent("content/posts/bad-math.md", content);
    expect(result.ok).toBe(false);
    const errors = result.errors!;
    expect(errors.some((e) => e.code === "MD_PSEUDO_MATH_UNICODE")).toBe(true);
    const err = errors.find((e) => e.code === "MD_PSEUDO_MATH_UNICODE")!;
    expect(err.fix).toContain("\\sqrt");
    expect(err.message).toContain("√");
  });

  it("content/ 下 Markdown 缺少 title frontmatter 时返回错误", () => {
    const content = ["---", "published: true", "---", "", "无标题文章"].join("\n");
    const result = validateOutputContent("content/posts/no-title.md", content);
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.code === "MD_FRONTMATTER_MISSING_TITLE")).toBe(true);
  });

  it("非法 YAML frontmatter 返回解析错误", () => {
    const content = ["---", "title: [unclosed", "---", "", "正文"].join("\n");
    const result = validateOutputContent("content/posts/bad-yaml.md", content);
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.code === "MD_FRONTMATTER_INVALID")).toBe(true);
  });

  it("Windows 绝对路径图片返回错误", () => {
    const content = '![图](C:\\\\Users\\\\me\\\\pic.png)';
    const result = validateOutputContent("content/posts/pic.md", content);
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.code === "MD_IMAGE_ABSOLUTE_WINDOWS_PATH")).toBe(true);
  });

  it("content/uploads/ 相对路径图片通过验证", () => {
    const content = [
      "---",
      'title: "带图文章"',
      "---",
      "",
      "![图](content/uploads/pic.png)",
    ].join("\n");
    const result = validateOutputContent("content/posts/pic.md", content);
    expect(result.ok).toBe(true);
  });

  it("合法 TypeScript 通过验证", () => {
    const content = `export const x = 1;`;
    const result = validateOutputContent("apps/server/src/foo.ts", content);
    expect(result.ok).toBe(true);
  });

  it("TypeScript 语法错误返回错误", () => {
    const content = `const x =`;
    const result = validateOutputContent("apps/server/src/bad.ts", content);
    expect(result.ok).toBe(false);
    expect(result.errors!.some((e) => e.code === "TS_SYNTAX_ERROR")).toBe(true);
  });

  it("合法 TSX 通过验证", () => {
    const content = `export const App = () => <div>hello</div>;`;
    const result = validateOutputContent("apps/web/app.tsx", content);
    expect(result.ok).toBe(true);
  });

  it("不支持的文件类型直接通过", () => {
    const result = validateOutputContent("data/foo.json", '{"a": 1}');
    expect(result.ok).toBe(true);
  });

  it("config/agents/ 下 Markdown 的 Unicode 符号不做伪公式拦截", () => {
    const content = [
      "---",
      'name: "Test Agent"',
      'tier: "manager"',
      "---",
      "",
      "上下文占比 ≥80% 时主动 compact 或 rotate。",
    ].join("\n");
    const result = validateOutputContent("config/agents/test-agent.md", content);
    expect(result.ok).toBe(true);
  });

  it("config/memories/ 下 Markdown 不做标题强制", () => {
    const content = "---\ntype: note\nstrength: 0.8\n---\n\n一条记忆。";
    const result = validateOutputContent("config/memories/cabc123.md", content);
    expect(result.ok).toBe(true);
  });

  it("formatValidationErrors 包含所有错误与修复建议", () => {
    const errors: OutputValidationError[] = [
      { code: "A", message: "msg A", fix: "fix A" },
      { code: "B", message: "msg B", fix: "fix B" },
    ];
    const text = formatValidationErrors(errors);
    expect(text).toContain("[A] msg A");
    expect(text).toContain("fix A");
    expect(text).toContain("[B] msg B");
    expect(text).toContain("fix B");
  });
});
