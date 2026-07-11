"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { Search, X, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocGroup {
  heading: TocItem;
  children: TocItem[];
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseHeadings(content: string): TocItem[] {
  const items: TocItem[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (match) {
      const text = match[2].trim().replace(/<[^>]+>/g, "");
      items.push({ id: slugify(text), text, level: match[1].length });
    }
  }
  return items;
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
      // orphan h3/h4 before any h2: create a virtual group
      groups.push({ heading: item, children: [] });
    }
  }
  return groups;
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
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

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${safe})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded bg-primary/20 px-0.5 text-primary">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function filterGroups(groups: TocGroup[], query: string): TocGroup[] {
  const q = query.toLowerCase();
  return groups.reduce<TocGroup[]>((acc, group) => {
    const headingMatch = group.heading.text.toLowerCase().includes(q);
    const matchedChildren = group.children.filter((c) =>
      c.text.toLowerCase().includes(q)
    );
    if (headingMatch) {
      acc.push({ ...group, children: group.children });
    } else if (matchedChildren.length) {
      acc.push({ ...group, children: matchedChildren });
    }
    return acc;
  }, []);
}

export function TableOfContents({ content, className }: { content: string; className?: string }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set());

  const items = useMemo(() => parseHeadings(content), [content]);
  const groups = useMemo(() => buildGroups(items), [items]);
  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    return filterGroups(groups, query);
  }, [groups, query]);

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
    if (query.trim()) {
      for (const group of filtered) next.add(group.heading.id);
    }
    return next;
  }, [manuallyExpanded, activeId, groups, query, filtered]);

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
      // 观察区域：从导航栏下方到视口 45% 处，取最靠近顶部的标题
      { rootMargin: "-88px 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
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

  return (
    <aside
      className={cn(
        "fixed top-[5.5rem] right-4 z-30 hidden w-72 flex-col rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] text-[var(--kp-text-1)] shadow-sm xl:flex",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--kp-text-1)]">本页目录</h3>
        <span className="rounded-full bg-[var(--kp-bg-mute)] px-2 py-0.5 text-xs font-medium text-[var(--kp-text-3)]">
          {filtered.length}
        </span>
      </div>
      <Separator />
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索页内标题"
            className="h-9 pl-9 pr-8 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="max-h-[calc(100vh-11rem)]">
        <nav className="flex flex-col px-2 pb-2">
          {filtered.map((group) => {
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
                        : "text-[var(--kp-text-1)] hover:bg-[var(--kp-bg-mute)]"
                    )}
                  >
                    <span className="line-clamp-2 font-medium">
                      <Highlight text={group.heading.text} query={query} />
                    </span>
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
                                : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
                            )}
                          >
                            <span className="line-clamp-2">
                              <Highlight text={child.text} query={query} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                )}
              </Collapsible>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-sm text-[var(--kp-text-3)]">无匹配标题</p>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}
