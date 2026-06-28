/**
 * 对话上下文自动压缩 — 长对话在 Agent 循环前摘要旧消息
 */

import type { AppConfig } from "./config.js";
import { chatCompletion, type LlmMessage } from "./llmClient.js";

/** 粗略字符阈值（约 12k tokens） */
const COMPACT_CHAR_THRESHOLD = 48_000;
/** 保留最近 N 条消息不压缩 */
const KEEP_RECENT_MESSAGES = 8;

function estimateChars(messages: LlmMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.content?.length ?? 0) + 200, 0);
}

export async function maybeCompactMessages(
  config: AppConfig,
  messages: LlmMessage[],
  model: string,
): Promise<{ messages: LlmMessage[]; compacted: boolean }> {
  if (estimateChars(messages) < COMPACT_CHAR_THRESHOLD) {
    return { messages, compacted: false };
  }

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= KEEP_RECENT_MESSAGES + 2) {
    return { messages, compacted: false };
  }

  const toSummarize = rest.slice(0, -KEEP_RECENT_MESSAGES);
  const recent = rest.slice(-KEEP_RECENT_MESSAGES);

  const transcript = toSummarize
    .map((m) => {
      const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : m.role;
      const text = (m.content ?? "").slice(0, 2000);
      return `[${role}]\n${text}`;
    })
    .join("\n\n---\n\n");

  try {
    const summary = await chatCompletion({
      config,
      model,
      messages: [
        {
          role: "system",
          content:
            "你是 KnowPilot 对话摘要助手。将以下历史对话压缩为简洁的中文摘要，保留：用户目标、已做决策、工具结果要点、未完成任务。不要编造。",
        },
        { role: "user", content: `请摘要以下对话历史：\n\n${transcript.slice(0, 32000)}` },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });

    const summaryText = summary.content?.trim();
    if (!summaryText) return { messages, compacted: false };

    const compactedMessages: LlmMessage[] = [
      ...system,
      {
        role: "user",
        content: `[此前对话摘要 — 自动压缩]\n${summaryText}`,
      },
      {
        role: "assistant",
        content: "已阅读摘要，继续基于上述上下文协助你。",
      },
      ...recent,
    ];

    console.log(
      `[AutoCompact] ${toSummarize.length} 条消息已压缩为摘要（原 ${estimateChars(messages)} → ${estimateChars(compactedMessages)} 字符）`,
    );
    return { messages: compactedMessages, compacted: true };
  } catch (err) {
    console.warn("[AutoCompact] 压缩失败，使用原始历史:", err instanceof Error ? err.message : err);
    return { messages, compacted: false };
  }
}
