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

  it("同名变参连续达到 nameStreakLimit 熔断（非勘察工具）", () => {
    let state = createLoopGuardState();
    // web_search 已进勘察白名单；用写侧工具验证同名变参熔断
    for (let i = 0; i < 5; i++) {
      const v = checkToolLoop(state, [{ name: "post_create", args: { title: `t${i}` } }], 3, 6);
      expect(v.blocked).toBe(false);
      state = v.state;
    }
    const blocked = checkToolLoop(state, [{ name: "post_create", args: { title: "t5" } }], 3, 6);
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) expect(blocked.message).toMatch(/同一工具/);
  });

  it("连续 web_search 不同关键词不触发同名熔断", () => {
    let state = createLoopGuardState();
    for (let i = 0; i < 8; i++) {
      const v = checkToolLoop(state, [{ name: "web_search", args: { q: `q${i}` } }], 3, 6);
      expect(v.blocked).toBe(false);
      state = v.state;
    }
  });

  it("场景 B 资料员：连续 save_webpage 不同 URL 不熔断", () => {
    let state = createLoopGuardState();
    for (let i = 0; i < 8; i++) {
      const v = checkToolLoop(
        state,
        [{ name: "save_webpage", args: { url: `https://ex.com/${i}` } }],
        3,
        6,
      );
      expect(v.blocked).toBe(false);
      state = v.state;
    }
  });

  it("双指纹交替熔断（P2-01，非勘察工具）", () => {
    let state = createLoopGuardState();
    const a = { name: "post_create", args: { title: "a" } };
    const b = { name: "post_create", args: { title: "b" } };
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

  it("勘察类 list/read 不同路径不触发同名/交替熔断，同参仍熔断", () => {
    let state = createLoopGuardState();
    for (let i = 0; i < 8; i++) {
      const v = checkToolLoop(state, [{ name: "list_directory", args: { path: `d${i}` } }], 3, 6);
      expect(v.blocked).toBe(false);
      state = v.state;
    }
    const a = { name: "read_file", args: { path: "a.md" } };
    const b = { name: "read_file", args: { path: "b.md" } };
    for (const call of [a, b, a, b, a, b]) {
      const v = checkToolLoop(state, [call], 3, 6);
      expect(v.blocked).toBe(false);
      state = v.state;
    }
    // 同参连续仍熔断
    state = checkToolLoop(state, [a], 3, 6).state;
    state = checkToolLoop(state, [a], 3, 6).state;
    const blocked = checkToolLoop(state, [a], 3, 6);
    expect(blocked.blocked).toBe(true);
  });

  it("连续 read_article 不同 URL 不触发同名熔断", () => {
    let state = createLoopGuardState();
    for (let i = 0; i < 8; i++) {
      const v = checkToolLoop(
        state,
        [{ name: "read_article", args: { url: `https://x.com/${i}` } }],
        3,
        6,
      );
      expect(v.blocked).toBe(false);
      state = v.state;
    }
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
