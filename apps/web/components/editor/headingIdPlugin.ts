import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { Node as ProseNode } from "@milkdown/prose/model";

const headingIdPluginKey = new PluginKey("kp-heading-ids");

function buildHeadingIdDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  let index = 0;
  doc.descendants((node: ProseNode, pos: number) => {
    if (node.type.name === "heading") {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { id: `kp-h-${index}` }));
      index += 1;
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * 为 WYSIWYG 预览中的标题节点加上 id="kp-h-${index}"，与 TableOfContents 生成的 id 保持一致。
 * 这样切换到 Milkdown 作为唯一渲染面后，目录跳转和阅读进度恢复仍然可用。
 */
export const headingIdPlugin = $prose(() => {
  return new Plugin({
    key: headingIdPluginKey,
    state: {
      init: (config) => buildHeadingIdDecorations(config.doc!),
      apply: (tr, set) => {
        if (!tr.docChanged) return set.map(tr.mapping, tr.doc);
        return buildHeadingIdDecorations(tr.doc);
      },
    },
    props: {
      decorations: (state) => headingIdPluginKey.getState(state),
    },
  });
});
