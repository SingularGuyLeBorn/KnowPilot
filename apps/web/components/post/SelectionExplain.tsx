"use client";

/**
 * 阅读页划线解释：选中正文 → 「解释」按钮 → 只读弹层（不写回文章、不建 Chat 会话）。
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { PostContent } from "@/components/post/PostContent";

const EXCLUDED_SELECTORS =
  "pre, code, .katex, .katex-display, .kp-page-search-mark, .kp-selection-explain, script, style, noscript, button, a, input, textarea";

const PANEL_WIDTH = 360;
const BTN_GAP = 8;

type AnchorPos = { top: number; left: number; placeAbove: boolean };

export interface SelectionExplainProps {
  containerRef: RefObject<HTMLElement | null>;
  title: string;
  slug: string;
  garden: string;
}

function selectionInside(container: HTMLElement, sel: Selection): boolean {
  if (sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el || !container.contains(el)) return false;
  if (el.closest(EXCLUDED_SELECTORS)) return false;
  return true;
}

function readSurrounding(range: Range): string | undefined {
  const node = range.commonAncestorContainer;
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  const block = el?.closest("p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, .kp-md-p");
  const text = (block?.textContent || el?.textContent || "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 8) return undefined;
  return text.slice(0, 1500);
}

export function SelectionExplain({
  containerRef,
  title,
  slug,
  garden,
}: SelectionExplainProps) {
  const panelId = useId();
  const [quote, setQuote] = useState("");
  const [surrounding, setSurrounding] = useState<string | undefined>();
  const [btnPos, setBtnPos] = useState<AnchorPos | null>(null);
  const [panelPos, setPanelPos] = useState<AnchorPos | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rangeRectRef = useRef<DOMRect | null>(null);

  const explainMut = trpc.post.explainSelection.useMutation();

  const clearUi = useCallback(() => {
    setBtnPos(null);
    setPanelOpen(false);
    setPanelPos(null);
    setQuote("");
    setSurrounding(undefined);
    setExplanation(null);
    setError(null);
    rangeRectRef.current = null;
  }, []);

  const placeNearRect = useCallback((rect: DOMRect, width: number): AnchorPos => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, vw - width - 12));
    const below = rect.bottom + BTN_GAP;
    const placeAbove = below + 48 > vh && rect.top > 80;
    const top = placeAbove ? rect.top - BTN_GAP : below;
    return { top, left, placeAbove };
  }, []);

  const syncFromSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container || panelOpen) return;
    const sel = window.getSelection();
    if (!sel || !selectionInside(container, sel)) {
      if (!panelOpen) setBtnPos(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > 2000) {
      setBtnPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setBtnPos(null);
      return;
    }
    rangeRectRef.current = rect;
    setQuote(text);
    setSurrounding(readSurrounding(range));
    setBtnPos(placeNearRect(rect, 88));
  }, [containerRef, panelOpen, placeNearRect]);

  useEffect(() => {
    const onMouseUp = () => {
      // 等浏览器完成选区
      window.setTimeout(() => syncFromSelection(), 0);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearUi();
        return;
      }
      if (e.shiftKey) window.setTimeout(() => syncFromSelection(), 0);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [syncFromSelection, clearUi]);

  useEffect(() => {
    if (!btnPos && !panelOpen) return;
    const onScroll = () => {
      if (panelOpen) return;
      setBtnPos(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [btnPos, panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      clearUi();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panelOpen, clearUi]);

  const runExplain = () => {
    if (!quote.trim() || explainMut.isPending) return;
    const rect = rangeRectRef.current;
    if (rect) setPanelPos(placeNearRect(rect, PANEL_WIDTH));
    else if (btnPos) setPanelPos({ ...btnPos, left: Math.max(12, btnPos.left - 120) });
    setPanelOpen(true);
    setBtnPos(null);
    setExplanation(null);
    setError(null);
    explainMut
      .mutateAsync({
        quote,
        title,
        slug,
        garden,
        surrounding,
      })
      .then((res) => {
        setExplanation(res.explanation);
      })
      .catch((err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "解释失败";
        setError(msg);
      });
  };

  const btnStyle: CSSProperties | undefined = btnPos
    ? {
        position: "fixed",
        top: btnPos.top,
        left: btnPos.left,
        zIndex: 70,
        transform: btnPos.placeAbove ? "translateY(-100%)" : undefined,
      }
    : undefined;

  const panelStyle: CSSProperties | undefined = panelPos
    ? {
        position: "fixed",
        top: panelPos.top,
        left: panelPos.left,
        width: PANEL_WIDTH,
        maxHeight: "min(60vh, 420px)",
        zIndex: 80,
        transform: panelPos.placeAbove ? "translateY(-100%)" : undefined,
      }
    : undefined;

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {btnPos && !panelOpen && (
        <button
          ref={btnRef}
          type="button"
          style={btnStyle}
          onMouseDown={(e) => e.preventDefault()}
          onClick={runExplain}
          className={cn(
            "kp-selection-explain inline-flex items-center gap-1 rounded-full border border-[var(--kp-divider)]",
            "bg-[var(--kp-bg)] px-2.5 py-1 text-xs font-medium text-[var(--kp-brand-deep)] shadow-md",
            "transition hover:border-[var(--kp-brand)]/50 hover:bg-[var(--kp-brand-soft)]/50",
          )}
          data-testid="selection-explain-btn"
        >
          <Sparkles className="h-3.5 w-3.5" />
          解释
        </button>
      )}

      {panelOpen && panelPos && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="划线解释"
          style={panelStyle}
          className={cn(
            "kp-selection-explain flex flex-col overflow-hidden rounded-xl border border-[var(--kp-divider)]",
            "bg-[var(--kp-bg)] shadow-xl",
          )}
          data-testid="selection-explain-panel"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--kp-divider-light)] px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" />
              <span className="truncate text-xs font-semibold text-[var(--kp-text-1)]">划线解释</span>
            </div>
            <button
              type="button"
              onClick={clearUi}
              className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
              aria-label="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="shrink-0 border-b border-[var(--kp-divider-light)] px-3 py-2">
            <p className="line-clamp-3 text-[11px] leading-relaxed text-[var(--kp-text-3)]">
              「{quote}」
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            {explainMut.isPending && (
              <div className="flex items-center gap-2 py-6 text-xs text-[var(--kp-text-3)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在解释…
              </div>
            )}
            {error && !explainMut.isPending && (
              <p className="text-xs text-red-600" data-testid="selection-explain-error">
                {error}
              </p>
            )}
            {explanation && !explainMut.isPending && (
              <PostContent
                content={explanation}
                className="prose-sm max-w-none text-left text-[var(--kp-text-1)] [&_p]:my-1.5"
              />
            )}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
