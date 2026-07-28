/**
 * Milkdown WYSIWYG：飞书式 / 菜单（公式 /gs、代码 /code、表格 /tb、画板 /hb、标题…）。
 * 纯 DOM + slashFactory，不依赖 prosemirror-adapter。
 */

import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/core";
import { mathBlockSchema } from "@milkdown/plugin-math";
import { slashFactory, SlashProvider } from "@milkdown/plugin-slash";
import { codeBlockSchema, headingSchema } from "@milkdown/preset-commonmark";
import { createTable } from "@milkdown/preset-gfm";
import { NodeSelection, Selection, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

/** 斜杠命令可落在段落或标题里 */
function isSlashHostBlock(name: string) {
  return name === "paragraph" || name === "heading";
}
import {
  EMPTY_BOARD_JSON,
  filterSlashCommands,
  matchSlashToken,
  resolveExactSlashCommand,
  type EditorSlashCommand,
  type EditorSlashCommandId,
} from "@/components/editor/editorSlashCommands";

export const editorSlash = slashFactory("kpEditorSlash");

export type BoardInsertRequest = {
  /** 打开画板弹层；保存时用 raw 写回 code_block */
  onOpenBoard: (api: {
    /** 已有内容（重开编辑）；新建可省略 */
    initialRaw?: string;
    /** 新建未保存时取消应删掉占位块；重开编辑取消只关弹层 */
    isNew?: boolean;
    writeBoard: (raw: string) => void;
    removeBoard: () => void;
  }) => void;
};

function openBoardAt(
  ctx: Ctx,
  boardHook: BoardInsertRequest | undefined,
  nodePos: number,
  opts: { initialRaw?: string; isNew?: boolean },
) {
  if (!boardHook) return;
  boardHook.onOpenBoard({
    initialRaw: opts.initialRaw,
    isNew: opts.isNew,
    writeBoard: (raw: string) => {
      const v = ctx.get(editorViewCtx);
      const n = v.state.doc.nodeAt(nodePos);
      if (!n || n.type.name !== "code_block" || n.attrs.language !== "kp-board") {
        // 位置漂移：按 language 回落查找
        let pos = -1;
        v.state.doc.descendants((node, p) => {
          if (pos >= 0) return false;
          if (node.type.name === "code_block" && node.attrs.language === "kp-board") {
            pos = p;
            return false;
          }
          return true;
        });
        if (pos < 0) return;
        const found = v.state.doc.nodeAt(pos);
        if (!found) return;
        v.dispatch(v.state.tr.insertText(raw, pos + 1, pos + found.nodeSize - 1));
        return;
      }
      v.dispatch(v.state.tr.insertText(raw, nodePos + 1, nodePos + n.nodeSize - 1));
    },
    removeBoard: () => {
      const v = ctx.get(editorViewCtx);
      const n = v.state.doc.nodeAt(nodePos);
      if (!n || n.type.name !== "code_block") return;
      const paragraph = v.state.schema.nodes.paragraph;
      if (!paragraph) return;
      v.dispatch(v.state.tr.setBlockType(nodePos, nodePos + n.nodeSize, paragraph));
    },
  });
}

function getSlashRange(view: EditorView): { from: number; to: number; query: string } | null {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  const parentName = $from.parent.type.name;
  if (parentName !== "paragraph" && parentName !== "heading") return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const hit = matchSlashToken(textBefore);
  if (!hit) return null;
  return {
    from: $from.pos - hit.token.length,
    to: $from.pos,
    query: hit.query,
  };
}

function deleteRange(view: EditorView, from: number, to: number) {
  view.dispatch(view.state.tr.delete(from, to));
}

function insertMathBlock(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const range = getSlashRange(view);
  if (range) deleteRange(view, range.from, range.to);

  const type = mathBlockSchema.type(ctx);
  const { state } = view;
  const { $from } = state.selection;
  if (!isSlashHostBlock($from.parent.type.name)) {
    view.focus();
    return;
  }

  const emptyLine = $from.parent.textContent.trim() === "";
  let tr = state.tr;
  let nodePos = $from.before();
  if (emptyLine) {
    tr = tr.setBlockType(nodePos, $from.after(), type, { value: "", align: "center" });
  } else {
    nodePos = $from.after();
    tr = tr.insert(nodePos, type.create({ value: "", align: "center" }));
  }
  if (tr.doc.nodeAt(nodePos)?.type === type) {
    tr = tr.setSelection(NodeSelection.create(tr.doc, nodePos));
  }
  view.dispatch(tr);
  // 不抢 focus：NodeView 会把光标放进公式输入框
}

function insertCodeBlock(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const range = getSlashRange(view);
  if (range) deleteRange(view, range.from, range.to);

  const type = codeBlockSchema.type(ctx);
  const { state } = view;
  const { $from } = state.selection;
  if (!isSlashHostBlock($from.parent.type.name)) {
    view.focus();
    return;
  }

  const emptyLine = $from.parent.textContent.trim() === "";
  let tr = state.tr;
  let nodePos = $from.before();
  if (emptyLine) {
    tr = tr.setBlockType(nodePos, $from.after(), type, { language: "" });
  } else {
    nodePos = $from.after();
    tr = tr.insert(nodePos, type.create({ language: "" }));
  }

  const node = tr.doc.nodeAt(nodePos);
  if (node && node.type === type) {
    tr = tr.setSelection(TextSelection.create(tr.doc, nodePos + 1));
  }
  view.dispatch(tr);
  view.focus();
}

function insertBoardBlock(ctx: Ctx, boardHook?: BoardInsertRequest) {
  const view = ctx.get(editorViewCtx);
  const range = getSlashRange(view);
  if (range) deleteRange(view, range.from, range.to);

  const type = codeBlockSchema.type(ctx);
  const { state } = view;
  const { $from } = state.selection;
  if (!isSlashHostBlock($from.parent.type.name)) {
    view.focus();
    return;
  }

  const emptyLine = $from.parent.textContent.trim() === "";
  let tr = state.tr;
  let nodePos = $from.before();
  if (emptyLine) {
    tr = tr.setBlockType(nodePos, $from.after(), type, { language: "kp-board" });
  } else {
    nodePos = $from.after();
    tr = tr.insert(nodePos, type.create({ language: "kp-board" }, state.schema.text(EMPTY_BOARD_JSON)));
  }

  const node = tr.doc.nodeAt(nodePos);
  if (node && node.type === type) {
    if (emptyLine) {
      const from = nodePos + 1;
      const to = nodePos + node.nodeSize - 1;
      tr = tr.insertText(EMPTY_BOARD_JSON, from, to);
    }
    tr = tr.setSelection(NodeSelection.create(tr.doc, nodePos));
  }
  view.dispatch(tr);
  view.focus();
  openBoardAt(ctx, boardHook, nodePos, { initialRaw: EMPTY_BOARD_JSON, isNew: true });
}

function insertTable(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const range = getSlashRange(view);
  if (range) deleteRange(view, range.from, range.to);

  const { state } = view;
  const { $from } = state.selection;
  if (!isSlashHostBlock($from.parent.type.name)) {
    view.focus();
    return;
  }

  const from = state.selection.from;
  const table = createTable(ctx, 3, 3);
  const tr = state.tr.replaceSelectionWith(table);
  const sel = Selection.findFrom(tr.doc.resolve(Math.min(from, tr.doc.content.size)), 1, true);
  if (sel) tr.setSelection(sel);
  view.dispatch(tr);
  view.focus();
}

function setHeadingLevel(ctx: Ctx, level: number) {
  const view = ctx.get(editorViewCtx);
  const range = getSlashRange(view);
  if (range) deleteRange(view, range.from, range.to);

  const type = headingSchema.type(ctx);
  const { state } = view;
  const { $from } = state.selection;
  if (!isSlashHostBlock($from.parent.type.name)) {
    view.focus();
    return;
  }
  const tr = state.tr.setBlockType($from.before(), $from.after(), type, { level });
  view.dispatch(tr);
  view.focus();
}

function runCommand(ctx: Ctx, cmd: EditorSlashCommand, boardHook?: BoardInsertRequest) {
  switch (cmd.id) {
    case "math":
      insertMathBlock(ctx);
      break;
    case "code":
      insertCodeBlock(ctx);
      break;
    case "board":
      insertBoardBlock(ctx, boardHook);
      break;
    case "table":
      insertTable(ctx);
      break;
    case "h1":
      setHeadingLevel(ctx, 1);
      break;
    case "h2":
      setHeadingLevel(ctx, 2);
      break;
    case "h3":
      setHeadingLevel(ctx, 3);
      break;
    default:
      break;
  }
}

export function configureEditorSlash(ctx: Ctx, boardHook?: BoardInsertRequest) {
  const menu = document.createElement("div");
  menu.className = "kp-editor-slash";
  menu.setAttribute("data-show", "false");
  menu.tabIndex = -1;

  let selected = 0;
  let currentList: EditorSlashCommand[] = filterSlashCommands("");
  const providerBox: { current: SlashProvider | null } = { current: null };

  const render = () => {
    menu.innerHTML = "";
    if (currentList.length === 0) {
      const empty = document.createElement("div");
      empty.className = "kp-editor-slash-empty";
      empty.textContent = "无匹配命令";
      menu.appendChild(empty);
      return;
    }
    currentList.forEach((cmd, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kp-editor-slash-item";
      if (i === selected) btn.dataset.active = "true";
      btn.innerHTML = `<span class="kp-editor-slash-title">${cmd.title}</span><span class="kp-editor-slash-alias">/${cmd.alias}</span><span class="kp-editor-slash-desc">${cmd.description}</span>`;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        runCommand(ctx, cmd, boardHook);
        providerBox.current?.hide();
      });
      menu.appendChild(btn);
    });
  };

  const provider = new SlashProvider({
    content: menu,
    debounce: 20,
    offset: 8,
    shouldShow(view) {
      const range = getSlashRange(view);
      if (!range) return false;
      currentList = filterSlashCommands(range.query);
      if (selected >= currentList.length) selected = Math.max(0, currentList.length - 1);
      render();
      return true;
    },
  });
  providerBox.current = provider;

  ctx.set(editorSlash.key, {
    view: () => ({
      update: (view, prev) => provider.update(view, prev),
      destroy: () => {
        provider.destroy();
        menu.remove();
      },
    }),
    props: {
      // 双击已有画板 → 重新打开编辑（与公式点选编辑同类）
      handleDoubleClickOn(view, _pos, node, nodePos, event, direct) {
        if (!direct) return false;
        if (node.type.name !== "code_block" || node.attrs.language !== "kp-board") return false;
        event.preventDefault();
        openBoardAt(ctx, boardHook, nodePos, {
          initialRaw: node.textContent || EMPTY_BOARD_JSON,
          isNew: false,
        });
        return true;
      },
      handleKeyDown(view, event) {
        const range = getSlashRange(view);
        if (!range) return false;

        if (event.key === "ArrowDown") {
          event.preventDefault();
          selected = (selected + 1) % Math.max(currentList.length, 1);
          render();
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          selected =
            (selected - 1 + Math.max(currentList.length, 1)) % Math.max(currentList.length, 1);
          render();
          return true;
        }
        if (event.key === "Escape") {
          provider.hide();
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          const exact = resolveExactSlashCommand(range.query);
          const cmd = exact ?? currentList[selected] ?? null;
          if (!cmd) return false;
          event.preventDefault();
          runCommand(ctx, cmd, boardHook);
          provider.hide();
          return true;
        }
        return false;
      },
    },
  });
}

export type { EditorSlashCommandId };
