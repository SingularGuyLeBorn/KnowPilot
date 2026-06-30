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
});
