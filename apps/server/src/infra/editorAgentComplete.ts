/**
 * 编辑器 @Agent 补全 — 一次 sync LLM，注入 Agent systemPrompt + Markdown 格式约束。
 * 不建会话、不跑工具；由前端 Accept 后写入正文。
 * 另：公式块 Copilot（前后文 → 纯 LaTeX 幽灵补全）。
 */

import { TRPCError } from "@trpc/server";
import { DEFAULT_LLM_MODEL } from "@knowpilot/shared";
import type { ServiceContainer } from "./serviceContainer.js";
import { getAppConfig } from "./config.js";
import { resilientChatCompletion } from "./resilientLlmClient.js";
import { resolveAgent } from "./agentResolver.js";

const COMPLETE_TIMEOUT_MS = 90_000;
const MAX_TOKENS = 4096;
const CTX_SLICE = 4000;

const FORMAT_RULES = `【输出格式铁律】
- 只输出将插入文稿的 Markdown 正文片段，不要包代码围栏包裹全文，不要前言后语
- 不要输出「好的」「如下」等寒暄；不要解释你做了什么
- 列表/标题层级与邻近上下文风格一致
- 不要修改或重复光标前后已有原文（除非用户明确要求改写选区）
- 若指令含糊，做最小合理补全，勿长篇跑题

【可直接生成的结构（按用户意图选用）】
- 公式：行内 $E=mc^2$；独立块用 $$ 独占一行围住 LaTeX（可含 align/cases/matrix）
- 表格：GitHub 风格 Markdown 表（| 列 | … | + 分隔行）
- 图表/示意图：优先 \`\`\`svg 或 \`\`\`html 完整可渲染代码（前端可预览）；勿只给无法渲染的 ASCII 草图
- 流程/架构示意：用 SVG/HTML；手绘白板请提示用户用编辑器 /hb，勿伪造 kp-board JSON
- 代码块：标明语言；数学专用块也可用 $$，不要用 \`\`\`math 除非用户明确要求`;

export type EditorAgentCompleteArgs = {
  agentId: string;
  instruction: string;
  before?: string;
  after?: string;
  selected?: string;
  title?: string;
  garden?: string;
  slug?: string;
  model?: string;
};

export type EditorAgentCompleteResult = {
  content: string;
  model: string;
  agentId: string;
  agentName: string;
};

function sliceCtx(s: string, fromEnd: boolean): string {
  const t = s ?? "";
  if (t.length <= CTX_SLICE) return t;
  return fromEnd ? t.slice(-CTX_SLICE) : t.slice(0, CTX_SLICE);
}

function buildUserPrompt(input: EditorAgentCompleteArgs): string {
  const parts: string[] = [];
  if (input.title || input.garden || input.slug) {
    parts.push(
      `文章元信息：${[input.title && `标题=${input.title}`, input.garden && `花园=${input.garden}`, input.slug && `slug=${input.slug}`]
        .filter(Boolean)
        .join(" · ")}`,
    );
    parts.push("");
  }
  parts.push("【光标前上下文】");
  parts.push(sliceCtx(input.before ?? "", true) || "（文首）");
  parts.push("");
  if (input.selected?.trim()) {
    parts.push("【当前选区（将被替换）】");
    parts.push(input.selected.trim());
    parts.push("");
  }
  parts.push("【光标后上下文】");
  parts.push(sliceCtx(input.after ?? "", false) || "（文末）");
  parts.push("");
  parts.push("【用户指令】");
  parts.push(input.instruction.trim());
  parts.push("");
  parts.push("请直接输出要插入/替换的 Markdown 片段。");
  return parts.join("\n");
}

export async function completeEditorWithAgent(
  services: ServiceContainer,
  input: EditorAgentCompleteArgs,
): Promise<EditorAgentCompleteResult> {
  const instruction = input.instruction.trim();
  if (!instruction) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "指令不能为空" });
  }

  const agent = await services.agent.getById(input.agentId);
  if (agent.status === "deleted") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Agent「${agent.name}」已删除` });
  }

  const config = getAppConfig();
  const model = (input.model?.trim() || DEFAULT_LLM_MODEL).trim();
  const systemParts = [
    typeof agent.systemPrompt === "string" && agent.systemPrompt.trim()
      ? agent.systemPrompt.trim()
      : `你是 KnowPilot 数字花园中的 Agent「${agent.name}」，协助用户撰写 Markdown 文章。`,
    "",
    FORMAT_RULES,
  ];

  try {
    const { content } = await resilientChatCompletion({
      config,
      model,
      messages: [
        { role: "system", content: systemParts.join("\n") },
        { role: "user", content: buildUserPrompt(input) },
      ],
      maxTokens: MAX_TOKENS,
      temperature: 0.4,
      enableReasoning: false,
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });

    let text = (content ?? "").trim();
    // 剥掉模型偶发的整篇 ```markdown 围栏
    const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
    if (fenced) text = fenced[1]!.trim();
    if (!text) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "模型未返回内容，请重试或换 Agent/模型",
      });
    }

    return {
      content: text,
      model,
      agentId: agent.id,
      agentName: agent.name,
    };
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Agent 补全失败：${msg}`,
    });
  }
}

export function __buildEditorCompleteUserPromptForTests(input: EditorAgentCompleteArgs): string {
  return buildUserPrompt(input);
}

const FORMULA_COPILOT_SYSTEM = `你是 Markdown 编辑器里的公式 Copilot。
根据文章上下文，为当前位置的公式块生成一条最贴切的 LaTeX。
【铁律】
- 只输出 LaTeX 公式本体（可多行，如 begin{align}…end{align}）
- 禁止输出 $$、\\[ \\]、markdown、解释、寒暄、代码围栏
- 贴合前后文主题；上下文不足时给该小节最可能需要的核心公式
- 若用户已输入 partial，在其基础上续写/补全，不要另起无关公式`;

export type FormulaCopilotArgs = {
  before?: string;
  after?: string;
  partial?: string;
  title?: string;
  garden?: string;
  slug?: string;
  model?: string;
};

export type FormulaCopilotResult = {
  latex: string;
  model: string;
  agentId: string;
};

/** 剥掉模型偶发的 $$ / \\[ \\] / 围栏 */
export function stripFormulaCopilotLatex(raw: string): string {
  let t = (raw ?? "").trim();
  const fenced = t.match(/^```(?:latex|tex|math)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) t = fenced[1]!.trim();
  t = t.replace(/^\$\$\s*/, "").replace(/\s*\$\$$/, "");
  t = t.replace(/^\\\[\s*/, "").replace(/\s*\\\]$/, "");
  t = t.replace(/^\$\s*/, "").replace(/\s*\$$/, "");
  return t.trim();
}

export async function completeFormulaCopilot(
  services: ServiceContainer,
  input: FormulaCopilotArgs,
): Promise<FormulaCopilotResult> {
  const { agent } = await resolveAgent(services);
  if (agent.status === "deleted") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Agent「${agent.name}」已删除` });
  }

  const config = getAppConfig();
  const model = (input.model?.trim() || DEFAULT_LLM_MODEL).trim();
  const partial = input.partial?.trim() ?? "";

  const userParts = [
    input.title || input.garden || input.slug
      ? `文章：${[input.title && `标题=${input.title}`, input.garden && `花园=${input.garden}`, input.slug && `slug=${input.slug}`].filter(Boolean).join(" · ")}`
      : "",
    "【公式前上下文（约 10 行）】",
    (input.before ?? "").trim() || "（文首）",
    "",
    "【公式后上下文（约 10 行）】",
    (input.after ?? "").trim() || "（文末）",
    "",
    partial ? `【用户已输入】\n${partial}\n` : "【用户已输入】\n（空，请直接给出完整公式）\n",
    "请只输出 LaTeX 公式本体。",
  ].filter((x, i, arr) => x !== "" || (i > 0 && arr[i - 1] !== ""));

  try {
    const { content } = await resilientChatCompletion({
      config,
      model,
      messages: [
        { role: "system", content: FORMULA_COPILOT_SYSTEM },
        { role: "user", content: userParts.join("\n") },
      ],
      maxTokens: 1024,
      temperature: 0.3,
      enableReasoning: false,
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });

    const latex = stripFormulaCopilotLatex(content ?? "");
    if (!latex) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "模型未返回公式，请重试",
      });
    }
    return { latex, model, agentId: agent.id };
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `公式补全失败：${msg}`,
    });
  }
}
