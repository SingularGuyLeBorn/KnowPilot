import { describe, it, expect } from "vitest";
import {
  buildLlmMessagesFromHistory,
  buildUserMessageContentForLlm,
  parseAttachmentsFromToolResults,
  parseStoredToolCalls,
} from "../infra/chatHistory.js";

describe("chatHistory 工具回放", () => {
  it("parseStoredToolCalls 保留 id", () => {
    const tools = parseStoredToolCalls([
      { id: "call_abc", name: "read_file", args: { path: "a.md" }, result: { ok: true } },
    ]);
    expect(tools[0].id).toBe("call_abc");
    expect(tools[0].name).toBe("read_file");
  });

  it("buildUserMessageContentForLlm vision 模型输出 image_url parts", () => {
    const content = buildUserMessageContentForLlm(
      "描述图片",
      [{ name: "a.png", mimeType: "image/png", previewUrl: "data:image/png;base64,abc" }],
      true,
    );
    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual([
      { type: "text", text: "描述图片" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc", detail: "auto" } },
    ]);
  });

  it("buildLlmMessagesFromHistory 重建扁平存储的 assistant+tool 消息链", () => {
    // runtime 实际存储：一条 assistant(content=final + toolCalls=[all tools])
    const messages = buildLlmMessagesFromHistory("system", [
      { role: "user", content: "读文件" },
      {
        role: "assistant",
        content: "文件内容是 hi",
        toolCalls: [{ id: "call_1", name: "read_file", args: { path: "x.md" }, result: { content: "hi" } }],
      },
    ]);

    // 重建后：assistant(content=null, tool_calls) → tool → assistant(content=final)
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(messages[2].tool_calls?.[0].id).toBe("call_1");
    expect(messages[2].content).toBeNull();
    expect(messages[3].tool_call_id).toBe("call_1");
    expect(messages[3].role).toBe("tool");
    expect(messages[4].content).toBe("文件内容是 hi");
  });

  it("parseAttachmentsFromToolResults 从 user toolResults 解析 OCR 附件", () => {
    const attachments = parseAttachmentsFromToolResults({
      attachments: [
        {
          name: "chart.png",
          mimeType: "image/png",
          previewUrl: "data:image/png;base64,abc",
          extractedText: "GRPO token budget",
          source: "ocr",
        },
      ],
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0].source).toBe("ocr");
    expect(attachments[0].extractedText).toContain("GRPO");
  });

  it("buildUserMessageContentForLlm 非 vision 模型将 OCR 文本拼入 user content", () => {
    const content = buildUserMessageContentForLlm(
      "请总结图片",
      [
        {
          name: "chart.png",
          mimeType: "image/png",
          previewUrl: "data:image/png;base64,abc",
          extractedText: "DeepSeek GRPO",
          source: "ocr",
        },
      ],
      false,
    );
    expect(typeof content).toBe("string");
    expect(content).toContain("[附件 · chart.png · OCR 识别]");
    expect(content).toContain("DeepSeek GRPO");
    expect(content).toContain("请总结图片");
  });

  it("buildLlmMessagesFromHistory 从持久化 user toolResults 回放 OCR 附件", () => {
    const messages = buildLlmMessagesFromHistory(
      "system",
      [
        {
          role: "user",
          content: "请总结图片",
          toolResults: {
            attachments: [
              {
                name: "chart.png",
                mimeType: "image/png",
                previewUrl: "data:image/png;base64,abc",
                extractedText: "GRPO",
                source: "ocr",
              },
            ],
          },
        },
      ],
      { modelId: "deepseek-chat" },
    );
    expect(messages).toHaveLength(2);
    expect(typeof messages[1].content).toBe("string");
    expect(messages[1].content).toContain("GRPO");
  });

  it("parseStoredToolCalls 识别 content kind（中间正式回复）", () => {
    const tools = parseStoredToolCalls([
      { id: "content_1", name: "__content__", args: { round: 1 }, result: "我将先搜索。", kind: "content" },
      { id: "call_1", name: "web_search", args: { query: "x" }, result: { ok: true } },
    ]);
    expect(tools[0].kind).toBe("content");
    expect(tools[1].kind).toBe("tool");
  });

  it("buildLlmMessagesFromHistory 跳过 content kind（不污染 ReAct 重建）", () => {
    // 中间正式回复进导轨展示，但重建 LLM messages 时必须跳过（与 thinking 同处理），
    // 否则会被当作 tool_call 拆成 assistant(content=null, tool_calls) 污染历史。
    const messages = buildLlmMessagesFromHistory("system", [
      { role: "user", content: "中间回复测试" },
      {
        role: "assistant",
        content: "最终回答",
        toolCalls: [
          { id: "content_1", name: "__content__", args: { round: 1 }, result: "我将先搜索。", kind: "content" },
          { id: "call_1", name: "web_search", args: { query: "x" }, result: { hits: 1 }, kind: "tool" },
        ],
      },
    ]);
    // 重建后：assistant(content=null, tool_calls=[web_search]) → tool → assistant(content=final)
    // content_1 不应出现为 tool_call
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(messages[2].tool_calls?.[0].id).toBe("call_1");
    expect(messages[2].tool_calls?.some((tc) => tc.id === "content_1")).toBe(false);
    expect(messages[4].content).toBe("最终回答");
  });
});
