import { describe, it, expect } from "vitest";
import {
  checkToolLoop,
  createLoopGuardState,
  toolCallFingerprint,
  stableStringify,
} from "../infra/loop/toolLoopGuard.js";

describe("toolLoopGuard", () => {
  it("同参连续 3 次熔断", () => {
    let state = createLoopGuardState();
    const call = { name: "read_article", args: { url: "https://x.com/a" } };
    for (let i = 0; i < 2; i++) {
      const v = checkToolLoop(state, [call], 3);
      expect(v.blocked).toBe(false);
      state = v.state;
    }
    const blocked = checkToolLoop(state, [call], 3);
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) {
      expect(blocked.message).toMatch(/死循环/);
    }
  });

  it("不同参数打断 streak", () => {
    let state = createLoopGuardState();
    state = checkToolLoop(state, [{ name: "read_file", args: { path: "a" } }], 3).state;
    state = checkToolLoop(state, [{ name: "read_file", args: { path: "a" } }], 3).state;
    state = checkToolLoop(state, [{ name: "read_file", args: { path: "b" } }], 3).state;
    const v = checkToolLoop(state, [{ name: "read_file", args: { path: "a" } }], 3);
    expect(v.blocked).toBe(false);
  });

  it("stableStringify 键序无关", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(toolCallFingerprint({ name: "native:x", args: { z: 1, a: 2 } })).toBe(
      toolCallFingerprint({ name: "x", args: { a: 2, z: 1 } }),
    );
  });
});
