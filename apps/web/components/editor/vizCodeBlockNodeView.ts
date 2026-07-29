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

function isVizLang(language: unknown): boolean {
  const lang = String(language ?? "")
    .trim()
    .toLowerCase();
  return lang === "viz" || lang === "algoviz";
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
      if (isVizLang(updated.attrs.language)) return false;
      pre.dataset.language = String(updated.attrs.language ?? "");
      return true;
    },
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
  return (node: ProseNode, _view: EditorView, _getPos: () => number | undefined): NodeView => {
    if (isVizLang(node.attrs.language)) return createVizBlockView(node);
    return createPlainCodeBlockView(node);
  };
});
