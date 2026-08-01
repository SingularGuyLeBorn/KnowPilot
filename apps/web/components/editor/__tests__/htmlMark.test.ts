import { describe, expect, it } from "vitest";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from "@milkdown/core";
import type { EditorView } from "@milkdown/prose/view";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { Serializer } from "@milkdown/transformer";
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
import { htmlMarkSchema, htmlMarkView } from "@/components/editor/htmlMarkSchema";
import { htmlMarkRemark } from "@/components/editor/htmlMarkRemark";

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
    .use(htmlMarkSchema)
    .use(htmlMarkRemark)
    .use(htmlMarkView)
    .use(mathBlockEditableView)
    .use(mathInlineEditableView)
    .use(history)
    .use(listener)
    .use(editorSlash)
    .create();
  return { editor, root };
}

describe("htmlMark plugin", () => {
  it("parses raw <mark> into an html_mark node and preserves attributes", async () => {
    const md = `测试 <mark data-annotation="underline" data-color="#7d917f">莫兰迪鼠尾草绿</mark> 结束。`;
    const { editor } = await makeEditor(md);
    const view = editor.ctx.get(editorViewCtx) as EditorView;
    const json = docToJSON(view.state.doc);
    const paragraph = json.content[0];
    expect(paragraph.type).toBe("paragraph");
    const markNode = paragraph.content.find((n: { type: string }) => n.type === "html_mark");
    expect(markNode).toBeTruthy();
    expect(markNode.attrs.annotation).toBe("underline");
    expect(markNode.attrs.color).toBe("#7d917f");
    expect(markNode.attrs.value).toBe("莫兰迪鼠尾草绿");
  });

  it("renders DOM element with data attributes", async () => {
    const md = `测试 <mark data-annotation="box" data-color="#1f8a7a">青绿高亮框</mark> 结束。`;
    const { editor, root } = await makeEditor(md);
    const view = editor.ctx.get(editorViewCtx) as EditorView;
    expect(view).toBeTruthy();
    const span = root.querySelector('span[data-type="html_mark"]');
    expect(span).toBeTruthy();
    expect((span as HTMLElement).dataset.annotation).toBe("box");
    expect((span as HTMLElement).dataset.color).toBe("#1f8a7a");
    expect((span as HTMLElement).textContent).toBe("青绿高亮框");
  });

  it("serializes html_mark back to the original <mark> HTML", async () => {
    const md = `测试 <mark data-annotation="circle" data-color="#e74c3c">红色重点圈出</mark> 结束。`;
    const { editor } = await makeEditor(md);
    const view = editor.ctx.get(editorViewCtx) as EditorView;
    const serializer = editor.ctx.get(serializerCtx) as Serializer;
    const out = serializer(view.state.doc);
    expect(out).toContain('<mark data-annotation="circle" data-color="#e74c3c">红色重点圈出</mark>');
  });
});
