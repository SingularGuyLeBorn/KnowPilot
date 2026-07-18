import { describe, it, expect } from "vitest";
import { sessionLabel, agentLabel, memoryLabel, runLabel } from "../displayLabels.js";

describe("displayLabels", () => {
  it("sessionLabel 优先 autoName，永不回退 id", () => {
    expect(sessionLabel({ autoName: "周报", title: "新对话" })).toBe("周报");
    expect(sessionLabel({ title: "草稿" })).toBe("草稿");
    expect(sessionLabel({})).toBe("新对话");
    expect(sessionLabel(null)).toBe("新对话");
  });

  it("agentLabel / memoryLabel / runLabel", () => {
    expect(agentLabel({ name: "assistant" })).toBe("assistant");
    expect(memoryLabel({ content: "用户喜欢深色主题" })).toBe("用户喜欢深色主题");
    expect(memoryLabel({ content: "a".repeat(50) }).endsWith("…")).toBe(true);
    expect(runLabel({ agentName: "assistant", status: "成功" })).toBe("assistant · 成功");
  });
});
