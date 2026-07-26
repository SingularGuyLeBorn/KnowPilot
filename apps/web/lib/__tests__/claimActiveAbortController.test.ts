import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetSessionComposeStoreForTests,
  sessionComposeActions,
} from "../useSessionComposeState";

describe("claimActiveAbortController (resume CAS)", () => {
  beforeEach(() => {
    __resetSessionComposeStoreForTests();
  });

  it("空闲时可认领", () => {
    const ac = new AbortController();
    expect(sessionComposeActions.claimActiveAbortController("s1", ac)).toBe(true);
    expect(sessionComposeActions.getActiveAbortController("s1")).toBe(ac);
  });

  it("已有未 abort 的 AC 时第二路 resume 认领失败（单飞）", () => {
    const a = new AbortController();
    const b = new AbortController();
    expect(sessionComposeActions.claimActiveAbortController("s1", a)).toBe(true);
    expect(sessionComposeActions.claimActiveAbortController("s1", b)).toBe(false);
    expect(sessionComposeActions.getActiveAbortController("s1")).toBe(a);
  });

  it("旧 AC 已 abort 后允许新 resume 替换", () => {
    const a = new AbortController();
    const b = new AbortController();
    expect(sessionComposeActions.claimActiveAbortController("s1", a)).toBe(true);
    a.abort();
    expect(sessionComposeActions.claimActiveAbortController("s1", b)).toBe(true);
    expect(sessionComposeActions.getActiveAbortController("s1")).toBe(b);
  });
});
