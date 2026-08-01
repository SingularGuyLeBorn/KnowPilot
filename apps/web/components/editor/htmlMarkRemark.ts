/**
 * remark 预处理：把 commonmark 拆成三段的 raw <mark> 标签重新合并成单个 html_mark 节点，
 * 方便 Milkdown 的 html_mark schema 一次识别整个 <mark>...</mark>。
 */

import { $remark } from "@milkdown/utils";

type MarkdownNode = {
  type?: string;
  value?: unknown;
  children?: MarkdownNode[];
};

function isOpenMark(node: MarkdownNode): { value: string } | false {
  if (node?.type !== "html") return false;
  const value = String(node.value ?? "");
  if (!/^<mark\b/i.test(value)) return false;
  // 已经自包含的 <mark>...</mark> 不需要合并
  if (/<\/mark>/i.test(value)) return false;
  return { value };
}

function isCloseMark(node: MarkdownNode): boolean {
  return node?.type === "html" && /^<\/mark\s*>/i.test(String(node.value ?? ""));
}

function mergeMarkChildren(node: MarkdownNode) {
  if (!node?.children || !Array.isArray(node.children)) return;
  const out: MarkdownNode[] = [];
  let i = 0;
  while (i < node.children.length) {
    const cur = node.children[i];
    const open = isOpenMark(cur);
    if (open && i + 2 < node.children.length) {
      const middle = node.children[i + 1];
      const close = node.children[i + 2];
      if (isCloseMark(close) && middle?.type === "text") {
        out.push({
          type: "html_mark",
          value: `${open.value}${String(middle.value ?? "")}${String(close.value ?? "")}`,
        });
        i += 3;
        continue;
      }
    }
    out.push(cur);
    if (cur?.children) mergeMarkChildren(cur);
    i++;
  }
  node.children = out;
}

export const htmlMarkRemark = $remark("htmlMarkMerge", () => () => {
  return (tree: MarkdownNode) => {
    mergeMarkChildren(tree);
  };
});
