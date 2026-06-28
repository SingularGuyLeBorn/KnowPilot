"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, FileText, FolderClosed, FolderOpen, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

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

function buildTree(posts: PostSummary[]): TreeNode[] {
  const root: Record<string, TreeItem> = {};

  for (const post of posts) {
    const parts = post.slug.split("/");
    let map = root;
    let parentItem: TreeItem | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!map[part]) {
        map[part] = { post: null, children: {} };
      }
      const item = map[part];
      if (i === parts.length - 1) {
        if (part === "index" && parentItem) {
          parentItem.post = post;
        } else {
          item.post = post;
        }
      }
      parentItem = item;
      map = item.children;
    }
  }

  const sortByKey = (a: TreeNode, b: TreeNode) => a.key.localeCompare(b.key, "zh-CN");

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

const STORAGE_KEY = "kp-tree-expanded";

function TreeNodeItem({
  node,
  expanded,
  activeSlug,
  onToggle,
}: {
  node: TreeNode;
  expanded: Set<string>;
  activeSlug: string | null;
  onToggle: (key: string, open: boolean) => void;
}) {
  const isExpanded = expanded.has(node.key);
  const isActive = node.slug === activeSlug;
  const hasChildren = node.children.length > 0;
  const isDoc = node.type === "doc";

  const rowClass = cn(
    "group flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
    isActive
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  );

  const iconNode = hasChildren ? (
    isExpanded ? (
      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
    ) : (
      <FolderClosed className="h-3.5 w-3.5 shrink-0" />
    )
  ) : (
    <FileText className="h-3.5 w-3.5 shrink-0" />
  );

  return (
    <div>
      <div className="flex items-center">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.key, !isExpanded)}
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              isExpanded && "text-foreground"
            )}
            aria-label={isExpanded ? "折叠" : "展开"}
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        {isDoc && node.slug ? (
          <Link href={`/posts/${encodeURIComponent(node.slug)}`} className={rowClass} title={node.title}>
            {iconNode}
            <span className="line-clamp-1">{node.title}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => hasChildren && onToggle(node.key, !isExpanded)}
            className={rowClass}
            title={node.title}
          >
            {iconNode}
            <span className="line-clamp-1">{node.title}</span>
          </button>
        )}
      </div>

      {hasChildren && (
        <Collapsible open={isExpanded} onOpenChange={(open) => onToggle(node.key, open)}>
          <CollapsibleContent>
            <div className="ml-3 border-l border-border pl-2">
              {node.children.map((child) => (
                <TreeNodeItem
                  key={child.key}
                  node={child}
                  expanded={expanded}
                  activeSlug={activeSlug}
                  onToggle={onToggle}
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!activeSlug || tree.length === 0) return;
    const ancestors = collectAncestorKeys(activeSlug, tree);
    if (ancestors !== null) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const key of ancestors) next.add(key);
        return next;
      });
    }
  }, [activeSlug, tree]);

  const persist = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(
    (key: string, open: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(key);
        else next.delete(key);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const visibleTree = useMemo(() => {
    if (!query.trim()) return tree;
    const filtered = filterTree(tree, query);
    // expand all filtered branches
    const keys = collectAllKeys(filtered);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      return next;
    });
    return filtered;
  }, [tree, query]);

  if (isLoading) {
    return (
      <div className={cn("space-y-2 px-2", className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-5 w-full rounded bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h3 className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        知识库
      </h3>
      <div className="relative px-2">
        <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文档"
          className="h-8 pl-8 pr-7 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <ScrollArea className="h-[calc(100vh-16rem)] pr-1">
        <nav className="flex flex-col pb-2">
          {visibleTree.map((node) => (
            <TreeNodeItem
              key={node.key}
              node={node}
              expanded={expanded}
              activeSlug={activeSlug}
              onToggle={toggle}
            />
          ))}
          {visibleTree.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">无匹配文档</p>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
