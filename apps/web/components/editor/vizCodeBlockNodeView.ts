/**
 * Milkdown code_block NodeView：language=viz|algoviz 时挂载 Remotion VizEmbed，
 * 否则保持可编辑的普通代码块（pre>code）。
 */

import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";
import { codeBlockSchema } from "@milkdown/preset-commonmark";
import { $view } from "@milkdown/utils";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VizEmbed } from "@/components/post/VizEmbed";
import { BoardPreview } from "@/components/editor/BoardCanvas";

function isVizLang(language: unknown): boolean {
  const lang = String(language ?? "")
    .trim()
    .toLowerCase();
  return lang === "viz" || lang === "algoviz";
}

function isBoardLang(language: unknown): boolean {
  const lang = String(language ?? "")
    .trim()
    .toLowerCase();
  return lang === "kp-board" || lang === "board";
}

function createPlainCodeBlockView(node: ProseNode): NodeView {
  const pre = document.createElement("pre");
  pre.dataset.language = String(node.attrs.language ?? "");
  const code = document.createElement("code");
  pre.appendChild(code);
  return {
    dom: pre,
    contentDOM: code,
    update(updated) {
      if (updated.type.name !== "code_block") return false;
      if (isVizLang(updated.attrs.language) || isBoardLang(updated.attrs.language)) return false;
      pre.dataset.language = String(updated.attrs.language ?? "");
      return true;
    },
  };
}

function createBoardBlockView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("div");
  dom.className = "kp-board-block not-prose";
  dom.contentEditable = "false";
  dom.dataset.language = String(node.attrs.language ?? "kp-board");

  const mount = document.createElement("div");
  dom.appendChild(mount);

  let root: Root | null = createRoot(mount);
  const handleEdit = (newRaw: string) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const newNode = node.type.create(node.attrs, view.state.schema.text(newRaw));
    view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, newNode));
  };

  const paint = (n: ProseNode) => {
    root?.render(
      createElement(BoardPreview, {
        raw: n.textContent ?? "",
        onEdit: handleEdit,
      }),
    );
  };
  paint(node);

  return {
    dom,
    update(updated) {
      if (updated.type.name !== "code_block") return false;
      if (!isBoardLang(updated.attrs.language)) return false;
      paint(updated);
      return true;
    },
    destroy() {
      const r = root;
      root = null;
      queueMicrotask(() => {
        r?.unmount();
      });
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
}

function createVizBlockView(node: ProseNode): NodeView {
  const dom = document.createElement("div");
  dom.className = "kp-viz-block not-prose";
  dom.contentEditable = "false";
  dom.dataset.language = String(node.attrs.language ?? "viz");

  const mount = document.createElement("div");
  dom.appendChild(mount);

  let root: Root | null = createRoot(mount);
  const paint = (n: ProseNode) => {
    root?.render(createElement(VizEmbed, { raw: n.textContent ?? "" }));
  };
  paint(node);

  return {
    dom,
    update(updated) {
      if (updated.type.name !== "code_block") return false;
      if (!isVizLang(updated.attrs.language)) return false;
      paint(updated);
      return true;
    },
    destroy() {
      const r = root;
      root = null;
      // React 18+：勿在 PM destroy 同步栈里 unmount
      queueMicrotask(() => {
        r?.unmount();
      });
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
    selectNode() {
      dom.classList.add("kp-viz-block--selected");
    },
    deselectNode() {
      dom.classList.remove("kp-viz-block--selected");
    },
  };
}

export const vizCodeBlockView = $view(codeBlockSchema.node, () => {
  return (node: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView => {
    if (isVizLang(node.attrs.language)) return createVizBlockView(node);
    if (isBoardLang(node.attrs.language)) return createBoardBlockView(node, view, getPos);
    return createPlainCodeBlockView(node);
  };
});
