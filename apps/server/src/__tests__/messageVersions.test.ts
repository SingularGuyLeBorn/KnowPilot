import { describe, expect, it } from "vitest";
import {
  getActiveAssistantPayload,
  syncAssistantActiveContent,
} from "../infra/messageVersions.js";

describe("syncAssistantActiveContent", () => {
  it("同步写回激活版本 content，并保留其它 toolResults 字段", () => {
    const msg = {
      content: "旧回复",
      toolCalls: [],
      toolResults: {
        versionMeta: {
          versions: [
            { id: "v1", content: "版本 A", createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "v2", content: "版本 B", createdAt: "2026-01-02T00:00:00.000Z" },
          ],
          activeIndex: 1,
        },
        otherFlag: true,
      },
    };
    const next = syncAssistantActiveContent(msg, "手工改过的 B");
    expect(next.otherFlag).toBe(true);
    expect(next.versionMeta).toEqual({
      versions: [
        { id: "v1", content: "版本 A", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "v2", content: "手工改过的 B", createdAt: "2026-01-02T00:00:00.000Z" },
      ],
      activeIndex: 1,
    });
    // 未激活版本不动
    const payload = getActiveAssistantPayload({
      content: "手工改过的 B",
      toolResults: next,
    });
    expect(payload.content).toBe("手工改过的 B");
    expect(payload.versionMeta.versions[0].content).toBe("版本 A");
  });

  it("无 versionMeta 时物化一份并写入新 content", () => {
    const next = syncAssistantActiveContent({ content: "原始", toolCalls: [] }, "编辑后");
    const meta = (next.versionMeta as { versions: { content: string }[]; activeIndex: number });
    expect(meta.activeIndex).toBe(0);
    expect(meta.versions).toHaveLength(1);
    expect(meta.versions[0].content).toBe("编辑后");
  });
});
