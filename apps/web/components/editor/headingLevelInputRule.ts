/**
 * 标题级别按 # 数量绝对设置（飞书/语雀）：
 * 在一级标题里输入 `## ` → 变成二级，而不是 1+2=三级。
 */

import type { MilkdownPlugin } from "@milkdown/ctx";
import {
  commonmark,
  headingSchema,
  wrapInHeadingInputRule,
} from "@milkdown/preset-commonmark";
import { textblockTypeInputRule } from "@milkdown/prose/inputrules";
import { $inputRule } from "@milkdown/utils";

export const headingLevelReplaceInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^(#{1,6})\s$/, headingSchema.type(ctx), (match) => {
    const n = match[1]?.length ?? 1;
    return { level: Math.min(6, Math.max(1, n)) };
  }),
);

/** commonmark 去掉叠加标题规则，再挂绝对级别规则 */
export function commonmarkWithAbsoluteHeading(): MilkdownPlugin[] {
  const base = (commonmark as MilkdownPlugin[]).filter((p) => p !== wrapInHeadingInputRule);
  return [...base, headingLevelReplaceInputRule as unknown as MilkdownPlugin];
}
