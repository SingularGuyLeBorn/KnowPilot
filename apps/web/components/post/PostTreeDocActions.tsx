"use client";

/**
 * 侧栏文档行 hover：+ 新建子文档 · ⋯ 精简菜单
 *（重命名 / 复制链接 / 分享 / 新标签页 / 复制 / 导出 / 置顶 / 删除）
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { postDetailHref } from "@/lib/postHref";
import { exportPostMarkdownZip } from "@/lib/postExport";
import { usePostMutations } from "@/lib/usePostMutations";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/shared";

const PIN_KEY = "kp-post-pins";

export function pinStorageKey(garden: string, slug: string) {
  return `${garden}::${slug}`;
}

export function readPinnedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writePinnedSet(next: Set<string>) {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify([...next]));
  } catch {
    // ignore
  }
}

export function isPostPinned(garden: string, slug: string): boolean {
  return readPinnedSet().has(pinStorageKey(garden, slug));
}

interface PostTreeDocActionsProps {
  postId: string;
  slug: string;
  garden: string;
  title: string;
  onPinnedChange?: () => void;
}

export function PostTreeDocActions({
  postId,
  slug,
  garden,
  title,
  onPinnedChange,
}: PostTreeDocActionsProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const menuRef = useRef<HTMLDivElement>(null);
  const { create, update, remove } = usePostMutations({
    onCreateSuccess: ({ slug: s, garden: g }) => {
      router.push(postDetailHref(s, g));
    },
    onDeleteSuccess: () => {
      setConfirmDelete(false);
    },
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const href = postDetailHref(slug, garden);

  const createChild = () => {
    const leaf = `untitled-${Date.now().toString(36).slice(-5)}`;
    const childSlug = `${slug}/${leaf}`;
    create.mutate({
      title: "未命名",
      slug: childSlug,
      garden,
      content: "",
      published: true,
    });
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
    setMenuOpen(false);
  };

  const share = async () => {
    const url = `${window.location.origin}${href}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // ignore cancel
    }
    setMenuOpen(false);
  };

  const openNewTab = () => {
    window.open(href, "_blank", "noopener,noreferrer");
    setMenuOpen(false);
  };

  const copyDoc = async () => {
    try {
      const post = await utils.post.getBySlug.fetch({ slug, garden });
      if (!post) return;
      const text = `# ${post.title}\n\n${post.content}`;
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    setMenuOpen(false);
  };

  const exportMd = async () => {
    try {
      const post = await utils.post.getBySlug.fetch({ slug, garden });
      if (!post) return;
      await exportPostMarkdownZip({
        title: post.title,
        slug: post.slug,
        content: post.content,
        excerpt: post.excerpt,
        category: post.category,
        tags: post.tags,
        published: post.published,
      });
    } catch {
      // ignore
    }
    setMenuOpen(false);
  };

  const togglePin = () => {
    const key = pinStorageKey(garden, slug);
    const set = readPinnedSet();
    if (set.has(key)) set.delete(key);
    else set.add(key);
    writePinnedSet(set);
    onPinnedChange?.();
    setMenuOpen(false);
  };

  const submitRename = () => {
    const next = renameValue.trim();
    if (!next || next === title) {
      setRenaming(false);
      return;
    }
    update.mutate({ id: postId, title: next });
    setRenaming(false);
    setMenuOpen(false);
  };

  const pinned = isPostPinned(garden, slug);

  return (
    <div
      className="relative ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
      onClick={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title="新建子文档"
        aria-label="新建子文档"
        disabled={create.isPending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          createChild();
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-soft)] hover:text-[var(--kp-brand-deep)]"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="更多"
        aria-label="更多"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-soft)] hover:text-[var(--kp-text-1)]"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1 shadow-lg"
          role="menu"
        >
          {renaming ? (
            <div className="px-2 py-1.5">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={submitRename}
                className="w-full rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] px-2 py-1 text-xs outline-none"
              />
            </div>
          ) : (
            <>
              <MenuItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="重命名"
                onClick={() => {
                  setRenameValue(title);
                  setRenaming(true);
                }}
              />
              <MenuItem icon={<Link2 className="h-3.5 w-3.5" />} label="复制链接" onClick={() => void copyLink()} />
              <MenuItem icon={<Share2 className="h-3.5 w-3.5" />} label="分享" onClick={() => void share()} />
              <MenuItem icon={<ExternalLink className="h-3.5 w-3.5" />} label="新标签页打开" onClick={openNewTab} />
              <MenuItem icon={<Copy className="h-3.5 w-3.5" />} label="复制" onClick={() => void copyDoc()} />
              <MenuItem icon={<Download className="h-3.5 w-3.5" />} label="导出" onClick={() => void exportMd()} />
              <MenuItem
                icon={<Pin className={cn("h-3.5 w-3.5", pinned && "text-[var(--kp-brand-deep)]")} />}
                label={pinned ? "取消置顶" : "置顶"}
                onClick={togglePin}
              />
              <div className="my-1 border-t border-[var(--kp-divider)]" />
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="删除"
                danger
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              />
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="删除文章"
        description={`确定删除《${title}》吗？可在回收站恢复。`}
        confirmLabel={remove.isPending ? "删除中…" : "确认删除"}
        isDestructive
        onConfirm={() => remove.mutate({ id: postId })}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition",
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-[var(--kp-text-1)] hover:bg-[var(--kp-bg-mute)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
