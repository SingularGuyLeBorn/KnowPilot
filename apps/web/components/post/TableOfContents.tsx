"use client";

import { useMemo, useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { ChevronRight, ListTree, PanelRightClose } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const TOC_VISIBLE_KEY = "kp-post-toc-visible";
const tocListeners = new Set<() => void>();

export interface TocItem {
  id: string;
  text: string;
  level: number;
  index: number;
}

interface TocGroup {
  heading: TocItem;
  children: TocItem[];
}

function parseHeadings(content: string): TocItem[] {
  const items: TocItem[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (match) {
      const text = match[2]
        .trim()
        .replace(/<[^>]+>/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      items.push({ id: `kp-h-${items.length}`, text, level: match[1].length, index: items.length });
    }
  }
  return items;
}

/**
 * 为每个标题生成唯一 id，与正文 Heading 组件使用的 id 保持一致。
 * 使用 `kp-h-${index}` 作为 id，彻底避免「math/特殊字符导致正文与目录 id 不一致」
 * 以及「重复标题 id 冲突」两类跳转失效。index 按文档顺序从 0 开始。
 */
export function buildTocItems(content: string): TocItem[] {
  return parseHeadings(content);
}

function buildGroups(items: TocItem[]): TocGroup[] {
  const groups: TocGroup[] = [];
  let current: TocGroup | null = null;
  for (const item of items) {
    if (item.level === 2) {
      current = { heading: item, children: [] };
      groups.push(current);
    } else if (current) {
      current.children.push(item);
    } else {
      groups.push({ heading: item, children: [] });
    }
  }
  return groups;
}

function scrollToId(id: string, attempt = 0) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "auto", block: "start" });
    history.replaceState(null, "", `#${id}`);
    return;
  }
  if (attempt < 1) {
    window.setTimeout(() => scrollToId(id, attempt + 1), 50);
    return;
  }
  // 兜底：按索引直接取第 N 个 h2/h3/h4，避免 id 生成/渲染不一致导致点击无响应
  const idxMatch = /^kp-h-(\d+)$/.exec(id);
  if (!idxMatch) return;
  const targetIndex = Number(idxMatch[1]);
  const container = document.querySelector(".kp-post-content");
  const headings = container
    ? Array.from(container.querySelectorAll("h2, h3, h4"))
    : Array.from(document.querySelectorAll("article.kp-post-swap h2, article.kp-post-swap h3, article.kp-post-swap h4"));
  const target = headings[targetIndex];
  if (target) {
    target.scrollIntoView({ behavior: "auto", block: "start" });
    history.replaceState(null, "", `#${id}`);
  }
}

function useInitialHash(items: TocItem[], setActiveId: (id: string) => void) {
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    if (items.some((item) => item.id === hash)) {
      setActiveId(hash);
    }
  }, [items, setActiveId]);
}

function readTocVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(TOC_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}

function subscribeTocVisible(onStoreChange: () => void) {
  tocListeners.add(onStoreChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOC_VISIBLE_KEY || e.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    tocListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function setTocVisiblePersist(next: boolean) {
  try {
    localStorage.setItem(TOC_VISIBLE_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }
  for (const listener of tocListeners) listener();
}

/** 本页目录显隐偏好（与 TableOfContents 同源，供正文留白同步） */
export function usePostTocVisible(): boolean {
  return useSyncExternalStore(subscribeTocVisible, readTocVisible, () => true);
}

export function TableOfContents({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const visible = usePostTocVisible();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set());

  const items = useMemo(() => buildTocItems(content), [content]);
  const groups = useMemo(() => buildGroups(items), [items]);

  const expanded = useMemo(() => {
    const next = new Set(manuallyExpanded);
    if (activeId) {
      for (const group of groups) {
        if (group.heading.id === activeId || group.children.some((c) => c.id === activeId)) {
          next.add(group.heading.id);
          break;
        }
      }
    }
    return next;
  }, [manuallyExpanded, activeId, groups]);

  useInitialHash(items, setActiveId);

  useEffect(() => {
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let topVisible: string | null = null;
        let topY = Infinity;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.boundingClientRect.top < topY) {
            topY = entry.boundingClientRect.top;
            topVisible = entry.target.id;
          }
        }
        if (topVisible) setActiveId(topVisible);
      },
      { rootMargin: "-88px 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  const toggleGroup = useCallback((id: string) => {
    setManuallyExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setTocVisiblePersist(true)}
        className={cn(
          "fixed top-[5.5rem] right-4 z-30 hidden items-center gap-1.5 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2 text-xs font-medium text-[var(--kp-text-2)] shadow-sm transition hover:border-[var(--kp-brand)] hover:text-[var(--kp-brand-deep)] xl:inline-flex",
          className,
        )}
        aria-label="显示本页目录"
        title="显示目录"
      >
        <ListTree className="h-4 w-4" />
        目录
      </button>
    );
  }

  return (
    <aside
      className={cn(
        "fixed top-[5.5rem] right-4 z-30 hidden w-72 flex-col rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] text-[var(--kp-text-1)] shadow-sm xl:flex",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--kp-text-1)]">本页目录</h3>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5 text-xs font-medium text-[var(--kp-text-3)]">
            {groups.length}
          </span>
          <button
            type="button"
            onClick={() => setTocVisiblePersist(false)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
            aria-label="隐藏本页目录"
            title="隐藏目录"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="max-h-[calc(100vh-9rem)]">
        <nav className="flex flex-col px-2 py-2">
          {groups.map((group) => {
            const isOpen = expanded.has(group.heading.id);
            const hasChildren = group.children.length > 0;
            const isActiveGroup = activeId === group.heading.id;

            return (
              <Collapsible key={group.heading.id} open={isOpen} onOpenChange={() => toggleGroup(group.heading.id)}>
                <div className="flex items-center">
                  {hasChildren ? (
                    <CollapsibleTrigger
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={isOpen ? "折叠" : "展开"}
                    >
                      <ChevronRight
                        className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")}
                      />
                    </CollapsibleTrigger>
                  ) : (
                    <span className="h-5 w-5 shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(group.heading.id);
                      scrollToId(group.heading.id);
                    }}
                    className={cn(
                      "group flex flex-1 items-start rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                      isActiveGroup
                        ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                        : "text-[var(--kp-text-1)] hover:bg-[var(--kp-bg-mute)]",
                    )}
                  >
                    <span className="line-clamp-2 font-medium">{group.heading.text}</span>
                  </button>
                </div>

                {hasChildren && (
                  <CollapsibleContent>
                    <div className="ml-4 border-l border-border pl-2">
                      {group.children.map((child) => {
                        const isActive = activeId === child.id;
                        return (
                          <button
                            key={child.id}
                            type="button"
                            onClick={() => {
                              setActiveId(child.id);
                              scrollToId(child.id);
                            }}
                            className={cn(
                              "group flex w-full items-start rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                              child.level === 3 && "pl-3",
                              child.level === 4 && "pl-5 text-[var(--kp-text-2)]",
                              isActive
                                ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                                : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
                            )}
                          >
                            <span className="line-clamp-2">{child.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                )}
              </Collapsible>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
