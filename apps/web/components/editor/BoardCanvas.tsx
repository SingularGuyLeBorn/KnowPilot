"use client";

/**
 * kp-board 手绘白板：perfect-freehand 真笔迹（压感 + 钢笔/荧光笔）+ 橡皮/撤销。
 * 数据落在 Markdown ```kp-board``` JSON；阅读态 BoardPreview 同款渲染。
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getStroke } from "perfect-freehand";
import { Eraser, Highlighter, Pen, RotateCcw, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EMPTY_BOARD_JSON } from "@/components/editor/editorSlashCommands";

export type BoardTool = "pen" | "highlighter" | "eraser";

export interface BoardStroke {
  color: string;
  /** perfect-freehand 基础尺寸 */
  size: number;
  /** [x, y, pressure, ...] */
  points: number[];
  tool?: "pen" | "highlighter";
}

export interface BoardDoc {
  v: 1 | 2;
  w: number;
  h: number;
  strokes: BoardStroke[];
}

const PEN_COLORS = [
  { id: "ink", label: "墨色", value: "#1c1917" },
  { id: "brand", label: "品牌", value: "var(--kp-brand-deep)" },
  { id: "red", label: "红", value: "#b91c1c" },
  { id: "blue", label: "蓝", value: "#1d4ed8" },
  { id: "green", label: "绿", value: "#15803d" },
] as const;

const HIGHLIGHTER_COLORS = [
  { id: "yellow", label: "黄", value: "rgba(250, 204, 21, 0.45)" },
  { id: "pink", label: "粉", value: "rgba(244, 114, 182, 0.4)" },
  { id: "mint", label: "薄荷", value: "rgba(52, 211, 153, 0.4)" },
] as const;

const SIZE_PRESETS = [
  { id: "s", label: "细", size: 4 },
  { id: "m", label: "中", size: 8 },
  { id: "l", label: "粗", size: 14 },
] as const;

function pointsToInput(points: number[]): number[][] {
  const out: number[][] = [];
  if (points.length >= 3 && points.length % 3 === 0) {
    for (let i = 0; i + 2 < points.length; i += 3) {
      out.push([points[i]!, points[i + 1]!, points[i + 2]!]);
    }
    return out;
  }
  // v1：[x,y,...]
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push([points[i]!, points[i + 1]!, 0.5]);
  }
  return out;
}

function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]!;
      acc.push(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
      return acc;
    },
    ["M", stroke[0]![0]!, stroke[0]![1]!, "Q"] as Array<string | number>,
  );
  d.push("Z");
  return d.join(" ");
}

function strokeToPathD(s: BoardStroke): string {
  const input = pointsToInput(s.points);
  if (input.length === 0) return "";
  const outline = getStroke(input, {
    size: s.size,
    thinning: s.tool === "highlighter" ? 0.2 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    easing: (t) => t,
    start: { taper: s.tool === "highlighter" ? 0 : 12, cap: true },
    end: { taper: s.tool === "highlighter" ? 0 : 12, cap: true },
  });
  return getSvgPathFromStroke(outline);
}

function isStroke(s: unknown): s is BoardStroke {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  const points = o.points;
  if (!Array.isArray(points) || points.length === 0) return false;
  if (!points.every((n) => typeof n === "number")) return false;
  const size =
    typeof o.size === "number" ? o.size : typeof o.width === "number" ? o.width : null;
  return typeof o.color === "string" && size != null && size > 0;
}

function normalizeStroke(s: BoardStroke & { width?: number }): BoardStroke {
  const size = typeof s.size === "number" ? s.size : (s.width ?? 2.5) * 2.2;
  let points = s.points;
  if (points.length % 3 !== 0 && points.length % 2 === 0) {
    const next: number[] = [];
    for (let i = 0; i + 1 < points.length; i += 2) {
      next.push(points[i]!, points[i + 1]!, 0.5);
    }
    points = next;
  }
  return {
    color: s.color === "currentColor" ? "#1c1917" : s.color,
    size,
    points,
    tool: s.tool === "highlighter" ? "highlighter" : "pen",
  };
}

export function parseBoardDoc(raw: string): BoardDoc {
  try {
    const data = JSON.parse(raw) as Partial<BoardDoc> & {
      strokes?: Array<BoardStroke & { width?: number }>;
    };
    return {
      v: 2,
      w: typeof data.w === "number" ? data.w : 960,
      h: typeof data.h === "number" ? data.h : 540,
      strokes: Array.isArray(data.strokes)
        ? data.strokes.filter(isStroke).map((s) => normalizeStroke(s))
        : [],
    };
  } catch {
    return JSON.parse(EMPTY_BOARD_JSON) as BoardDoc;
  }
}

export function serializeBoardDoc(doc: BoardDoc): string {
  return JSON.stringify({
    v: 2,
    w: doc.w,
    h: doc.h,
    strokes: doc.strokes.map((s) => ({
      color: s.color,
      size: s.size,
      points: s.points,
      tool: s.tool ?? "pen",
    })),
  });
}

function StrokePaths({ strokes }: { strokes: BoardStroke[] }) {
  return (
    <>
      {strokes.map((s, i) => {
        const d = strokeToPathD(s);
        if (!d) return null;
        return (
          <path
            key={i}
            d={d}
            fill={s.color}
            stroke="none"
            opacity={s.tool === "highlighter" ? 1 : 1}
          />
        );
      })}
    </>
  );
}

/** 阅读态：静态 SVG 画板 */
export function BoardPreview({ raw, className }: { raw: string; className?: string }) {
  const doc = parseBoardDoc(raw);
  return (
    <div
      className={cn(
        "my-4 overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-[var(--kp-divider)] px-3 py-1.5 text-xs text-[var(--kp-text-3)]">
        画板 · 手写
      </div>
      <svg
        viewBox={`0 0 ${doc.w} ${doc.h}`}
        className="block w-full bg-[var(--kp-bg)] text-[var(--kp-text-1)]"
        style={{ aspectRatio: `${doc.w} / ${doc.h}` }}
        role="img"
        aria-label="画板"
      >
        <rect width={doc.w} height={doc.h} fill="transparent" />
        <StrokePaths strokes={doc.strokes} />
      </svg>
    </div>
  );
}

interface BoardEditorModalProps {
  open: boolean;
  initialRaw?: string;
  onSave: (raw: string) => void;
  onCancel: () => void;
}

/** 编辑态弹层：钢笔 / 荧光笔 / 橡皮 / 撤销 / 清空 */
export function BoardEditorModal({ open, initialRaw, onSave, onCancel }: BoardEditorModalProps) {
  if (!open) return null;
  return (
    <BoardEditorModalBody
      key={initialRaw ?? "new-board"}
      initialRaw={initialRaw}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

function BoardEditorModalBody({
  initialRaw,
  onSave,
  onCancel,
}: Omit<BoardEditorModalProps, "open">) {
  const [doc, setDoc] = useState<BoardDoc>(() => parseBoardDoc(initialRaw ?? EMPTY_BOARD_JSON));
  const [tool, setTool] = useState<BoardTool>("pen");
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0].value);
  const [hiColor, setHiColor] = useState<string>(HIGHLIGHTER_COLORS[0].value);
  const [sizeId, setSizeId] = useState<(typeof SIZE_PRESETS)[number]["id"]>("m");
  const drawing = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const brushSize = SIZE_PRESETS.find((s) => s.id === sizeId)?.size ?? 8;

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const pressureOf = (e: ReactPointerEvent) => {
    // 鼠标无压感时给稳定值；触控笔用真实 pressure
    if (e.pointerType === "mouse" || e.pressure === 0) return 0.5;
    return Math.min(1, Math.max(0.08, e.pressure));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toLocal(e.clientX, e.clientY);
    if (!p) return;
    drawing.current = true;
    if (tool === "eraser") {
      setDoc((prev) => ({
        ...prev,
        strokes: prev.strokes.filter((s) => !strokeNear(s, p.x, p.y, brushSize + 10)),
      }));
      return;
    }
    const color = tool === "highlighter" ? hiColor : penColor;
    const size = tool === "highlighter" ? brushSize * 2.2 : brushSize;
    setDoc((prev) => ({
      ...prev,
      strokes: [
        ...prev.strokes,
        {
          color,
          size,
          tool: tool === "highlighter" ? "highlighter" : "pen",
          points: [p.x, p.y, pressureOf(e)],
        },
      ],
    }));
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drawing.current) return;
    const p = toLocal(e.clientX, e.clientY);
    if (!p) return;
    if (tool === "eraser") {
      setDoc((prev) => ({
        ...prev,
        strokes: prev.strokes.filter((s) => !strokeNear(s, p.x, p.y, brushSize + 10)),
      }));
      return;
    }
    setDoc((prev) => {
      if (prev.strokes.length === 0) return prev;
      const strokes = prev.strokes.slice();
      const last = { ...strokes[strokes.length - 1]! };
      const pts = last.points;
      const n = pts.length;
      if (n >= 3) {
        const lx = pts[n - 3]!;
        const ly = pts[n - 2]!;
        const dx = p.x - lx;
        const dy = p.y - ly;
        // 略疏采样，减轻 JSON 体积
        if (dx * dx + dy * dy < 1.2) return prev;
      }
      last.points = [...pts, p.x, p.y, pressureOf(e)];
      strokes[strokes.length - 1] = last;
      return { ...prev, strokes };
    });
  };

  const onPointerUp = () => {
    drawing.current = false;
  };

  const colors = tool === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const activeColor = tool === "highlighter" ? hiColor : penColor;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-label="画板编辑"
        className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] shadow-xl"
        data-testid="board-editor-modal"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--kp-divider)] px-4 py-2.5">
          <div>
            <p className="text-sm font-medium text-[var(--kp-text-1)]">画板 · 手写</p>
            <p className="text-[10px] text-[var(--kp-text-3)]">
              支持触控笔压感 · 编辑器输入 /hb 插入
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <ToolBtn active={tool === "pen"} onClick={() => setTool("pen")} title="钢笔">
              <Pen className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              active={tool === "highlighter"}
              onClick={() => setTool("highlighter")}
              title="荧光笔"
            >
              <Highlighter className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn active={tool === "eraser"} onClick={() => setTool("eraser")} title="橡皮">
              <Eraser className="h-4 w-4" />
            </ToolBtn>
            <span className="mx-1 h-5 w-px bg-[var(--kp-divider)]" />
            {SIZE_PRESETS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.label}
                onClick={() => setSizeId(s.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px]",
                  sizeId === s.id
                    ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                    : "text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]",
                )}
              >
                {s.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-[var(--kp-divider)]" />
            {tool !== "eraser" &&
              colors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  onClick={() =>
                    tool === "highlighter" ? setHiColor(c.value) : setPenColor(c.value)
                  }
                  className={cn(
                    "h-6 w-6 rounded-full border-2",
                    activeColor === c.value
                      ? "border-[var(--kp-brand-deep)]"
                      : "border-transparent",
                  )}
                  style={{
                    background:
                      c.value.startsWith("var(") || c.value.startsWith("rgba")
                        ? c.value
                        : c.value,
                  }}
                />
              ))}
            <span className="mx-1 h-5 w-px bg-[var(--kp-divider)]" />
            <ToolBtn
              onClick={() =>
                setDoc((prev) => ({
                  ...prev,
                  strokes: prev.strokes.slice(0, -1),
                }))
              }
              title="撤销"
            >
              <RotateCcw className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn onClick={() => setDoc((prev) => ({ ...prev, strokes: [] }))} title="清空">
              <Trash2 className="h-4 w-4" />
            </ToolBtn>
          </div>
        </div>
        <div className="bg-[var(--kp-bg-mute)] p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${doc.w} ${doc.h}`}
            className="block w-full touch-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]"
            style={{
              aspectRatio: `${doc.w} / ${doc.h}`,
              cursor: tool === "eraser" ? "cell" : "crosshair",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            data-testid="board-canvas"
          >
            <rect width={doc.w} height={doc.h} fill="var(--kp-bg)" />
            {/* 淡网格，方便对齐手写 */}
            <defs>
              <pattern id="kp-board-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M 24 0 L 0 0 0 24"
                  fill="none"
                  stroke="var(--kp-divider)"
                  strokeWidth="0.5"
                  opacity="0.55"
                />
              </pattern>
            </defs>
            <rect width={doc.w} height={doc.h} fill="url(#kp-board-grid)" />
            <StrokePaths strokes={doc.strokes} />
          </svg>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--kp-divider)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
          >
            <X className="h-4 w-4" />
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(serializeBoardDoc(doc))}
            className={cn(buttonVariants({ size: "sm" }), "gap-1")}
            data-testid="board-save"
          >
            <Check className="h-4 w-4" />
            插入画板
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--kp-text-2)] transition",
        active
          ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
          : "hover:bg-[var(--kp-bg-mute)]",
      )}
    >
      {children}
    </button>
  );
}

function strokeNear(s: BoardStroke, x: number, y: number, r: number): boolean {
  const input = pointsToInput(s.points);
  for (const [px, py] of input) {
    const dx = (px ?? 0) - x;
    const dy = (py ?? 0) - y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}
