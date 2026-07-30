import { describe, it, expect } from "vitest";
import {
  checkToolLoop,
  createLoopGuardState,
  toolCallFingerprint,
  stableStringify,
  detectOscillation,
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

  it("不同参数打断同参 streak，但未达同名上限时不熔断", () => {
    let state = createLoopGuardState();
    state = checkToolLoop(state, [{ name: "read_file", args: { path: "a" } }], 3).state;
    state = checkToolLoop(state, [{ name: "read_file", args: { path: "a" } }], 3).state;
    state = checkToolLoop(state, [{ name: "read_file", args: { path: "b" } }], 3).state;
    const v = checkToolLoop(state, [{ name: "read_file", args: { path: "a" } }], 3);
    expect(v.blocked).toBe(false);
  });

  it("同名变参连续达到 nameStreakLimit 熔断（P2-01）", () => {
    let state = createLoopGuardState();
    for (let i = 0; i < 5; i++) {
      const v = checkToolLoop(state, [{ name: "web_search", args: { q: `q${i}` } }], 3, 6);
      expect(v.blocked).toBe(false);
      state = v.state;
    }
    const blocked = checkToolLoop(state, [{ name: "web_search", args: { q: "q5" } }], 3, 6);
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) expect(blocked.message).toMatch(/同一工具/);
  });

  it("双指纹交替熔断（P2-01）", () => {
    let state = createLoopGuardState();
    const a = { name: "read_file", args: { path: "a" } };
    const b = { name: "read_file", args: { path: "b" } };
    // A B A B A → 尚未满 6；再 B → 交替窗口命中
    for (const call of [a, b, a, b, a]) {
      const v = checkToolLoop(state, [call], 99, 99);
      expect(v.blocked).toBe(false);
      state = v.state;
    }
    const blocked = checkToolLoop(state, [b], 99, 99);
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) expect(blocked.message).toMatch(/交替/);
  });

  it("detectOscillation 识别 A/B 乒乓", () => {
    const a = "read_file::{\"path\":\"a\"}";
    const b = "read_file::{\"path\":\"b\"}";
    expect(detectOscillation([a, b, a, b, a, b])).toBeTruthy();
    expect(detectOscillation([a, a, a, a, a, a])).toBeNull();
  });

  it("stableStringify 键序无关", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(toolCallFingerprint({ name: "native:x", args: { z: 1, a: 2 } })).toBe(
      toolCallFingerprint({ name: "x", args: { a: 2, z: 1 } }),
    );
  });
});
