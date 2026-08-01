"use client";

/**
 * RoughAnnotation — 手写风格标注组件（基于 rough-notation）
 *
 * 在 Markdown 中用 <mark> 标签触发手写标注：
 *   <mark data-annotation="underline" data-color="#e74c3c">重点文字</mark>
 *   <mark data-annotation="circle">圈起来</mark>
 *   <mark data-annotation="highlight" data-color="#fef08a">高亮</mark>
 *   <mark data-annotation="box">框住</mark>
 *   <mark data-annotation="bracket">括号</mark>
 *   <mark data-annotation="crossed-off">删掉</mark>
 *   <mark data-annotation="strike-through">划掉</mark>
 *
 * 支持的 data- 属性：
 *   data-annotation: 标注类型（underline|circle|highlight|box|bracket|crossed-off|strike-through）
 *   data-color: 标注颜色（默认 #e74c3c）
 *   data-stroke-width: 笔画宽度（默认 2）
 *   data-padding: 内边距（默认 4）
 *   data-iterations: 手绘迭代次数，越多越「手画」（默认 2）
 *   data-multiline: 是否支持多行标注（默认 true）
 *   data-animate: 是否动画（默认 true）
 *   data-animation-duration: 动画时长 ms（默认 800）
 *
 * 当元素滚入可视区后自动触发手绘动画。
 */

import { useEffect, useRef, type ReactNode } from "react";
import { annotate } from "rough-notation";

export type RoughAnnotationType =
  | "underline"
  | "circle"
  | "highlight"
  | "box"
  | "bracket"
  | "crossed-off"
  | "strike-through";

const VALID_TYPES = new Set<string>([
  "underline",
  "circle",
  "highlight",
  "box",
  "bracket",
  "crossed-off",
  "strike-through",
]);

/**
 * 默认颜色映射：不同标注类型用不同默认色（用户可通过 data-color 覆盖）
 */
const DEFAULT_COLORS: Record<string, string> = {
  underline: "#e74c3c",
  circle: "#3498db",
  highlight: "#fef08a",
  box: "#2ecc71",
  bracket: "#9b59b6",
  "crossed-off": "#e74c3c",
  "strike-through": "#e74c3c",
};

const VALID_BRACKETS = new Set<string>(["left", "right", "top", "bottom"]);

function normalizeBrackets(
  bracket?: "left" | "right" | "top" | "bottom" | ("left" | "right" | "top" | "bottom")[],
): RoughAnnotationType extends never ? never : ("left" | "right" | "top" | "bottom")[] | undefined {
  if (!bracket) return undefined;
  const list = Array.isArray(bracket) ? bracket : String(bracket).split(/\s+/);
  const valid = list.filter((b) => VALID_BRACKETS.has(b)) as ("left" | "right" | "top" | "bottom")[];
  return valid.length ? valid : undefined;
}

export interface RoughAnnotationProps {
  type: string;
  color?: string;
  strokeWidth?: number;
  padding?: number;
  iterations?: number;
  multiline?: boolean;
  animate?: boolean;
  animationDuration?: number;
  bracket?: "left" | "right" | "top" | "bottom" | ("left" | "right" | "top" | "bottom")[];
  children: ReactNode;
  className?: string;
}

export function RoughAnnotation({
  type,
  color,
  strokeWidth = 2,
  padding = 2,
  iterations = 2,
  multiline = true,
  animate = true,
  animationDuration = 800,
  bracket,
  children,
  className,
}: RoughAnnotationProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const annotationRef = useRef<ReturnType<typeof annotate> | null>(null);

  const resolvedType: RoughAnnotationType = VALID_TYPES.has(type)
    ? (type as RoughAnnotationType)
    : "underline";

  const resolvedColor = color || DEFAULT_COLORS[resolvedType] || "#e74c3c";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let ann = annotate(el, {
      type: resolvedType,
      color: resolvedColor,
      strokeWidth,
      padding,
      iterations,
      multiline,
      animate,
      animationDuration,
      ...(bracket ? { brackets: normalizeBrackets(bracket) } : {}),
    });
    annotationRef.current = ann;

    const safeShow = () => {
      requestAnimationFrame(() => {
        ann.show();
      });
    };

    // rough-notation 状态陷阱：remove() 会把状态置为 'unattached'，
    // 此时 show() 什么都不做。任何刷新都必须销毁对象并重建。
    const refresh = () => {
      ann.remove();
      annotationRef.current = ann = annotate(el, {
        type: resolvedType,
        color: resolvedColor,
        strokeWidth,
        padding,
        iterations,
        multiline,
        animate,
        animationDuration,
        ...(bracket ? { brackets: normalizeBrackets(bracket) } : {}),
      });
      ann.show();
    };

    // 观察元素自身的尺寸变化（如 KaTeX 渲染 / 表格布局下推时更新手绘坐标）
    const ro = new ResizeObserver(() => refresh());
    ro.observe(el);
    window.addEventListener("resize", refresh);

    // IntersectionObserver：滚入视口时触发动画
    if (animate) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              safeShow();
              observer.disconnect();
            }
          }
        },
        { threshold: 0.2 },
      );
      observer.observe(el);
      return () => {
        observer.disconnect();
        ro.disconnect();
        window.removeEventListener("resize", refresh);
        ann.remove();
      };
    } else {
      safeShow();
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", refresh);
        ann.remove();
      };
    }
  }, [
    resolvedType,
    resolvedColor,
    strokeWidth,
    padding,
    iterations,
    multiline,
    animate,
    animationDuration,
    bracket,
  ]);

  return (
    <span
      ref={ref}
      className={className}
      style={{ position: "relative", display: "inline-block", verticalAlign: "baseline" }}
    >
      {children}
    </span>
  );
}
