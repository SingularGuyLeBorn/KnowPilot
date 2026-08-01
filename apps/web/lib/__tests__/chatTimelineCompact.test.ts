import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@knowpilot/shared";
import { buildChatTimeline, buildMessageGroups } from "../chatMessageUtils";
import { COMPACT_BOUNDARY_PREFIX } from "../compactMarkers";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return {
    sessionId: "s1",
    createdAt: new Date().toISOString(),
    toolCalls: null,
    toolResults: null,
    tokenUsage: null,
    ...partial,
  } as ChatMessage;
}

describe("buildChatTimeline 压缩边界", () => {
  it("压缩边界不覆盖上一轮 assistant，且单独成卡", () => {
    const user = msg({ id: "u1", role: "user", content: "写笔记" });
    const asst = msg({ id: "a1", role: "assistant", content: "写好了" });
    const boundary = msg({
      id: "b1",
      role: "assistant",
      content: `${COMPACT_BOUNDARY_PREFIX}v1]\n自动压缩：10 条`,
      toolCalls: [{ id: "c", name: "__context_compact__", kind: "compact", args: { messagesSummarized: 10 }, result: {} }],
      source: "system",
    });
    const nextUser = msg({ id: "u2", role: "user", content: "继续" });

    const groups = buildMessageGroups([user, asst, boundary, nextUser]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.assistantMessage?.id).toBe("a1");
    expect(groups[0]!.assistantMessage?.content).toBe("写好了");

    const timeline = buildChatTimeline([user, asst, boundary, nextUser]);
    expect(timeline.map((t) => t.kind)).toEqual(["group", "compact", "group"]);
    expect(timeline[0]!.kind === "group" && timeline[0].group.assistantMessage?.id).toBe("a1");
    expect(timeline[1]!.kind === "compact" && timeline[1].message.id).toBe("b1");
  });
});
