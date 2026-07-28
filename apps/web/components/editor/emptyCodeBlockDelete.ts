/**
 * 代码块删除：内容清空后 Backspace / Delete 删掉整块（与公式块一致）。
 */

import { keymap } from "@milkdown/prose/keymap";
import type { EditorState, Transaction } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

/** 纯函数：是否应删除当前空 code_block（供单测） */
export function shouldDeleteEmptyCodeBlock(
  parentTypeName: string,
  textContent: string,
): boolean {
  return parentTypeName === "code_block" && textContent.trim().length === 0;
}

function tryDeleteEmptyCodeBlock(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  const parent = $from.parent;
  if (!shouldDeleteEmptyCodeBlock(parent.type.name, parent.textContent)) {
    return false;
  }
  const from = $from.before($from.depth);
  const to = $from.after($from.depth);
  if (dispatch) {
    dispatch(state.tr.delete(from, to).scrollIntoView());
  }
  return true;
}

export const emptyCodeBlockDeleteKeymap = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => tryDeleteEmptyCodeBlock(state, dispatch),
    Delete: (state, dispatch) => tryDeleteEmptyCodeBlock(state, dispatch),
  }),
);
