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

/** 当前光标所在块的纯文本 + 文档前后文（供润稿 / @agent 默认段落上下文） */
export function getMilkdownParagraphContext(): {
  paragraph: string;
  before: string;
  after: string;
  selected?: string;
} | null {
  const view = activeView;
  if (!view) return null;
  const { from, to } = view.state.selection;
  const $from = view.state.selection.$from;
  const blockStart = $from.start();
  const blockEnd = $from.end();
  const paragraph = view.state.doc.textBetween(blockStart, blockEnd, "\n").trim();
  const before = view.state.doc.textBetween(0, from, "\n\n", "\n");
  const after = view.state.doc.textBetween(to, view.state.doc.content.size, "\n\n", "\n");
  const selected =
    from !== to ? view.state.doc.textBetween(from, to, "\n\n").trim() || undefined : undefined;
  return { paragraph, before, after, selected };
}

/** 冻结当前块（段落/标题）整段，供「润色当前段」替换 */
export function saveMilkdownBlockRange(): boolean {
  const view = activeView;
  if (!view) return false;
  const $from = view.state.selection.$from;
  savedRange = { from: $from.start(), to: $from.end() };
  return true;
}

/** 在打开浮层前冻结选区/光标，避免点击按钮导致选区丢失 */
export function saveMilkdownSelectionRange(): MilkdownSelectionSnapshot | null {
  const view = activeView;
  if (!view) {
    savedRange = null;
    return null;
  }
  const { from, to } = view.state.selection;
  // 无选区也保存光标，供「插入到光标处」
  savedRange = { from, to };
  if (from === to) return null;
  const text = view.state.doc.textBetween(from, to, "\n\n");
  if (!text.trim()) return null;
  return { text, from, to };
}

function applyMarkdownAtRange(
  markdown: string,
  range: { from: number; to: number },
): boolean {
  const view = activeView;
  const ctx = editorCtx;
  if (!view || !ctx) return false;

  try {
    const parser = ctx.get(parserCtx);
    const parsed = parser(markdown.trim() || " ");
    // 单段 → 只替换/插入 inline，避免在段落内嵌套新段落
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
    console.error("[milkdownSelectionApi] apply markdown failed", err);
    return false;
  }
}

/** 有选区则替换；无选区则在光标处插入 */
export function replaceMilkdownSelectionWithMarkdown(markdown: string): boolean {
  const view = activeView;
  if (!view) return false;
  const range = savedRange ?? {
    from: view.state.selection.from,
    to: view.state.selection.to,
  };
  return applyMarkdownAtRange(markdown, range);
}

/** 在当前/已保存光标处插入 Markdown（无选区也可） */
export function insertMilkdownMarkdownAtCursor(markdown: string): boolean {
  const view = activeView;
  if (!view) return false;
  const pos = savedRange?.from ?? view.state.selection.from;
  return applyMarkdownAtRange(markdown, { from: pos, to: pos });
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
