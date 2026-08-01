import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@knowpilot/shared";
import {
  buildContextUsage,
  messagesInLlmContextWindow,
} from "../contextUsage";
import { COMPACT_BOUNDARY_PREFIX } from "../compactMarkers";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return {
    sessionId: "s1",
    createdAt: new Date().toISOString(),
    ...partial,
  } as ChatMessage;
}

function fatAssistant(id: string, content: string): ChatMessage {
  const toolCalls = [
    {
      id: `${id}-c1`,
      name: "list_directory",
      args: { path: "." },
      result: { items: Array.from({ length: 80 }, (_, i) => `f${i}-${"x".repeat(40)}`) },
      kind: "tool",
    },
  ];
  return msg({
    id,
    role: "assistant",
    content,
    toolCalls,
    toolResults: {
      versionMeta: {
        activeIndex: 0,
        versions: [{ id: `v-${id}`, content, toolCalls, createdAt: new Date().toISOString() }],
      },
    },
  });
}

describe("buildContextUsage 送模口径", () => {
  it("不把 toolCalls 与 versionMeta 双写重复计入工具调用", () => {
    const toolCalls = [
      {
        id: "c1",
        name: "list_directory",
        args: { path: "." },
        result: { items: Array.from({ length: 50 }, (_, i) => `f${i}`) },
        kind: "tool",
      },
    ];
    const m = msg({
      id: "a1",
      role: "assistant",
      content: "好的",
      toolCalls,
      toolResults: {
        versionMeta: {
          activeIndex: 0,
          versions: [{ id: "v1", content: "好的", toolCalls, createdAt: new Date().toISOString() }],
        },
      },
    });

    const usage = buildContextUsage({
      messages: [m],
      systemPrompt: "sys",
      modelId: "deepseek-v4-flash",
    });
    const toolsSeg = usage.segments.find((s) => s.id === "tools");
    expect(toolsSeg?.tokens ?? 0).toBeLessThan(1500);
    expect(usage.estimatedTotal).toBeLessThan(2000);
  });

  it("thinking 计入思考段而非工具调用", () => {
    const toolCalls = [
      { id: "t1", name: "__thinking__", args: { round: 1 }, result: "x".repeat(4000), kind: "thinking" },
      {
        id: "c1",
        name: "web_search",
        args: { q: "hi" },
        result: { ok: true },
        kind: "tool",
      },
    ];
    const m = msg({
      id: "a2",
      role: "assistant",
      content: "done",
      toolResults: {
        versionMeta: {
          activeIndex: 0,
          versions: [{ id: "v1", content: "done", toolCalls, createdAt: new Date().toISOString() }],
        },
      },
    });
    const usage = buildContextUsage({ messages: [m], systemPrompt: "" });
    const thinking = usage.segments.find((s) => s.id === "thinking");
    const tools = usage.segments.find((s) => s.id === "tools");
    expect(thinking?.tokens ?? 0).toBeGreaterThan(900);
    expect(tools?.tokens ?? 0).toBeLessThan(200);
  });

  it("压缩边界之后才计入窗口；边界前胖消息不抬高总量", () => {
    const oldFat = fatAssistant("old", "花园初版完成，很长工具链");
    const boundary = msg({
      id: "b1",
      role: "assistant",
      content: `${COMPACT_BOUNDARY_PREFIX}manual]`,
      toolCalls: [{ id: "c", name: "__context_compact__", args: {}, result: {}, kind: "compact" }],
    });
    const recent = msg({ id: "u2", role: "user", content: "动画现在咋样?" });
    const recentAsst = msg({ id: "a3", role: "assistant", content: "已部署。" });

    const windowed = messagesInLlmContextWindow([oldFat, boundary, recent, recentAsst]);
    expect(windowed.map((m) => m.id)).toEqual(["u2", "a3"]);

    const usage = buildContextUsage({
      messages: [oldFat, boundary, recent, recentAsst],
      systemPrompt: "sys",
      contextSummary: "摘要：已建 diffusion-llm 花园五篇文章。",
    });

    // 若误计 oldFat，tools 会接近 1k+；窗口内几乎无工具
    const tools = usage.segments.find((s) => s.id === "tools")?.tokens ?? 0;
    expect(tools).toBe(0);
    expect(usage.estimatedTotal).toBeLessThan(2_000);
    expect(usage.compression.hasAutoCompacted).toBe(true);
    expect(usage.topMessages.some((m) => m.id === "old")).toBe(false);
  });

  it("↑↓ 累计不等于估算上下文", () => {
    const usage = buildContextUsage({
      messages: [
        msg({ id: "u1", role: "user", content: "hello" }),
        msg({
          id: "a1",
          role: "assistant",
          content: "hi",
          tokenUsage: { prompt: 100_000, completion: 50, total: 100_050 },
        }),
      ],
      systemPrompt: "s",
    });
    expect(usage.inputTokens).toBe(100_000);
    expect(usage.estimatedTotal).toBeLessThan(5_000);
  });

  it("deepseek-v4-flash 窗口为 1M；compactRatio ≈ ratio / triggerRatio", () => {
    const usage = buildContextUsage({
      messages: [msg({ id: "u1", role: "user", content: "x".repeat(40_000) })],
      systemPrompt: "sys",
      modelId: "deepseek-v4-flash",
      triggerRatio: 0.75,
    });
    expect(usage.maxContextTokens).toBe(1_000_000);
    expect(usage.ratio).toBeLessThan(0.05);
    // compactRatio 相对压缩阈值放大：ratio / 0.75
    expect(usage.compactRatio).toBeGreaterThan(usage.ratio);
    expect(usage.compactRatio).toBeCloseTo(usage.ratio / 0.75, 2);
  });
});
