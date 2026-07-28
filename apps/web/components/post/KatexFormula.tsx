"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseMathBlockPayload } from "@/components/editor/mathBlockAlign";

const InsideKatexFormulaContext = createContext(false);

export function useInsideKatexFormula(): boolean {
  return useContext(InsideKatexFormulaContext);
}

function extractTex(root: HTMLElement | null): string {
  if (!root) return "";
  const ann = root.querySelector('annotation[encoding="application/x-tex"]');
  const fromAnn = ann?.textContent?.trim();
  if (fromAnn) return fromAnn;
  const labeled = root.querySelector(".katex-html[aria-label], [aria-label]");
  return labeled?.getAttribute("aria-label")?.trim() || "";
}

function wrapDisplayDelimiters(tex: string): string {
  const t = tex.trim();
  if (!t) return t;
  if (t.startsWith("$$") || t.startsWith("\\[")) return t;
  return `$$\n${t}\n$$`;
}

function wrapInlineDelimiters(tex: string): string {
  const t = tex.trim();
  if (!t) return t;
  if (t.startsWith("$") || t.startsWith("\\(")) return t;
  return `$${t}$`;
}

/** 去掉会污染布局的 KaTeX 根 class，避免 overflow 滚动条 / 整行占宽 */
function sanitizeFormulaClassName(className?: string): string | undefined {
  if (!className) return undefined;
  const kept = className
    .split(/\s+/)
    .filter(
      (t) =>
        t &&
        t !== "katex" &&
        t !== "katex-display" &&
        t !== "math-inline" &&
        t !== "math-display" &&
        t !== "language-math" &&
        t !== "math",
    );
  return kept.length ? kept.join(" ") : undefined;
}

/**
 * rehype-katex 替换后的根：span.katex / span.katex-display
 */
export function isKatexRootClassName(
  className?: string | readonly string[] | null,
): {
  root: boolean;
  display: boolean;
} {
  const raw = Array.isArray(className)
    ? className.join(" ")
    : typeof className === "string"
      ? className
      : "";
  if (!raw) return { root: false, display: false };
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.includes("katex-display")) return { root: true, display: true };
  if (parts.includes("katex")) return { root: true, display: false };
  if (
    parts.includes("math-display") ||
    parts.includes("language-math") ||
    parts.includes("math-inline") ||
    parts.includes("math")
  ) {
    return {
      root: true,
      display: parts.includes("math-display") || parts.includes("language-math"),
    };
  }
  return { root: false, display: false };
}

interface KatexFormulaProps {
  children?: ReactNode;
  className?: string;
  display?: boolean;
}

/**
 * 可交互公式：
 * - 外壳永远用 span（避免 p > div hydration）
 * - 源码面板 portal 到 body，定位在公式正下方
 */
export function KatexFormula({ children, className, display = false }: KatexFormulaProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tex, setTex] = useState("");
  const [copied, setCopied] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const refreshTex = useCallback(() => {
    const next = extractTex(triggerRef.current);
    setTex(next);
    return next;
  }, []);

  // 块级公式：从 LaTeX 源里读 `% kp-align: left`，直接改 class（避免 setState 级联）
  useLayoutEffect(() => {
    if (!display || !rootRef.current) return;
    const src = extractTex(triggerRef.current);
    const { align } = parseMathBlockPayload(src);
    rootRef.current.classList.toggle("kp-katex-align-left", align === "left");
  }, [display, children]);

  const placePanel = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const maxW = Math.min(420, window.innerWidth - margin * 2);
    // 宽度跟内容走，略宽于公式即可；左对齐贴在公式下方，不居中
    const width = Math.min(maxW, Math.max(display ? 260 : 200, Math.min(Math.max(r.width, 200), maxW)));
    let left = r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = r.bottom + 6;
    const panelH = panelRef.current?.offsetHeight ?? 128;
    if (top + panelH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - panelH - 6);
    }
    setPanelStyle({
      position: "fixed",
      top,
      left,
      width,
      zIndex: 80,
    });
  }, [display]);

  const toggle = useCallback(() => {
    const next = refreshTex();
    if (!next) return;
    setOpen((v) => {
      const willOpen = !v;
      if (willOpen) {
        // 下一帧量位置
        requestAnimationFrame(() => placePanel());
      }
      return willOpen;
    });
    setCopied(false);
  }, [placePanel, refreshTex]);

  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
    const onReposition = () => placePanel();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, placePanel, tex]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleCopy = async () => {
    const source = tex || refreshTex();
    if (!source) return;
    const payload = display ? wrapDisplayDelimiters(source) : wrapInlineDelimiters(source);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const onKeyActivate = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  const shown = display ? wrapDisplayDelimiters(tex) : wrapInlineDelimiters(tex);
  const safeClass = sanitizeFormulaClassName(className);

  const panel =
    open && tex && mounted
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            className="kp-katex-source"
            style={panelStyle}
            role="dialog"
            aria-label="LaTeX 源码"
          >
            <div className="kp-katex-source-head">
              <span className="kp-katex-source-badge">LaTeX</span>
              <div className="kp-katex-source-actions">
                <button
                  type="button"
                  className="kp-katex-source-btn"
                  onClick={handleCopy}
                  title={copied ? "已复制" : "复制源码"}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? "已复制" : "复制"}</span>
                </button>
                <button
                  type="button"
                  className="kp-katex-source-btn"
                  onClick={() => setOpen(false)}
                  title="关闭"
                  aria-label="关闭"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <pre className="kp-katex-source-code">
              <code>{shown}</code>
            </pre>
          </div>,
          document.body,
        )
      : null;

  return (
    <InsideKatexFormulaContext.Provider value={true}>
      {/* 永远用 span，禁止 p>div / p>pre；源码走 portal */}
      <span
        ref={rootRef}
        className={cn(
          "kp-katex-formula",
          display ? "kp-katex-formula--display" : "kp-katex-formula--inline",
          open && "is-open",
          safeClass,
        )}
      >
        <span
          ref={triggerRef}
          className="kp-katex-formula-trigger"
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={onKeyActivate}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          title={open ? "收起 LaTeX" : "查看 LaTeX 源码"}
        >
          {/*
            外壳剥掉后再还原：display 必须全宽，否则 \tag{n} 会叠在公式上。
            display 根的 children 已是 .katex，只还原外层；inline 根需还原 .katex。
          */}
          {display ? (
            <span className="katex-display">{children}</span>
          ) : (
            <span className="katex">{children}</span>
          )}
        </span>
        {panel}
      </span>
    </InsideKatexFormulaContext.Provider>
  );
}

export function isMathClassName(className?: string): boolean {
  return isKatexRootClassName(className).root;
}

export function isMathDisplayClassName(className?: string): boolean {
  return isKatexRootClassName(className).display;
}
