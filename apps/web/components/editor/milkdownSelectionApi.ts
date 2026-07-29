/**
 * Milkdown 选区读写：供 Canvas 式选区改写在 WYSIWYG 下替换选中内容。
 */

import { parserCtx } from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import { Slice } from "@milkdown/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";

let activeView: EditorView | null = null;
let editorCtx: Ctx | null = null;
let savedRange: { from: number; to: number } | null = null;

export type MilkdownSelectionSnapshot = {
  text: string;
  from: number;
  to: number;
};

export function getMilkdownSelection(): MilkdownSelectionSnapshot | null {
  const view = activeView;
  if (!view) return null;
  const { from, to } = view.state.selection;
  if (from === to) return null;
  const text = view.state.doc.textBetween(from, to, "\n\n");
  if (!text.trim()) return null;
  return { text, from, to };
}

/** 在打开浮层前冻结选区，避免点击按钮导致选区丢失 */
export function saveMilkdownSelectionRange(): MilkdownSelectionSnapshot | null {
  const snap = getMilkdownSelection();
  savedRange = snap ? { from: snap.from, to: snap.to } : null;
  return snap;
}

export function replaceMilkdownSelectionWithMarkdown(markdown: string): boolean {
  const view = activeView;
  const ctx = editorCtx;
  if (!view || !ctx) return false;

  const range = savedRange ?? {
    from: view.state.selection.from,
    to: view.state.selection.to,
  };
  if (range.from === range.to) return false;

  try {
    const parser = ctx.get(parserCtx);
    const parsed = parser(markdown.trim() || " ");
    // 单段 → 只替换 inline，避免在段落内嵌套新段落
    const slice =
      parsed.childCount === 1 && parsed.firstChild?.isTextblock
        ? new Slice(parsed.firstChild.content, 0, 0)
        : new Slice(parsed.content, 0, 0);

    const to = Math.min(range.to, view.state.doc.content.size);
    const from = Math.min(range.from, to);
    let tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to));
    tr = tr.replaceSelection(slice).scrollIntoView();
    view.dispatch(tr);
    view.focus();
    savedRange = null;
    return true;
  } catch (err) {
    console.error("[milkdownSelectionApi] replace failed", err);
    return false;
  }
}

export const milkdownSelectionApi = $prose((ctx) => {
  editorCtx = ctx;
  return new Plugin({
    key: new PluginKey("kp-milkdown-selection-api"),
    view(editorView) {
      activeView = editorView;
      return {
        destroy() {
          if (activeView === editorView) activeView = null;
          if (editorCtx === ctx) editorCtx = null;
          savedRange = null;
        },
      };
    },
  });
});
