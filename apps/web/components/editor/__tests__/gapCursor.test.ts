import { describe, expect, it } from "vitest";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/core";
import type { EditorView } from "@milkdown/prose/view";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { gfm } from "@milkdown/preset-gfm";
import { listener } from "@milkdown/plugin-listener";
import { math } from "@milkdown/plugin-math";
import { history } from "@milkdown/plugin-history";
import { commonmarkWithAbsoluteHeading } from "@/components/editor/headingLevelInputRule";
import {
  mathBlockEditableView,
  mathInlineEditableView,
} from "@/components/editor/mathBlockNodeView";
import { mathBlockAlignExtend } from "@/components/editor/mathBlockAlignSchema";
import { emptyCodeBlockDeleteKeymap } from "@/components/editor/emptyCodeBlockDelete";
import { editorSlash } from "@/components/editor/milkdownEditorSlash";
import { gapCursorKeymapPlugin, gapCursorPlugin } from "@/components/editor/gapCursor";
import { GapCursor } from "prosemirror-gapcursor";

function docToJSON(node: ProseNode) {
  return JSON.parse(JSON.stringify(node.toJSON()));
}

async function makeEditor(md: string) {
  const root = document.createElement("div");
  root.className = "milkdown-editor";
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, md);
    })
    .use(emptyCodeBlockDeleteKeymap)
    .use(commonmarkWithAbsoluteHeading())
    .use(gfm)
    .use(math)
    .use(mathBlockAlignExtend)
    .use(mathBlockEditableView)
    .use(mathInlineEditableView)
    .use(history)
    .use(gapCursorPlugin)
    .use(gapCursorKeymapPlugin)
    .use(listener)
    .use(editorSlash)
    .create();
  return { editor, root };
}

describe("gapCursor plugin", () => {
  it("Backspace at a gap cursor between list items does not delete the formula", async () => {
    const md = `* 德文哥特体：$\\mathfrak{g}, \\mathfrak{h}, \\mathfrak{p}, \\mathfrak{sl}_2$
* 粗体与正体：$\\mathbf{v}, \\mathbf{x}, \\mathrm{d}x, \\mathrm{e}^{ix}, \\mathsf{Var}(X)$`;
    const { editor } = await makeEditor(md);
    const view = editor.ctx.get(editorViewCtx) as EditorView;
    const before = docToJSON(view.state.doc);

    // Position between the two list items (end of first list_item, start of second)
    const gapPos = 70;
    const $gapPos = view.state.doc.resolve(gapPos);
    view.dispatch(view.state.tr.setSelection(new GapCursor($gapPos)));
    expect(view.state.selection instanceof GapCursor).toBe(true);

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    const handled = view.someProp("handleKeyDown", (f) => f(view, event));

    expect(handled).toBe(true);
    const after = docToJSON(view.state.doc);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(view.state.selection instanceof GapCursor).toBe(false);
  });

  it("Delete at a gap cursor between list items does not delete the formula", async () => {
    const md = `* 德文哥特体：$\\mathfrak{g}, \\mathfrak{h}, \\mathfrak{p}, \\mathfrak{sl}_2$
* 粗体与正体：$\\mathbf{v}, \\mathbf{x}, \\mathrm{d}x, \\mathrm{e}^{ix}, \\mathsf{Var}(X)$`;
    const { editor } = await makeEditor(md);
    const view = editor.ctx.get(editorViewCtx) as EditorView;
    const before = docToJSON(view.state.doc);
    const gapPos = 70;
    const $gapPos = view.state.doc.resolve(gapPos);
    view.dispatch(view.state.tr.setSelection(new GapCursor($gapPos)));

    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    const handled = view.someProp("handleKeyDown", (f) => f(view, event));
    expect(handled).toBe(true);
    const after = docToJSON(view.state.doc);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(view.state.selection instanceof GapCursor).toBe(false);
  });
});
