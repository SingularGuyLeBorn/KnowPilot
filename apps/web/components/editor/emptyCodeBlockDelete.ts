/**
 * 安全块级与空行删除：防止 Backspace / Delete 误删上一行公式或大块文本。
 */

import { Plugin, Selection } from "@milkdown/prose/state";
import type { EditorState, Transaction } from "@milkdown/prose/state";
import { $prose } from "@milkdown/utils";

/** 纯函数：是否应删除当前空节点（供单测） */
export function shouldDeleteEmptyBlock(
  parentTypeName: string,
  textContent: string,
): boolean {
  if (parentTypeName === "code_block" || parentTypeName === "math_display") {
    return textContent.trim().length === 0;
  }
  if (parentTypeName === "paragraph") {
    return textContent.trim().length === 0;
  }
  return false;
}

export function tryDeleteEmptyBlock(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  const parent = $from.parent;

  // 1. 如果当前处于空段落 (empty paragraph) 或空代码/公式块
  if (shouldDeleteEmptyBlock(parent.type.name, parent.textContent)) {
    const from = $from.before($from.depth);
    const to = $from.after($from.depth);
    // 防御：如果是整个文档唯一的节点，不删除
    if (from === 0 && to === state.doc.content.size) {
      return false;
    }
    if (dispatch) {
      dispatch(state.tr.delete(from, to).scrollIntoView());
    }
    return true;
  }

  // 2. 如果光标在段落最前 ($from.parentOffset === 0)，前面紧邻公式/块级 Node
  if ($from.parentOffset === 0 && $from.depth >= 1) {
    const index = $from.index($from.depth - 1);
    if (index > 0) {
      const prevNode = $from.node($from.depth - 1).child(index - 1);
      // 若前一个节点是公式块、代码块或自定义手绘块，且当前段落不为空
      if (
        prevNode &&
        (prevNode.type.name === "math_display" ||
          prevNode.type.name === "code_block" ||
          prevNode.type.name === "kp_board" ||
          prevNode.isAtom)
      ) {
        // 只将光标移动到前一个节点末尾/之前，绝对不删除前一个节点
        const prevPos = $from.before($from.depth) - 1;
        if (dispatch) {
          const nearPos = state.doc.resolve(Math.max(0, prevPos));
          const Sel = state.selection.constructor as typeof Selection;
          dispatch(state.tr.setSelection(Sel.near(nearPos, -1)));
        }
        return true;
      }
    }
  }

  return false;
}

export const emptyCodeBlockDeleteKeymap = $prose(() =>
  new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key === "Backspace" || event.key === "Delete") {
          const handled = tryDeleteEmptyBlock(view.state, view.dispatch);
          if (handled) return true;
        }
        return false;
      },
    },
  })
);
