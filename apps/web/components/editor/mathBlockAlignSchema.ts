/**
 * 扩展 milkdown math_block：attrs.align + Markdown 往返（% kp-align）。
 */

import { mathBlockSchema } from "@milkdown/plugin-math";
import {
  normalizeMathAlign,
  parseMathBlockPayload,
  serializeMathBlockPayload,
  type MathBlockAlign,
} from "@/components/editor/mathBlockAlign";

export const mathBlockAlignExtend = mathBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const base = prev(ctx);
    return {
      ...base,
      attrs: {
        ...base.attrs,
        align: { default: "center" as MathBlockAlign },
      },
      parseDOM: [
        {
          tag: 'div[data-type="math_block"]',
          preserveWhitespace: "full" as const,
          getAttrs: (dom) => {
            if (!(dom instanceof HTMLElement)) return false;
            const fromData = normalizeMathAlign(dom.dataset.align);
            const parsed = parseMathBlockPayload(dom.dataset.value ?? "");
            return {
              value: parsed.value,
              align: dom.dataset.align ? fromData : parsed.align,
            };
          },
        },
      ],
      parseMarkdown: {
        match: ({ type }) => type === "math",
        runner: (state, node, type) => {
          const { value, align } = parseMathBlockPayload(String(node.value ?? ""));
          state.addNode(type, { value, align });
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === "math_block",
        runner: (state, node) => {
          const align = normalizeMathAlign(node.attrs.align);
          const value = String(node.attrs.value ?? "");
          state.addNode("math", undefined, serializeMathBlockPayload(value, align));
        },
      },
    };
  };
});
