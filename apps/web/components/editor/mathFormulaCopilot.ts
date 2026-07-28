/**
 * 公式块 Copilot 桥：NodeView（非 React）↔ tRPC。
 * 创建空公式块后自动抽前后约 10 行上下文并请求补全。
 */

import { FORMULA_COPILOT_CONTEXT_LINES } from "@knowpilot/shared";
import type { EditorView } from "@milkdown/prose/view";

export type FormulaCopilotRequest = {
  before: string;
  after: string;
  partial?: string;
  title?: string;
  garden?: string;
  slug?: string;
  signal?: AbortSignal;
};

export type FormulaCopilotResponse = {
  latex: string;
};

export type FormulaCopilotFn = (
  req: FormulaCopilotRequest,
) => Promise<FormulaCopilotResponse | null>;

let copilotFn: FormulaCopilotFn | null = null;
let docMeta: { title?: string; garden?: string; slug?: string } = {};

export function registerFormulaCopilot(fn: FormulaCopilotFn | null) {
  copilotFn = fn;
}

export function setFormulaCopilotDocMeta(meta: {
  title?: string;
  garden?: string;
  slug?: string;
}) {
  docMeta = meta ?? {};
}

/** 从公式节点位置截取前后各 N 行纯文本 */
export function extractFormulaContext(
  view: EditorView,
  nodePos: number,
  lines = FORMULA_COPILOT_CONTEXT_LINES,
): { before: string; after: string } {
  const { doc } = view.state;
  const node = doc.nodeAt(nodePos);
  const afterPos = nodePos + (node?.nodeSize ?? 1);
  const textBefore = doc.textBetween(0, nodePos, "\n", "\n");
  const textAfter = doc.textBetween(afterPos, doc.content.size, "\n", "\n");
  const beforeLines = textBefore.split("\n");
  const afterLines = textAfter.split("\n");
  return {
    before: beforeLines.slice(-lines).join("\n"),
    after: afterLines.slice(0, lines).join("\n"),
  };
}

export async function requestFormulaCopilot(
  req: Omit<FormulaCopilotRequest, "title" | "garden" | "slug"> & {
    title?: string;
    garden?: string;
    slug?: string;
  },
): Promise<FormulaCopilotResponse | null> {
  if (!copilotFn) return null;
  return copilotFn({
    ...req,
    title: req.title ?? docMeta.title,
    garden: req.garden ?? docMeta.garden,
    slug: req.slug ?? docMeta.slug,
  });
}
