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

/** Milkdown 手绘标注全局刷新注册表：主滚动容器滚动时统一重绘所有标注 */
const annotationRefreshers = new Set<() => void>();
let mainScrollListenerAdded = false;
let scrollRefreshRaf: number | null = null;

function refreshAllAnnotations() {
  for (const refresh of annotationRefreshers) {
    try {
      refresh();
    } catch (e) {
      console.warn("[htmlMarkSchema] refresh annotation failed:", e);
    }
  }
}

function onMainScroll() {
  if (scrollRefreshRaf != null) return;
  scrollRefreshRaf = requestAnimationFrame(() => {
    scrollRefreshRaf = null;
    refreshAllAnnotations();
  });
}

function registerAnnotationRefresh(refresh: () => void) {
  annotationRefreshers.add(refresh);
  if (!mainScrollListenerAdded && typeof document !== "undefined") {
    mainScrollListenerAdded = true;
    const scroller = document.querySelector("[data-kp-main-scroll]");
    const target = scroller || window;
    target.addEventListener("scroll", onMainScroll, { passive: true });
  }
  return () => {
    annotationRefreshers.delete(refresh);
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
  const dom = document.createElement("span");
  dom.className = "kp-html-mark";
  dom.textContent = attrs.value;
  dom.dataset.type = "html_mark";
  dom.dataset.raw = attrs.raw;
  dom.dataset.annotation = attrs.annotation;
  if (attrs.color) dom.dataset.color = attrs.color;
  if (attrs.bracket) dom.dataset.bracket = attrs.bracket;
  dom.style.position = "relative";
  dom.style.display = "inline-block";
  dom.style.verticalAlign = "baseline";

  let annotation: ReturnType<typeof annotate> | null = null;
  let ro: ResizeObserver | null = null;
  let io: IntersectionObserver | null = null;

  const removeAnnotation = () => {
    annotation?.remove();
    annotation = null;
  };

  const applyAnnotation = () => {
    removeAnnotation();
    const type = VALID_TYPES.has(attrs.annotation) ? attrs.annotation : "underline";
    const color = attrs.color || DEFAULT_COLOR;
    annotation = annotate(dom, {
      type: type as RoughAnnotationType,
      color,
      strokeWidth: Number(attrs.strokeWidth) || 2,
      padding: Number(attrs.padding) || 4,
      iterations: Number(attrs.iterations) || 2,
      multiline: attrs.multiline !== false,
      animate: attrs.animate !== false,
      animationDuration: Number(attrs.animationDuration) || 800,
      ...(type === "bracket" && attrs.bracket ? { bracket: attrs.bracket } : {}),
    });
    annotation.show();
  };

  const show = () => {
    applyAnnotation();
  };

  const refresh = () => {
    if (annotation) {
      annotation.remove();
      annotation.show();
    }
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

  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => refresh());
    ro.observe(dom);
    if (document.body) ro.observe(document.body);
  }

  const unregisterScrollRefresh = registerAnnotationRefresh(refresh);

  return {
    dom,
    update(updated) {
      if (updated.type.name !== "html_mark") return false;
      const next = updated.attrs as MarkHtmlData;
      if (next.raw === attrs.raw) return true;
      dom.textContent = next.value;
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
    destroy() {
      removeAnnotation();
      ro?.disconnect();
      io?.disconnect();
      unregisterScrollRefresh();
    },
  };
}

export const htmlMarkView = $view(htmlMarkSchema, () => createHtmlMarkView);

