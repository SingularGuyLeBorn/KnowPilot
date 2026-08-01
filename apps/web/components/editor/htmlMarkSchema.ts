/**
 * Milkdown raw HTML `<mark>` 节点（编辑态）
 *
 * 仅支持 `<mark data-annotation="..." data-*="...">text</mark>`，
 * 用于让编辑态也能渲染 RoughAnnotation 手绘效果，避免阅读↔编辑跳变。
 * 其他 HTML 仍按 Milkdown 默认行为丢弃/显示为文本，避免脚本注入。
 */

import type { Node as ProseNode } from "@milkdown/prose/model";
import type { NodeView } from "@milkdown/prose/view";
import { $node } from "@milkdown/utils";
import { $view } from "@milkdown/utils";
import { annotate } from "rough-notation";
import type { RoughAnnotationType } from "@/components/post/RoughAnnotation";
import type { MarkHtmlData } from "./htmlMarkParser";
import { parseMarkHtml, serializeMarkHtml } from "./htmlMarkParser";

const DEFAULT_COLOR = "#e74c3c";

const VALID_TYPES = new Set<string>([
  "underline",
  "circle",
  "highlight",
  "box",
  "bracket",
  "crossed-off",
  "strike-through",
]);

/** 创建时动画配置（统一入口，避免散落默认值） */
function buildAnnotationConfig(attrs: MarkHtmlData) {
  const type = VALID_TYPES.has(attrs.annotation) ? attrs.annotation : "underline";
  const color = attrs.color || DEFAULT_COLOR;
  const bracketList = type === "bracket" && attrs.bracket
    ? attrs.bracket.split(/\s+/).filter((b) => ["left", "right", "top", "bottom"].includes(b))
    : [];
  return {
    type: type as RoughAnnotationType,
    color,
    strokeWidth: Number(attrs.strokeWidth) || 2,
    padding: Number(attrs.padding) || 2,
    iterations: Number(attrs.iterations) || 2,
    multiline: attrs.multiline !== false,
    animate: attrs.animate !== false,
    animationDuration: Number(attrs.animationDuration) || 800,
    ...(bracketList.length ? { brackets: bracketList as ("left" | "right" | "top" | "bottom")[] } : {}),
  };
}

export const htmlMarkSchema = $node("html_mark", () => ({
  content: "",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  attrs: {
    raw: { default: "" },
    value: { default: "" },
    annotation: { default: "underline" },
    color: { default: "" },
    strokeWidth: { default: 2 },
    padding: { default: 4 },
    iterations: { default: 2 },
    multiline: { default: true },
    animate: { default: true },
    animationDuration: { default: 800 },
    bracket: { default: "" },
  },
  parseDOM: [
    {
      tag: 'span[data-type="html_mark"]',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return false;
        const raw = dom.dataset.raw ?? "";
        const parsed = parseMarkHtml(raw);
        if (!parsed) return false;
        return parsed;
      },
    },
  ],
  toDOM: (node) => {
    const attrs = node.attrs as MarkHtmlData;
    return [
      "span",
      {
        "data-type": "html_mark",
        "data-raw": attrs.raw,
        "data-annotation": attrs.annotation,
        ...(attrs.color ? { "data-color": attrs.color } : {}),
        ...(attrs.bracket ? { "data-bracket": attrs.bracket } : {}),
        class: "kp-html-mark",
      },
      attrs.value,
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === "html_mark" && typeof node.value === "string",
    runner: (state, node, type) => {
      const raw = String(node.value ?? "");
      const parsed = parseMarkHtml(raw);
      if (parsed) {
        state.addNode(type, parsed);
      } else {
        // 解析失败：保留原始文本，避免内容丢失
        state.addText(raw);
      }
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html_mark",
    runner: (state, node) => {
      const raw = String(node.attrs.raw ?? "");
      state.addNode("html", undefined, raw || serializeMarkHtml(node.attrs as MarkHtmlData));
    },
  },
}));

function createHtmlMarkView(node: ProseNode): NodeView {
  const attrs = node.attrs as MarkHtmlData;

  // 外层 wrapper 是节点视图本身；内部文本 + SVG 手绘覆盖层都收在 wrapper 里，
  // 避免 rough-notation 把 SVG 插到 contenteditable 的节点视图外部，干扰 ProseMirror 的选区映射。
  const dom = document.createElement("span");
  dom.className = "kp-html-mark";
  dom.dataset.type = "html_mark";
  dom.dataset.raw = attrs.raw;
  dom.dataset.annotation = attrs.annotation;
  if (attrs.color) dom.dataset.color = attrs.color;
  if (attrs.bracket) dom.dataset.bracket = attrs.bracket;
  dom.style.position = "relative";
  dom.style.display = "inline-block";
  dom.style.verticalAlign = "baseline";

  const content = document.createElement("span");
  content.className = "kp-html-mark-content";
  content.textContent = attrs.value;
  content.style.display = "inline-block";
  dom.appendChild(content);

  let annotation: ReturnType<typeof annotate> | null = null;
  let ro: ResizeObserver | null = null;
  let io: IntersectionObserver | null = null;
  let roTimer: ReturnType<typeof setTimeout> | null = null;
  let lastParentRect: DOMRectReadOnly | null = null;

  const removeAnnotation = () => {
    annotation?.remove();
    annotation = null;
  };

  const applyAnnotation = () => {
    removeAnnotation();
    annotation = annotate(content, buildAnnotationConfig(attrs));
    annotation.show();
  };

  const show = () => {
    applyAnnotation();
  };

  // rough-notation 状态陷阱：remove() 会把状态置为 'unattached'，
  // 此时再调 show() 会直接 break 什么都不画。任何“刷新”都必须销毁对象并重建。
  const refresh = () => {
    applyAnnotation();
  };

  if (attrs.animate && typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            show();
            io?.disconnect();
            io = null;
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(dom);
  } else {
    show();
  }

  // 不观察 wrapper（含 SVG）避免插入/移除 SVG 触发 ResizeObserver → refresh 死循环；
  // 只观察 wrapper 父级段落，且只在尺寸变化超过 2px 并防抖 150ms 后才 refresh，
  // 避免鼠标 hover/微小布局抖动导致手绘层被 remove/show 反复重建而闪烁或消失。
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const rect = entry.contentRect;
      if (lastParentRect) {
        const dx = Math.abs(rect.width - lastParentRect.width);
        const dy = Math.abs(rect.height - lastParentRect.height);
        if (dx <= 2 && dy <= 2) return;
      }
      lastParentRect = rect;
      if (roTimer) clearTimeout(roTimer);
      roTimer = setTimeout(() => {
        roTimer = null;
        refresh();
      }, 150);
    });
    ro.observe(dom.parentElement ?? dom);
  }

  // SVG 已随 wrapper span（position: relative）插入 DOM 流，跟随滚动容器自然滚动；
  // 不需要额外监听 scroll，否则滚动时调用 rough-notation 的 remove/show 会触发状态陷阱。

  return {
    dom,
    update(updated) {
      if (updated.type.name !== "html_mark") return false;
      const next = updated.attrs as MarkHtmlData;
      if (next.raw === attrs.raw) return true;
      content.textContent = next.value;
      dom.dataset.raw = next.raw;
      dom.dataset.annotation = next.annotation;
      if (next.color) dom.dataset.color = next.color;
      else delete dom.dataset.color;
      if (next.bracket) dom.dataset.bracket = next.bracket;
      else delete dom.dataset.bracket;
      removeAnnotation();
      applyAnnotation();
      return true;
    },
    ignoreMutation: () => true,
    destroy() {
      removeAnnotation();
      if (roTimer) {
        clearTimeout(roTimer);
        roTimer = null;
      }
      ro?.disconnect();
      io?.disconnect();
    },
  };
}

export const htmlMarkView = $view(htmlMarkSchema, () => createHtmlMarkView);

