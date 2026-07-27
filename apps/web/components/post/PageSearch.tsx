"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PageSearchProps {
  containerRef: RefObject<HTMLElement | null>;
  className?: string;
}

const MARK_CLASS = "kp-page-search-mark";
const CURRENT_CLASS = "kp-page-search-current";
const EXCLUDED_SELECTORS =
  "pre, code, .katex, .katex-display, ." + MARK_CLASS + ", script, style, noscript";

function clearHighlights(container: HTMLElement) {
  const marks = container.querySelectorAll<HTMLElement>("mark." + MARK_CLASS);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    parent.normalize?.();
  });
}

function highlight(container: HTMLElement, rawQuery: string): HTMLElement[] {
  clearHighlights(container);

  const query = rawQuery.trim();
  if (!query) return [];

  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(EXCLUDED_SELECTORS)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".kp-page-search")) return NodeFilter.FILTER_REJECT;
      const text = node.textContent || "";
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      if (text.toLowerCase().includes(lowerQuery))
        return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  const matches: HTMLElement[] = [];

  for (const textNode of textNodes) {
    let cursor: Text | null = textNode;
    while (cursor) {
      const text = cursor.textContent || "";
      const idx = text.toLowerCase().indexOf(lowerQuery);
      if (idx === -1) break;

      const range = document.createRange();
      range.setStart(cursor, idx);
      range.setEnd(cursor, idx + query.length);

      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = text.slice(idx, idx + query.length);

      range.deleteContents();
      range.insertNode(mark);
      matches.push(mark);

      cursor = mark.nextSibling as Text | null;
    }
  }

  return matches;
}

/** 页内搜索：默认隐藏，Ctrl/Cmd+F 浮出；Esc 关闭并清除高亮 */
export function PageSearch({ containerRef, className }: PageSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scheduled = useRef<number | null>(null);

  useEffect(() => {
    if (scheduled.current) window.clearTimeout(scheduled.current);
    scheduled.current = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 120);
    return () => {
      if (scheduled.current) window.clearTimeout(scheduled.current);
    };
  }, [query]);

  const goTo = useCallback((index: number) => {
    setCurrent(index);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    const container = containerRef.current;
    if (container) clearHighlights(container);
    setMatches([]);
    setCurrent(0);
  }, [containerRef]);

  const handleOpen = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!open || !debouncedQuery.trim()) {
      clearHighlights(container);
      queueMicrotask(() => {
        setMatches([]);
        setCurrent(0);
      });
      return;
    }

    const found = highlight(container, debouncedQuery);
    queueMicrotask(() => {
      setMatches(found);
      setCurrent(found.length ? 0 : -1);
    });
  }, [debouncedQuery, containerRef, open]);

  useEffect(() => {
    matches.forEach((el) => el.classList.remove(CURRENT_CLASS));
    const active = matches[current];
    if (active) {
      active.classList.add(CURRENT_CLASS);
      active.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [current, matches]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const inOurInput = Boolean(target.closest?.(".kp-page-search"));
      const typingElsewhere =
        !inOurInput &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (isMod && e.key.toLowerCase() === "f" && !typingElsewhere) {
        e.preventDefault();
        handleOpen();
        return;
      }

      if (e.key === "Escape" && open) {
        e.preventDefault();
        handleClose();
        return;
      }

      if (!open || !inOurInput) return;

      if (e.key === "Enter" && matches.length > 0) {
        e.preventDefault();
        if (e.shiftKey) {
          goTo((current - 1 + matches.length) % matches.length);
        } else {
          goTo((current + 1) % matches.length);
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, matches, current, goTo, handleClose, handleOpen]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "kp-page-search fixed left-1/2 top-[4.75rem] z-[90] w-[min(100vw-2rem,28rem)] -translate-x-1/2",
        className,
      )}
      role="search"
      aria-label="页内搜索"
    >
      <div className="flex items-center gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2 shadow-lg">
        <Search className="h-4 w-4 shrink-0 text-[var(--kp-text-3)]" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="页内搜索…"
          className="h-8 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-1">
          <span className="min-w-[3.5rem] text-center text-[11px] tabular-nums text-[var(--kp-text-3)]">
            {query
              ? `${matches.length > 0 ? current + 1 : 0} / ${matches.length}`
              : "—"}
          </span>
          <button
            type="button"
            onClick={() =>
              matches.length && goTo((current - 1 + matches.length) % matches.length)
            }
            disabled={matches.length === 0}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] disabled:opacity-40"
            aria-label="上一个匹配"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => matches.length && goTo((current + 1) % matches.length)}
            disabled={matches.length === 0}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] disabled:opacity-40"
            aria-label="下一个匹配"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
            aria-label="关闭搜索"
            title="Esc"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {debouncedQuery && matches.length === 0 && (
        <p className="mt-1.5 text-center text-[11px] text-[var(--kp-text-3)]">
          未找到“{debouncedQuery}”
        </p>
      )}
    </div>,
    document.body,
  );
}
