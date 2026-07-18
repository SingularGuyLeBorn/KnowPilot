/**
 * Hermes A：experience 写入策略（跳过纯闲聊）。
 */

import { describe, expect, it } from "vitest";
import { shouldAccumulateExperience } from "../infra/agentEvolution.js";

describe("shouldAccumulateExperience", () => {
  it("无 toolCalls 不写", () => {
    expect(shouldAccumulateExperience({ toolCalls: [] })).toBe(false);
    expect(shouldAccumulateExperience({ toolCalls: null })).toBe(false);
    expect(shouldAccumulateExperience({})).toBe(false);
  });

  it("仅有非 tool kind 不写", () => {
    expect(
      shouldAccumulateExperience({
        toolCalls: [{ id: "1", name: "x", kind: "thinking", arguments: {} } as any],
      }),
    ).toBe(false);
  });

  it("有 kind=tool 才写", () => {
    expect(
      shouldAccumulateExperience({
        toolCalls: [{ id: "1", name: "native:web_search", kind: "tool", arguments: {} } as any],
      }),
    ).toBe(true);
  });
});
