/**
 * ProseMirror GapCursor 包装：捕获块之间的 margin/gap 点击，
 * 避免用户点进“上一段末尾”后按 Backspace 误删公式/字符。
 */

import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { Selection } from "@milkdown/prose/state";
import { GapCursor, gapCursor } from "prosemirror-gapcursor";

const gapCursorKeymap = new Plugin({
  props: {
    handleKeyDown(view, event) {
      const sel = view.state.selection;
      if (!(sel instanceof GapCursor)) return false;
      const $pos = sel.$head;
      if (event.key === "Backspace") {
        const target = Selection.near($pos, -1);
        view.dispatch(view.state.tr.setSelection(target).scrollIntoView());
        return true;
      }
      if (event.key === "Delete") {
        const target = Selection.near($pos, 1);
        view.dispatch(view.state.tr.setSelection(target).scrollIntoView());
        return true;
      }
      return false;
    },
  },
});

export const gapCursorPlugin = $prose(() => gapCursor());
export const gapCursorKeymapPlugin = $prose(() => gapCursorKeymap);
