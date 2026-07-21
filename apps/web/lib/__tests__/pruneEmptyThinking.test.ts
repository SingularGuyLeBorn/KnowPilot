import { describe, it, expect } from "vitest";
import {
  buildTimelineFromStored,
  pruneEmptyThinkingSteps,
  type TimelineStep,
} from "@/lib/chatMessageUtils";

describe("pruneEmptyThinking / buildTimelineFromStored", () => {
  it("pruneEmptyThinkingSteps 去掉无正文 Thinking，保留工具与有内容思考", () => {
    const steps: TimelineStep[] = [
      { type: "thinking", content: "", round: 1 },
      { type: "tool", toolCallId: "t1", name: "feishu_create_doc", args: {}, round: 1, status: "done" },
      { type: "thinking", content: "  有内容  ", round: 2 },
      { type: "thinking", content: "   ", round: 3 },
    ];
    const pruned = pruneEmptyThinkingSteps(steps);
    expect(pruned).toHaveLength(2);
    expect(pruned[0].type).toBe("tool");
    expect(pruned[1]).toMatchObject({ type: "thinking", content: "  有内容  " });
  });

  it("buildTimelineFromStored 跳过空 __thinking__", () => {
    const steps = buildTimelineFromStored([
      { id: "think_1", name: "__thinking__", args: { round: 1 }, result: "", kind: "thinking" },
      {
        id: "c1",
        name: "feishu_append_doc_text",
        args: {},
        result: { ok: true },
        kind: "tool",
      },
      {
        id: "think_2",
        name: "__thinking__",
        args: { round: 2 },
        result: "接下来写正文",
        kind: "thinking",
      },
    ]);
    expect(steps.filter((s) => s.type === "thinking")).toHaveLength(1);
    expect(steps.find((s) => s.type === "thinking")).toMatchObject({
      content: "接下来写正文",
      round: 2,
    });
    expect(steps.some((s) => s.type === "tool")).toBe(true);
  });
});
