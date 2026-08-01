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

export interface RoughAnnotationProps {
  type: string;
  color?: string;
  strokeWidth?: number;
  padding?: number;
  iterations?: number;
  multiline?: boolean;
  animate?: boolean;
  animationDuration?: number;
  children: ReactNode;
  className?: string;
}

export function RoughAnnotation({
  type,
  color,
  strokeWidth = 2,
  padding = 4,
  iterations = 2,
  multiline = true,
  animate = true,
  animationDuration = 800,
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

    const ann = annotate(el, {
      type: resolvedType,
      color: resolvedColor,
      strokeWidth,
      padding,
      iterations,
      multiline,
      animate,
      animationDuration,
    });

    annotationRef.current = ann;

    // IntersectionObserver：滚入视口时触发动画
    if (animate) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              ann.show();
              observer.disconnect();
            }
          }
        },
        { threshold: 0.3 },
      );
      observer.observe(el);
      return () => {
        observer.disconnect();
        ann.remove();
      };
    } else {
      ann.show();
      return () => {
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
  ]);

  return (
    <span ref={ref} className={className} style={{ display: "inline" }}>
      {children}
    </span>
  );
}
