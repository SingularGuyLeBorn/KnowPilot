import { describe, it, expect } from "vitest";
import {
  makeAbortError,
  messageFromAbortSignal,
  resolveAbortReasonCode,
} from "../infra/abortReason.js";

describe("abortReason", () => {
  it("按 AbortSignal.reason 生成文案，不再一律用户中断", () => {
    const c = new AbortController();
    c.abort("timeout");
    expect(resolveAbortReasonCode(c.signal)).toBe("timeout");
    expect(messageFromAbortSignal(c.signal)).toContain("超时");
    expect(messageFromAbortSignal(c.signal)).not.toContain("用户中断");
  });

  it("makeAbortError 带 AbortError 名与对应文案", () => {
    const c = new AbortController();
    c.abort("cancel");
    const err = makeAbortError(c.signal);
    expect(err.name).toBe("AbortError");
    expect(err.message).toContain("主动取消");
  });

  it("user 原因仍保留用户中断文案", () => {
    const c = new AbortController();
    c.abort("user");
    expect(messageFromAbortSignal(c.signal)).toBe("流式输出已被用户中断");
  });
});
