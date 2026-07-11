"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PenLine,
  Calendar,
  Eye,
  Edit2,
  Trash2,
  Search,
  X,
  FileText,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePostMutations } from "@/lib/hooks";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Pagination, ConfirmDialog, EmptyState, LoadingState } from "@/components/shared";
import type { Post } from "@knowpilot/shared";

type PublishFilter = "all" | "published" | "draft";

export default function PostsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [publishFilter, setPublishFilter] = useState<PublishFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);

  // 简单防抖，避免每次击键都请求
  useEffect(() => {
    const id = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(id);
  }, [keyword]);

  const publishedParam =
    publishFilter === "all" ? undefined : publishFilter === "published";

  const { data, isLoading, isFetching } = trpc.post.list.useQuery({
    page,
    pageSize: 10,
    keyword: debouncedKeyword || undefined,
    published: publishedParam,
    orderBy: "updatedAt",
    order: "desc",
  });

  const { remove } = usePostMutations({
    onDeleteSuccess: () => {
      setDeleteTarget(null);
      if (data && data.items.length === 1 && page > 1) {
        setPage((p) => p - 1);
      }
    },
  });

  const handleDelete = () => {
    if (!deleteTarget) return;
    remove.mutate({ id: deleteTarget.id });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)]">文章管理</h1>
            <p className="mt-1 text-sm text-[var(--kp-text-3)]">
              共 {data?.total ?? 0} 篇
              {isFetching && !isLoading ? " · 刷新中…" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/posts/trash"
              className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-2 text-xs")}
            >
              <Trash2 className="h-4 w-4" />
              回收站
            </Link>
            <Link href="/editor" className={cn(buttonVariants(), "inline-flex items-center gap-2")}>
              <PenLine className="h-4 w-4" />
              新建文章
            </Link>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
            <Input
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              placeholder="搜索标题或 slug…"
              className="h-10 border-[var(--kp-divider)] bg-[var(--kp-bg)] pl-9 pr-9 text-sm"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => {
                  setKeyword("");
                  setPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex shrink-0 gap-1 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-1">
            {(
              [
                ["all", "全部"],
                ["published", "已发布"],
                ["draft", "草稿"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPublishFilter(key);
                  setPage(1);
                }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  publishFilter === key
                    ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                    : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <LoadingState count={5} />
        ) : !data?.items.length ? (
          <EmptyState
            title="没有找到文章"
            description={
              debouncedKeyword
                ? "试试更换关键词，或清除筛选条件。"
                : "创建第一篇文章，开始搭建你的知识库。"
            }
            icon={<FileText className="h-6 w-6" />}
            actionLabel="新建文章"
            onAction={() => router.push("/editor")}
          />
        ) : (
          <>
            <div className="space-y-3">
              {data.items.map((post) => (
                <PostRow
                  key={post.id}
                  post={post as Post}
                  onDelete={() => setDeleteTarget(post as Post)}
                  deleting={remove.isPending && deleteTarget?.id === post.id}
                />
              ))}
            </div>
            {data.totalPages > 1 && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={setPage}
              />
            )}
          </>
        )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="删除文章"
        description={
          deleteTarget
            ? `确定删除《${deleteTarget.title}》吗？文章将移入回收站，可在 30 天内恢复。`
            : ""
        }
        confirmLabel={remove.isPending ? "删除中…" : "确认删除"}
        isDestructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function PostRow({
  post,
  onDelete,
  deleting,
}: {
  post: Post;
  onDelete: () => void;
  deleting: boolean;
}) {
  const router = useRouter();

  return (
    <article data-testid="post-card" className="group rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 transition hover:border-[var(--kp-brand)]/30 hover:shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant={post.published ? "default" : "secondary"} className="text-xs">
              {post.published ? "已发布" : "草稿"}
            </Badge>
            {post.category && (
              <Badge
                variant="outline"
                className="cursor-pointer text-xs hover:border-[var(--kp-brand)]/40"
                onClick={() => router.push(`/categories/${encodeURIComponent(post.category!)}`)}
              >
                {post.category}
              </Badge>
            )}
          </div>
          <Link
            href={`/posts/${encodeURIComponent(post.slug)}`}
            className="block text-lg font-semibold text-[var(--kp-text-1)] transition hover:text-[var(--kp-brand-deep)]"
          >
            {post.title}
          </Link>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--kp-text-2)]">
            {post.excerpt ||
              (post.content ? `${post.content.slice(0, 160)}${post.content.length > 160 ? "…" : ""}` : "暂无摘要")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--kp-text-3)]">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(post.updatedAt).toLocaleDateString("zh-CN")}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {post.viewCount} 阅读
            </span>
            <span className="truncate font-mono text-[11px]">{post.slug}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/posts/${encodeURIComponent(post.slug)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-sm")}
          >
            阅读
          </Link>
          <Link
            href={`/editor/${post.id}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "inline-flex items-center gap-1 text-sm"
            )}
          >
            <Edit2 className="h-3.5 w-3.5" />
            编辑
          </Link>
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "inline-flex items-center gap-1 text-sm text-destructive hover:text-destructive"
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </div>
      </div>
    </article>
  );
}
