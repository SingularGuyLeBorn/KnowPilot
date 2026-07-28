/**
 * 阅读页划线解释 — 一次 sync LLM complete，不建会话、不写 ChatMessage、不跑工具。
 */

import { TRPCError } from "@trpc/server";
import { getAppConfig } from "./config.js";
import { resilientChatCompletion } from "./resilientLlmClient.js";

const EXPLAIN_TIMEOUT_MS = 45_000;
const MAX_TOKENS = 900;

const SYSTEM_PROMPT = `你是 KnowPilot 数字花园的阅读助手。用户在阅读 Markdown 文章时划选了一段文字，请用中文解释。

要求：
- 只解释划选内容及其在文中的含义；不要改写、扩写或「优化」原文
- 结合文章标题/花园语境；若上下文不足，如实说明假设
- 结构清晰：先一句话概括，再补充要点；公式用 LaTeX（$...$ / $$...$$）
- 不要输出「作为 AI」类套话；不要建议修改文章`;

export type ExplainPostSelectionInput = {
  quote: string;
  title: string;
  slug: string;
  garden: string;
  surrounding?: string;
};

export type ExplainPostSelectionResult = {
  explanation: string;
  model: string;
};

function buildUserPrompt(input: ExplainPostSelectionInput): string {
  const parts = [
    `文章：${input.title}`,
    `位置：${input.garden}/${input.slug}`,
    "",
    "【划选原文】",
    input.quote.trim(),
  ];
  if (input.surrounding?.trim()) {
    parts.push("", "【邻近上下文（供参考，勿整段复述）】", input.surrounding.trim());
  }
  parts.push("", "请解释划选内容。");
  return parts.join("\n");
}

export async function explainPostSelection(
  input: ExplainPostSelectionInput,
): Promise<ExplainPostSelectionResult> {
  const quote = input.quote.trim();
  if (!quote) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "划选内容为空" });
  }

  const config = getAppConfig();
  const model = config.llm.defaultModel;

  try {
    const { content } = await resilientChatCompletion({
      config,
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt({ ...input, quote }) },
      ],
      maxTokens: MAX_TOKENS,
      temperature: 0.3,
      enableReasoning: false,
      signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
    });

    const explanation = (content ?? "").trim();
    if (!explanation) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "模型未返回解释内容，请重试或换模型",
      });
    }
    return { explanation, model };
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `划线解释失败：${msg}`,
    });
  }
}

/** 单测用：暴露 prompt 拼装 */
export function __buildExplainUserPromptForTests(input: ExplainPostSelectionInput): string {
  return buildUserPrompt(input);
}
