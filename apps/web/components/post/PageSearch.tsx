"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from "react";
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

export function PageSearch({ containerRef, className }: PageSearchProps) {
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

  const handleClear = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    const container = containerRef.current;
    if (container) clearHighlights(container);
    setMatches([]);
    setCurrent(0);
    inputRef.current?.blur();
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!debouncedQuery.trim()) {
      clearHighlights(container);
      // Defer state update so it is not synchronous within the effect body.
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
  }, [debouncedQuery, containerRef]);

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
      const typingInInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isMod && e.key.toLowerCase() === "f" && !typingInInput) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (e.key === "Escape" && query) {
        e.preventDefault();
        handleClear();
        return;
      }

      if (!typingInInput) return;

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
  }, [query, matches, current, goTo, handleClear]);

  return (
    <div className={cn("kp-page-search", className)}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 shadow-sm">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="页内搜索（Ctrl+F）"
          className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
        />
        {query ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {matches.length > 0 ? current + 1 : 0} / {matches.length}
            </span>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() =>
                  matches.length &&
                  goTo((current - 1 + matches.length) % matches.length)
                }
                disabled={matches.length === 0}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                aria-label="上一个匹配"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  matches.length && goTo((current + 1) % matches.length)
                }
                disabled={matches.length === 0}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                aria-label="下一个匹配"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="清除搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      {debouncedQuery && matches.length === 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          未找到“{debouncedQuery}”的匹配结果
        </p>
      )}
    </div>
  );
}
