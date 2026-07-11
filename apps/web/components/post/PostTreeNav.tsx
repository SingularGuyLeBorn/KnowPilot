"use client";

import { useState, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  FileText,
  FoldVertical,
  FolderClosed,
  FolderOpen,
  LocateFixed,
  Search,
  UnfoldVertical,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { VirtualFlatList } from "@/components/shared";

interface PostSummary {
  id: string;
  slug: string;
  title: string;
}

interface TreeNode {
  id: string;
  slug?: string;
  title: string;
  key: string;
  type: "doc" | "group";
  children: TreeNode[];
}

interface TreeItem {
  post: PostSummary | null;
  children: Record<string, TreeItem>;
}

const EXPANDED_KEY = "kp-tree-expanded";
const SCROLL_KEY = "kp-tree-scroll-top";

function buildTree(posts: PostSummary[]): TreeNode[] {
  const root: Record<string, TreeItem> = {};

  for (const post of posts) {
    const parts = post.slug.split("/");
    let map = root;
    let parentItem: TreeItem | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (
        i === parts.length - 1 &&
        parentItem &&
        (part === "index" || part === parts[i - 1])
      ) {
        parentItem.post = post;
        break;
      }

      if (!map[part]) {
        map[part] = { post: null, children: {} };
      }
      const item = map[part];
      if (i === parts.length - 1) {
        item.post = post;
      }
      parentItem = item;
      map = item.children;
    }
  }

  const naturalCompare = (a: string, b: string): number => {
    const re = /(\d+)|(\D+)/g;
    const aParts = a.match(re) || [];
    const bParts = b.match(re) || [];
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
      const aPart = aParts[i];
      const bPart = bParts[i];
      const aNum = parseInt(aPart, 10);
      const bNum = parseInt(bPart, 10);
      const bothNums = !Number.isNaN(aNum) && !Number.isNaN(bNum);
      if (bothNums) {
        if (aNum !== bNum) return aNum - bNum;
      } else {
        const cmp = aPart.localeCompare(bPart, "zh-CN");
        if (cmp !== 0) return cmp;
      }
    }
    return aParts.length - bParts.length;
  };

  const sortByKey = (a: TreeNode, b: TreeNode) => naturalCompare(a.key, b.key);

  const convert = (key: string, item: TreeItem): TreeNode => {
    const children = Object.entries(item.children)
      .map(([childKey, childItem]) => convert(childKey, childItem))
      .sort(sortByKey);
    const post = item.post;
    return {
      id: post?.id || `group-${key}`,
      slug: post?.slug,
      title: post?.title || key,
      key,
      type: post ? "doc" : "group",
      children,
    };
  };

  return Object.entries(root)
    .map(([key, item]) => convert(key, item))
    .sort(sortByKey);
}

function getPostSlug(pathname: string) {
  const match = pathname.match(/^\/posts\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function collectAncestorKeys(slug: string, nodes: TreeNode[]): string[] | null {
  for (const node of nodes) {
    if (node.slug === slug) return [];
    if (node.children.length) {
      const found = collectAncestorKeys(slug, node.children);
      if (found !== null) return [node.key, ...found];
    }
  }
  return null;
}

function collectGroupKeys(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => {
    const childGroups = collectGroupKeys(node.children);
    return node.children.length ? [node.key, ...childGroups] : childGroups;
  });
}

function collectAllKeys(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => [node.key, ...collectAllKeys(node.children)]);
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.toLowerCase();
  return nodes.reduce<TreeNode[]>((acc, node) => {
    const matches = node.title.toLowerCase().includes(q);
    const children = matches ? node.children : filterTree(node.children, q);
    if (matches || children.length) {
      acc.push({ ...node, children });
    }
    return acc;
  }, []);
}

interface FlatDocRow {
  key: string;
  slug: string;
  title: string;
  depth: number;
}

function flattenDocNodes(nodes: TreeNode[], depth = 0): FlatDocRow[] {
  const rows: FlatDocRow[] = [];
  for (const node of nodes) {
    if (node.slug) {
      rows.push({ key: node.key, slug: node.slug, title: node.title, depth });
    }
    if (node.children.length) {
      rows.push(...flattenDocNodes(node.children, depth + 1));
    }
  }
  return rows;
}

function readScrollTop(): number {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function saveScrollTop(top: number) {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(top));
  } catch {
    // ignore
  }
}

function TreeNodeItem({
  node,
  expanded,
  activeSlug,
  onToggle,
  onNavigate,
}: {
  node: TreeNode;
  expanded: Set<string>;
  activeSlug: string | null;
  onToggle: (key: string, open: boolean) => void;
  onNavigate: () => void;
}) {
  const isExpanded = expanded.has(node.key);
  const isActive = node.slug === activeSlug;
  const hasChildren = node.children.length > 0;
  const isDoc = node.type === "doc";

  const rowClass = cn(
    "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition",
    isActive
      ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
      : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
  );

  const iconNode = hasChildren ? (
    isExpanded ? (
      <FolderOpen className="h-4 w-4 shrink-0 text-[var(--kp-brand-deep)]" />
    ) : (
      <FolderClosed className="h-4 w-4 shrink-0 text-[var(--kp-brand-light)]" />
    )
  ) : (
    <FileText className="h-4 w-4 shrink-0 text-[var(--kp-text-3)]" />
  );

  return (
    <div>
      <div className="flex items-center">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.key, !isExpanded)}
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--kp-text-3)] transition-colors hover:bg-[var(--kp-bg-soft)] hover:text-[var(--kp-text-1)]",
              isExpanded && "text-[var(--kp-text-1)]"
            )}
            aria-label={isExpanded ? "折叠" : "展开"}
          >
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" />
        )}

        {isDoc && node.slug ? (
          <Link
            href={`/posts/${encodeURIComponent(node.slug)}`}
            scroll={false}
            onClick={onNavigate}
            className={rowClass}
            title={node.title}
            data-tree-slug={node.slug}
          >
            {iconNode}
            <span className="line-clamp-2 leading-snug">{node.title}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => hasChildren && onToggle(node.key, !isExpanded)}
            className={rowClass}
            title={node.title}
          >
            {iconNode}
            <span className="line-clamp-2 leading-snug">{node.title}</span>
          </button>
        )}
      </div>

      {hasChildren && (
        <Collapsible open={isExpanded} onOpenChange={(open) => onToggle(node.key, open)}>
          <CollapsibleContent className="data-open:animate-none data-closed:animate-none">
            <div className="ml-3 border-l border-[var(--kp-divider)] pl-2">
              {node.children.map((child) => (
                <TreeNodeItem
                  key={child.key}
                  node={child}
                  expanded={expanded}
                  activeSlug={activeSlug}
                  onToggle={onToggle}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function PostTreeNav({ className }: { className?: string }) {
  const { data, isLoading } = trpc.post.tree.useQuery();
  const pathname = usePathname();
  const activeSlug = useMemo(() => getPostSlug(pathname), [pathname]);
  const tree = useMemo(() => buildTree(data || []), [data]);
  const [manuallyExpanded, setManuallyExpanded] = useState<Map<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(EXPANDED_KEY);
      if (saved) {
        // 兼容旧格式（数组=展开的key列表）→ 转为 Map（key=true）
        const arr = JSON.parse(saved) as string[];
        return new Map(arr.map((k) => [k, true]));
      }
      return new Map();
    } catch {
      return new Map();
    }
  });
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const persistExpanded = useCallback((next: Map<string, boolean>) => {
    try {
      // 只持久化显式设置的 key（true=展开, false=折叠）
      const obj: Record<string, boolean> = {};
      for (const [k, v] of next) obj[k] = v;
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(
    (key: string, open: boolean) => {
      setManuallyExpanded((prev) => {
        const next = new Map(prev);
        next.set(key, open); // true=显式展开, false=显式折叠
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded]
  );

  const visibleTree = useMemo(() => {
    if (!query.trim()) return tree;
    return filterTree(tree, query);
  }, [tree, query]);

  const flatSearchResults = useMemo(() => {
    if (!query.trim()) return [];
    return flattenDocNodes(visibleTree);
  }, [visibleTree, query]);

  const isSearchMode = query.trim().length > 0;

  const expanded = useMemo(() => {
    const next = new Set<string>();
    // 1. 先加显式展开的 key
    for (const [key, isOpen] of manuallyExpanded) {
      if (isOpen) next.add(key);
    }
    // 2. 自动展开当前文章的祖先文件夹 — 但不覆盖显式折叠的 key
    if (activeSlug && tree.length > 0) {
      const ancestors = collectAncestorKeys(activeSlug, tree);
      if (ancestors !== null) {
        for (const key of ancestors) {
          // 只自动展开未被显式折叠的 key
          if (manuallyExpanded.get(key) !== false) next.add(key);
        }
      }
    }
    // 3. 搜索模式：展开所有匹配的 key（不覆盖显式折叠）
    if (query.trim()) {
      for (const key of collectAllKeys(visibleTree)) {
        if (manuallyExpanded.get(key) !== false) next.add(key);
      }
    }
    return next;
  }, [manuallyExpanded, activeSlug, tree, query, visibleTree]);

  const restoreScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = readScrollTop();
  }, []);

  useLayoutEffect(() => {
    restoreScroll();
  }, [restoreScroll]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      saveScrollTop(scrollRef.current.scrollTop);
    }
  }, []);

  const handleNavigate = useCallback(() => {
    if (scrollRef.current) {
      saveScrollTop(scrollRef.current.scrollTop);
    }
  }, []);

  const allGroupKeys = useMemo(() => collectGroupKeys(tree), [tree]);

  const expandAll = useCallback(() => {
    const next = new Map<string, boolean>();
    for (const key of allGroupKeys) next.set(key, true);
    setManuallyExpanded(next);
    persistExpanded(next);
  }, [allGroupKeys, persistExpanded]);

  const collapseAll = useCallback(() => {
    const next = new Map<string, boolean>();
    for (const key of allGroupKeys) next.set(key, false);
    setManuallyExpanded(next);
    persistExpanded(next);
  }, [allGroupKeys, persistExpanded]);

  const scrollToActiveItem = useCallback(
    (smooth = true) => {
      if (!activeSlug || !scrollRef.current) return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = scrollRef.current?.querySelector(
            `[data-tree-slug="${CSS.escape(activeSlug)}"]`,
          );
          el?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
        });
      });
    },
    [activeSlug],
  );

  const locateCurrent = useCallback(() => {
    scrollToActiveItem(true);
  }, [scrollToActiveItem]);

  useLayoutEffect(() => {
    if (!activeSlug || isSearchMode) return;
    scrollToActiveItem(false);
  }, [activeSlug, isSearchMode, scrollToActiveItem]);

  if (isLoading) {
    return (
      <div className={cn("flex flex-1 items-center justify-center p-4", className)}>
        <p className="text-sm text-[var(--kp-text-3)]">加载目录…</p>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="shrink-0 px-3 pb-2 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选文章…"
            className="h-9 border-[var(--kp-divider)] bg-[var(--kp-bg)] pl-9 pr-8 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              aria-label="清除筛选"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {!isSearchMode && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={expandAll}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2 py-1.5 text-xs font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
              title="一键展开全部目录"
            >
              <UnfoldVertical className="h-3.5 w-3.5" />
              展开
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2 py-1.5 text-xs font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
              title="一键折叠全部目录"
            >
              <FoldVertical className="h-3.5 w-3.5" />
              折叠
            </button>
            <button
              type="button"
              onClick={locateCurrent}
              disabled={!activeSlug}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2 py-1.5 text-xs font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)] disabled:cursor-not-allowed disabled:opacity-40"
              title={activeSlug ? "定位当前文章" : "当前不在文章页"}
            >
              <LocateFixed className="h-3.5 w-3.5" />
              定位
            </button>
          </div>
        )}
      </div>

      {isSearchMode ? (
        <VirtualFlatList
          className="px-2 pb-3 [overflow-anchor:none]"
          items={flatSearchResults}
          rowHeight={40}
          getKey={(item) => item.key}
          emptyMessage="没有匹配的文章"
          renderItem={(item) => {
            const isActive = item.slug === activeSlug;
            return (
              <Link
                href={`/posts/${encodeURIComponent(item.slug)}`}
                scroll={false}
                onClick={handleNavigate}
                className={cn(
                  "flex h-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition",
                  isActive
                    ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                    : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
                )}
                style={{ paddingLeft: `${10 + item.depth * 12}px` }}
                title={item.title}
                data-tree-slug={item.slug}
              >
                <FileText className="h-4 w-4 shrink-0 text-[var(--kp-text-3)]" />
                <span className="truncate">{item.title}</span>
              </Link>
            );
          }}
        />
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 [overflow-anchor:none]"
        >
          <nav className="flex flex-col gap-0.5">
            {visibleTree.map((node) => (
              <TreeNodeItem
                key={node.key}
                node={node}
                expanded={expanded}
                activeSlug={activeSlug}
                onToggle={toggle}
                onNavigate={handleNavigate}
              />
            ))}
            {visibleTree.length === 0 && (
              <p className="px-2 py-4 text-sm text-[var(--kp-text-3)]">暂无本地文章</p>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
