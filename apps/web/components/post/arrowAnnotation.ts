"use client";

/**
 * 手绘箭头标注（arrow）
 *
 * 在 <mark data-annotation="arrow" data-target="#id">label</mark> 上创建
 * 从 label 指向目标元素的粗糙箭头。SVG 画在全局 viewport 层，随滚动/resize
 * 持续更新坐标，保证箭头始终连在两端。
 *
 * 受 mdtask.dev 落地页启发，但自行实现：其仓库只开源 CLI，没有前端标注代码。
 */

import rough from "roughjs";

const ARROW_LAYER_ID = "kp-arrow-annotation-layer";
const ARROW_CLASS = "kp-arrow-annotation";

/** 查找/创建全局箭头 SVG 层（viewport 固定，不拦截鼠标） */
function getArrowLayer(): SVGSVGElement {
  let layer = document.getElementById(ARROW_LAYER_ID) as SVGSVGElement | null;
  if (layer) return layer;
  layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  layer.id = ARROW_LAYER_ID;
  const s = layer.style;
  s.position = "fixed";
  s.top = "0";
  s.left = "0";
  s.width = "100vw";
  s.height = "100vh";
  s.pointerEvents = "none";
  s.zIndex = "9999";
  s.overflow = "visible";
  document.body.appendChild(layer);
  return layer;
}

function ensureUniqueGroup(sourceEl: Element, targetSelector: string): SVGGElement {
  const layer = getArrowLayer();
  const id = `kp-arrow-${Array.from(sourceEl.textContent ?? "")
    .map((c) => c.charCodeAt(0))
    .join("-")}-${targetSelector}`;
  let group = layer.querySelector(`g[data-kp-arrow-id="${id}"]`) as SVGGElement | null;
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", ARROW_CLASS);
    group.setAttribute("data-kp-arrow-id", id);
    layer.appendChild(group);
  }
  group.innerHTML = "";
  return group;
}

function resolveAnchor(el: Element, anchor: string): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  switch (anchor) {
    case "top":
      return { x: rect.left + rect.width / 2, y: rect.top };
    case "bottom":
      return { x: rect.left + rect.width / 2, y: rect.bottom };
    case "left":
      return { x: rect.left, y: rect.top + rect.height / 2 };
    case "right":
      return { x: rect.right, y: rect.top + rect.height / 2 };
    case "top-left":
      return { x: rect.left, y: rect.top };
    case "top-right":
      return { x: rect.right, y: rect.top };
    case "bottom-left":
      return { x: rect.left, y: rect.bottom };
    case "bottom-right":
      return { x: rect.right, y: rect.bottom };
    case "center":
    default:
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
}

function findTarget(selector: string): Element | null {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function drawArrowHead(
  rc: ReturnType<typeof rough.svg>,
  group: SVGGElement,
  x: number,
  y: number,
  angle: number,
  color: string,
  strokeWidth: number,
) {
  const size = 10 + strokeWidth;
  const a1 = angle + Math.PI / 6;
  const a2 = angle - Math.PI / 6;
  const x1 = x - size * Math.cos(a1);
  const y1 = y - size * Math.sin(a1);
  const x2 = x - size * Math.cos(a2);
  const y2 = y - size * Math.sin(a2);
  group.appendChild(rc.line(x1, y1, x, y, { stroke: color, strokeWidth }));
  group.appendChild(rc.line(x2, y2, x, y, { stroke: color, strokeWidth }));
}

function drawArrow(
  sourceEl: Element,
  targetSelector: string,
  options: {
    color?: string;
    strokeWidth?: number;
    roughness?: number;
    sourceAnchor?: string;
    targetAnchor?: string;
  } = {},
) {
  const targetEl = findTarget(targetSelector);
  if (!targetEl) return null;

  const { color = "#3498db", strokeWidth = 2, roughness = 1.5, sourceAnchor = "right", targetAnchor = "center" } = options;

  const src = resolveAnchor(sourceEl, sourceAnchor);
  const tgt = resolveAnchor(targetEl, targetAnchor);

  const group = ensureUniqueGroup(sourceEl, targetSelector);
  const rc = rough.svg(group.closest("svg") as SVGSVGElement);

  // 曲线中点：向垂直方向偏移，让箭头有手绘弧度
  const mid = { x: (src.x + tgt.x) / 2, y: (src.y + tgt.y) / 2 };
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // 偏移量：取垂直于连线方向，让长线更自然
  const offset = Math.min(24, len * 0.15);
  const control = {
    x: mid.x - (dy / len) * offset,
    y: mid.y + (dx / len) * offset,
  };

  group.appendChild(
    rc.curve(
      [
        [src.x, src.y],
        [control.x, control.y],
        [tgt.x, tgt.y],
      ],
      { stroke: color, strokeWidth, roughness },
    ),
  );

  const angle = Math.atan2(tgt.y - control.y, tgt.x - control.x);
  drawArrowHead(rc, group, tgt.x, tgt.y, angle, color, strokeWidth);

  return group;
}

function removeArrow(sourceEl: Element, targetSelector: string) {
  const layer = document.getElementById(ARROW_LAYER_ID) as SVGSVGElement | null;
  if (!layer) return;
  const id = `kp-arrow-${Array.from(sourceEl.textContent ?? "")
    .map((c) => c.charCodeAt(0))
    .join("-")}-${targetSelector}`;
  const group = layer.querySelector(`g[data-kp-arrow-id="${id}"]`);
  if (group) group.remove();
  if (!layer.querySelector("g")) layer.remove();
}

/** 创建箭头并监听滚动/resize，返回销毁函数 */
export function createArrowAnnotation(
  sourceEl: Element,
  targetSelector: string,
  options?: {
    color?: string;
    strokeWidth?: number;
    roughness?: number;
    sourceAnchor?: string;
    targetAnchor?: string;
  },
): () => void {
  let raf: number | null = null;
  const refresh = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      drawArrow(sourceEl, targetSelector, options);
    });
  };

  const onScroll = () => refresh();
  const onResize = () => refresh();
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onResize);
  // 初始绘制
  refresh();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onResize);
    removeArrow(sourceEl, targetSelector);
  };
}

/** 更新箭头（用于 React 组件重新渲染时） */
export function updateArrowAnnotation(
  sourceEl: Element,
  targetSelector: string,
  options?: {
    color?: string;
    strokeWidth?: number;
    roughness?: number;
    sourceAnchor?: string;
    targetAnchor?: string;
  },
): void {
  drawArrow(sourceEl, targetSelector, options);
}

/** 销毁箭头 */
export function destroyArrowAnnotation(sourceEl: Element, targetSelector: string): void {
  removeArrow(sourceEl, targetSelector);
}
