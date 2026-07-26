"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import type { Post } from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { usePostMutations } from "@/lib/hooks";
import { postDetailHref } from "@/lib/postHref";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Pagination, ConfirmDialog, EmptyState, LoadingState } from "@/components/shared";

type PublishFilter = "all" | "published" | "draft";

export default function PostsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gardenFromUrl = searchParams.get("garden") || "";
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [publishFilter, setPublishFilter] = useState<PublishFilter>("all");
  /** URL ?garden= 优先；本地切换时用 state，点「全部」清 URL */
  const [gardenOverride, setGardenOverride] = useState<string | null>(null);
  const gardenFilter = gardenOverride ?? (gardenFromUrl || "all");
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(id);
  }, [keyword]);

  const { data: gardens } = trpc.garden.list.useQuery({ page: 1, pageSize: 100 });

  const publishedParam =
    publishFilter === "all" ? undefined : publishFilter === "published";

  const { data, isLoading, isFetching } = trpc.post.list.useQuery({
    page,
    pageSize: 10,
    keyword: debouncedKeyword || undefined,
    published: publishedParam,
    garden: gardenFilter === "all" ? undefined : gardenFilter,
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

  const gardenTitle = (id: string) =>
    gardens?.items.find((g) => g.id === id)?.title ?? id;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)]">文章管理</h1>
            <p className="mt-1 text-sm text-[var(--kp-text-3)]">
              共 {data?.total ?? 0} 篇
              {gardenFilter !== "all" ? ` · ${gardenTitle(gardenFilter)}` : ""}
              {isFetching && !isLoading ? " · 刷新中…" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/gardens"
              className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-2 text-xs")}
            >
              知识库
            </Link>
            <Link
              href="/posts/trash"
              className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-2 text-xs")}
            >
              <Trash2 className="h-4 w-4" />
              回收站
            </Link>
            <Link
              href={
                gardenFilter !== "all"
                  ? `/editor?garden=${encodeURIComponent(gardenFilter)}`
                  : "/editor"
              }
              className={cn(buttonVariants(), "inline-flex items-center gap-2")}
            >
              <PenLine className="h-4 w-4" />
              新建文章
            </Link>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-1">
          <button
            type="button"
            onClick={() => {
              setGardenOverride("all");
              setPage(1);
              router.replace("/posts");
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs transition",
              gardenFilter === "all"
                ? "bg-[var(--kp-brand)] text-white"
                : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
            )}
          >
            全部花园
          </button>
          {(gardens?.items ?? []).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                setGardenOverride(g.id);
                setPage(1);
                router.replace(`/posts?garden=${encodeURIComponent(g.id)}`);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs transition",
                gardenFilter === g.id
                  ? "bg-[var(--kp-brand)] text-white"
                  : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
              )}
            >
              {g.title}
            </button>
          ))}
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
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setPublishFilter(value);
                  setPage(1);
                }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs transition",
                  publishFilter === value
                    ? "bg-[var(--kp-brand)] text-white"
                    : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <LoadingState />
        ) : !data?.items.length ? (
          <EmptyState
            title="暂无文章"
            description="换一个花园，或点击「新建文章」开始写作"
            icon={<FileText className="h-6 w-6" />}
          />
        ) : (
          <>
            <div className="space-y-4">
              {data.items.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  gardenLabel={gardenTitle(post.garden)}
                  onDelete={() => setDeleteTarget(post)}
                  deleting={remove.isPending && deleteTarget?.id === post.id}
                />
              ))}
            </div>
            <div className="mt-8">
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={setPage}
              />
            </div>
          </>
        )}

        <ConfirmDialog
          isOpen={!!deleteTarget}
          title="删除文章"
          description={`确定将「${deleteTarget?.title ?? ""}」移入回收站？`}
          confirmLabel="删除"
          isDestructive
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
    </div>
  );
}

function PostRow({
  post,
  gardenLabel,
  onDelete,
  deleting,
}: {
  post: Post;
  gardenLabel: string;
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
            <Badge variant="outline" className="text-xs">
              {gardenLabel}
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
            href={postDetailHref(post.slug, post.garden)}
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
            href={postDetailHref(post.slug, post.garden)}
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
            onClick={onDelete}
            disabled={deleting}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "inline-flex items-center gap-1 text-sm text-destructive hover:text-destructive"
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "…" : "删除"}
          </button>
        </div>
      </div>
    </article>
  );
}
