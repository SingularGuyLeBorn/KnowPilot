import { describe, it, expect } from "vitest";
import { buildLlmMessagesFromHistory, parseStoredToolCalls } from "../infra/chatHistory.js";

describe("chatHistory 工具回放", () => {
  it("parseStoredToolCalls 保留 id", () => {
    const tools = parseStoredToolCalls([
      { id: "call_abc", name: "read_file", args: { path: "a.md" }, result: { ok: true } },
    ]);
    expect(tools[0].id).toBe("call_abc");
    expect(tools[0].name).toBe("read_file");
  });

  it("buildLlmMessagesFromHistory 重建 assistant+tool 消息链", () => {
    const messages = buildLlmMessagesFromHistory("system", [
      { role: "user", content: "读文件" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "read_file", args: { path: "x.md" }, result: { content: "hi" } }],
      },
      { role: "assistant", content: "文件内容是 hi" },
    ]);

    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(messages[2].tool_calls?.[0].id).toBe("call_1");
    expect(messages[3].tool_call_id).toBe("call_1");
    expect(messages[3].role).toBe("tool");
  });
});
