"use client";

import { useMemo, useState, useEffect } from "react";
import { Search, X, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  text: string;
  level: number;
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

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
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

export function TableOfContents({ content, className }: { content: string; className?: string }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = useMemo(() => parseHeadings(content), [content]);
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) => item.text.toLowerCase().includes(q));
  }, [items, query]);

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
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <aside
      className={cn(
        "fixed top-20 right-4 z-30 hidden w-64 flex-col rounded-xl border bg-card text-card-foreground shadow-sm xl:flex",
        className
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">目录</h3>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {filtered.length}
        </span>
      </div>
      <Separator />
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索页内标题"
            className="h-8 pl-8 pr-7 text-xs"
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
      <ScrollArea className="max-h-[calc(100vh-15rem)]">
        <nav className="flex flex-col px-2 pb-2">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollToId(item.id)}
              className={cn(
                "group flex items-start gap-1 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                item.level === 2 && "font-medium",
                item.level === 3 && "pl-5 text-muted-foreground",
                item.level === 4 && "pl-9 text-muted-foreground/80",
                activeId === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <ChevronRight
                className={cn(
                  "mt-0.5 h-3 w-3 shrink-0 transition-transform",
                  activeId === item.id ? "rotate-90 text-primary" : "text-muted-foreground/60 group-hover:text-accent-foreground"
                )}
              />
              <span className="line-clamp-2">
                <Highlight text={item.text} query={query} />
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">无匹配标题</p>
          )}
        </nav>
      </ScrollArea>
    </aside>
  );
}
