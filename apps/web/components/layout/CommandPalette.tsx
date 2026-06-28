"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  FolderOpen,
  Hash,
  Home,
  PenLine,
  Search,
  Settings,
  Command,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface CommandItem {
  id: string;
  type: "post" | "category" | "tag" | "action";
  title: string;
  subtitle?: string;
  href?: string;
  icon: React.ReactNode;
  shortcut?: string;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQueryRaw] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const setQuery = (value: string) => {
    setQueryRaw(value);
    setSelectedIndex(0);
  };

  const { data: posts = [] } = trpc.post.tree.useQuery(undefined, {
    enabled: open,
  });
  const { data: categories = [] } = trpc.post.categories.useQuery(undefined, {
    enabled: open,
  });
  const { data: tags = [] } = trpc.post.tags.useQuery(undefined, {
    enabled: open,
  });

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    const list: CommandItem[] = [];

    // Actions (always on top)
    list.push(
      {
        id: "action:home",
        type: "action",
        title: "前往首页",
        href: "/",
        icon: <Home className="h-4 w-4" />,
        shortcut: "H",
      },
      {
        id: "action:posts",
        type: "action",
        title: "前往文章列表",
        href: "/posts",
        icon: <FileText className="h-4 w-4" />,
        shortcut: "P",
      },
      {
        id: "action:new",
        type: "action",
        title: "新建文章",
        href: "/editor",
        icon: <PenLine className="h-4 w-4" />,
        shortcut: "N",
      },
      {
        id: "action:settings",
        type: "action",
        title: "打开设置",
        href: "#settings",
        icon: <Settings className="h-4 w-4" />,
        shortcut: "S",
      }
    );

    // Posts
    for (const post of posts) {
      if (!q || post.title.toLowerCase().includes(q) || post.slug.toLowerCase().includes(q)) {
        list.push({
          id: `post:${post.slug}`,
          type: "post",
          title: post.title,
          subtitle: post.slug,
          href: `/posts/${encodeURIComponent(post.slug)}`,
          icon: <FileText className="h-4 w-4" />,
        });
      }
    }

    // Categories
    for (const category of categories) {
      if (!q || category.toLowerCase().includes(q)) {
        list.push({
          id: `category:${category}`,
          type: "category",
          title: category,
          href: `/categories/${encodeURIComponent(category)}`,
          icon: <FolderOpen className="h-4 w-4" />,
        });
      }
    }

    // Tags
    for (const tag of tags) {
      if (!q || tag.toLowerCase().includes(q)) {
        list.push({
          id: `tag:${tag}`,
          type: "tag",
          title: tag,
          href: `/tags/${encodeURIComponent(tag)}`,
          icon: <Hash className="h-4 w-4" />,
        });
      }
    }

    return list;
  }, [posts, categories, tags, query]);

  const openPalette = () => {
    setQueryRaw("");
    setSelectedIndex(0);
    setOpen(true);
  };

  const closePalette = () => {
    setOpen(false);
  };

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + items.length) % items.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item?.href) {
        if (item.href === "#settings") {
          alert("设置页尚未实现");
        } else {
          router.push(item.href);
        }
        closePalette();
      }
      return;
    }
  };

  const runItem = (item: CommandItem) => {
    if (item.href) {
      if (item.href === "#settings") {
        alert("设置页尚未实现");
      } else {
        router.push(item.href);
      }
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPalette}
        className="hidden items-center gap-2 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-3 py-1.5 text-xs text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] md:inline-flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span>搜索</span>
        <kbd className="ml-1 rounded border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-1 font-mono text-[10px]">
          <Command className="inline h-3 w-3" />K
        </kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 p-4 pt-[15vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 border-b border-[var(--kp-divider)] px-4 py-3">
          <Search className="h-5 w-5 text-[var(--kp-text-3)]" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文章、分类、标签或操作…"
            className="h-auto border-0 bg-transparent px-0 text-base text-[var(--kp-text-1)] shadow-none placeholder:text-[var(--kp-text-3)] focus-visible:ring-0"
          />
          <kbd className="hidden rounded border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--kp-text-3)] sm:inline-block">
            ESC
          </kbd>
        </div>

        <ScrollArea className="max-h-[55vh]">
          <div className="py-2">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--kp-text-3)]">
                没有找到匹配结果
              </div>
            ) : (
              renderGroupedItems(items, selectedIndex, runItem, setSelectedIndex)
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-2 text-xs text-[var(--kp-text-3)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-1 font-mono">↑</kbd>
              <kbd className="rounded border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-1 font-mono">↓</kbd>
              选择
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-1 font-mono">↵</kbd>
              确认
            </span>
          </div>
          <span>
            {items.length} 个结果
          </span>
        </div>
      </div>
    </div>
  );
}

function renderGroupedItems(
  items: CommandItem[],
  selectedIndex: number,
  onSelect: (item: CommandItem) => void,
  onHover: (index: number) => void
) {
  const groups: { label: string; items: CommandItem[] }[] = [
    { label: "操作", items: items.filter((i) => i.type === "action") },
    { label: "文章", items: items.filter((i) => i.type === "post") },
    { label: "分类", items: items.filter((i) => i.type === "category") },
    { label: "标签", items: items.filter((i) => i.type === "tag") },
  ];

  const elements: React.ReactNode[] = [];
  for (const group of groups) {
    if (group.items.length === 0) continue;
    elements.push(
      <div key={`group-${group.label}`}>
        <div className="sticky top-0 bg-[var(--kp-bg)] px-4 py-1.5 text-xs font-medium text-[var(--kp-text-3)]">
          {group.label}
        </div>
        <div className="px-2">
          {group.items.map((item) => {
            const globalIndex = items.findIndex((i) => i.id === item.id);
            const selected = globalIndex === selectedIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                onMouseEnter={() => onHover(globalIndex)}
                data-selected={selected}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition",
                  selected
                    ? "bg-[var(--kp-brand)] text-white"
                    : "text-[var(--kp-text-1)] hover:bg-[var(--kp-bg-mute)]"
                )}
              >
                <span className={cn("shrink-0", selected ? "text-white" : "text-[var(--kp-text-3)]")}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.title}</span>
                {item.subtitle && (
                  <span className={cn("truncate text-xs", selected ? "text-white/80" : "text-[var(--kp-text-3)]")}>
                    {item.subtitle}
                  </span>
                )}
                {item.shortcut && (
                  <kbd
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      selected
                        ? "border-white/30 bg-white/10 text-white"
                        : "border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] text-[var(--kp-text-3)]"
                    )}
                  >
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>
        <Separator className="my-2 bg-[var(--kp-divider)]" />
      </div>
    );
  }
  // Remove trailing separator
  if (elements.length > 0) {
    elements.pop();
  }
  return elements;
}
