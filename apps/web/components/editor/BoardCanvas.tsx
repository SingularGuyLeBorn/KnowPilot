"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, Pen, RotateCcw, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EMPTY_BOARD_JSON } from "@/components/editor/editorSlashCommands";

export interface BoardStroke {
  color: string;
  width: number;
  points: number[];
}

export interface BoardDoc {
  v: 1;
  w: number;
  h: number;
  strokes: BoardStroke[];
}

export function parseBoardDoc(raw: string): BoardDoc {
  try {
    const data = JSON.parse(raw) as Partial<BoardDoc>;
    return {
      v: 1,
      w: typeof data.w === "number" ? data.w : 720,
      h: typeof data.h === "number" ? data.h : 360,
      strokes: Array.isArray(data.strokes) ? data.strokes.filter(isStroke) : [],
    };
  } catch {
    return JSON.parse(EMPTY_BOARD_JSON) as BoardDoc;
  }
}

function isStroke(s: unknown): s is BoardStroke {
  if (!s || typeof s !== "object") return false;
  const o = s as BoardStroke;
  return typeof o.color === "string" && typeof o.width === "number" && Array.isArray(o.points);
}

export function serializeBoardDoc(doc: BoardDoc): string {
  return JSON.stringify(doc);
}

function StrokePaths({ strokes }: { strokes: BoardStroke[] }) {
  return (
    <>
      {strokes.map((s, i) => {
        if (s.points.length < 4) return null;
        const d = s.points.reduce((acc, n, idx) => {
          if (idx % 2 === 0) {
            const y = s.points[idx + 1];
            return `${acc}${idx === 0 ? "M" : " L"}${n} ${y}`;
          }
          return acc;
        }, "");
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
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
        画板
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

/** 编辑态弹层：手绘笔 / 橡皮 / 撤销 / 清空 */
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
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const drawing = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

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

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toLocal(e.clientX, e.clientY);
    if (!p) return;
    drawing.current = true;
    if (tool === "eraser") {
      setDoc((prev) => ({
        ...prev,
        strokes: prev.strokes.filter((s) => !strokeNear(s, p.x, p.y, 14)),
      }));
      return;
    }
    setDoc((prev) => ({
      ...prev,
      strokes: [
        ...prev.strokes,
        { color: "currentColor", width: 2.5, points: [p.x, p.y] },
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
        strokes: prev.strokes.filter((s) => !strokeNear(s, p.x, p.y, 14)),
      }));
      return;
    }
    setDoc((prev) => {
      if (prev.strokes.length === 0) return prev;
      const strokes = prev.strokes.slice();
      const last = { ...strokes[strokes.length - 1]! };
      last.points = [...last.points, p.x, p.y];
      strokes[strokes.length - 1] = last;
      return { ...prev, strokes };
    });
  };

  const onPointerUp = () => {
    drawing.current = false;
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-label="画板编辑"
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] shadow-xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--kp-divider)] px-4 py-2.5">
          <p className="text-sm font-medium text-[var(--kp-text-1)]">画板</p>
          <div className="flex items-center gap-1">
            <ToolBtn active={tool === "pen"} onClick={() => setTool("pen")} title="画笔">
              <Pen className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn active={tool === "eraser"} onClick={() => setTool("eraser")} title="橡皮">
              <Eraser className="h-4 w-4" />
            </ToolBtn>
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
            className="block w-full touch-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] text-[var(--kp-text-1)]"
            style={{ aspectRatio: `${doc.w} / ${doc.h}`, cursor: tool === "eraser" ? "cell" : "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <rect width={doc.w} height={doc.h} fill="var(--kp-bg)" />
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
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    const dx = (s.points[i] ?? 0) - x;
    const dy = (s.points[i + 1] ?? 0) - y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}
