import { describe, it, expect } from "vitest";
import { resolveResumeAfter } from "../infra/agentStream.js";

describe("agentStream resumeAfter 校验", () => {
  it("数字直接返回", () => {
    expect(resolveResumeAfter(42)).toBe(42);
    expect(resolveResumeAfter(0)).toBe(0);
  });

  it("数字字符串解析", () => {
    expect(resolveResumeAfter("15")).toBe(15);
  });

  it("NaN 按 0 处理", () => {
    expect(resolveResumeAfter(NaN)).toBe(0);
    expect(resolveResumeAfter("abc")).toBe(0);
  });

  it("负数按 0 处理", () => {
    expect(resolveResumeAfter(-1)).toBe(0);
  });

  it("Infinity 按 0 处理", () => {
    expect(resolveResumeAfter(Infinity)).toBe(0);
  });

  it("超大数按 0 处理（避免 SQL 参数异常）", () => {
    expect(resolveResumeAfter(Number.MAX_SAFE_INTEGER + 1)).toBe(0);
  });

  it("null/undefined 按 0 处理", () => {
    expect(resolveResumeAfter(null)).toBe(0);
    expect(resolveResumeAfter(undefined)).toBe(0);
  });
});
