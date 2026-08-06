"use client";

import { Suspense, useEffect, useState } from "react";
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
  ArrowUpRight,
} from "lucide-react";
import { motion } from "framer-motion";
import type { Post } from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { usePostMutations } from "@/lib/usePostMutations";
import { formatGardenId } from "@/lib/gardenDisplay";
import { postDetailHref } from "@/lib/postHref";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Pagination, ConfirmDialog, EmptyState, LoadingState, TagFilterBar } from "@/components/shared";
import { ContinueReadingCard } from "@/components/post/ContinueReading";
import { GlassTiltCard } from "@/components/motion/GlassTiltCard";

type PublishFilter = "all" | "published" | "draft";

function PostsPageContent() {
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
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);

  // 空闲预热 Milkdown 编辑器 chunk：列表页是切文主入口，预热后首次打开文章省动态 chunk 下载
  useEffect(() => {
    const t = window.setTimeout(() => {
      import("@/components/editor/MilkdownEditor").catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(id);
  }, [keyword]);

  const { data: gardens } = trpc.garden.list.useQuery({ page: 1, pageSize: 100 });
  const { data: tagFacets = [] } = trpc.search.tagFacets.useQuery({
    entities: ["post"],
    limit: 40,
  });

  const publishedParam =
    publishFilter === "all" ? undefined : publishFilter === "published";

  const { data, isLoading, isFetching } = trpc.post.list.useQuery({
    page,
    pageSize: 10,
    keyword: debouncedKeyword || undefined,
    published: publishedParam,
    garden: gardenFilter === "all" ? undefined : gardenFilter,
    tag: tagFilter ?? undefined,
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
    gardens?.items.find((g) => g.id === id)?.title ?? formatGardenId(id);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <h1 className="kp-display-serif text-3xl text-[var(--kp-text-1)]">全部文章</h1>
          <p className="mt-1 text-sm text-[var(--kp-text-3)]">
            跨库列表 · 共 {data?.total ?? 0} 篇
            {gardenFilter !== "all" ? ` · ${gardenTitle(gardenFilter)}` : ""}
            {isFetching && !isLoading ? " · 刷新中…" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/gardens"
            className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-2 text-xs")}
          >
            返回知识库
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
      </motion.div>

      <ContinueReadingCard
        garden={gardenFilter === "all" ? null : gardenFilter}
        className="mb-6"
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 flex flex-wrap gap-1.5 rounded-2xl border border-white/50 bg-white/40 p-1.5 backdrop-blur-xl shadow-[0_4px_16px_-8px_rgba(0,135,235,0.12)]"
      >
        <button
          type="button"
          onClick={() => {
            setGardenOverride("all");
            setPage(1);
            router.replace("/posts");
          }}
          className={cn(
            "rounded-xl px-3 py-1.5 text-xs font-medium transition",
            gardenFilter === "all"
              ? "bg-gradient-to-r from-[var(--kp-brand-deep)] to-[var(--kp-brand)] text-white shadow-sm"
              : "text-[var(--kp-text-2)] hover:bg-white/60",
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
              "rounded-xl px-3 py-1.5 text-xs font-medium transition",
              gardenFilter === g.id
                ? "bg-gradient-to-r from-[var(--kp-brand-deep)] to-[var(--kp-brand)] text-white shadow-sm"
                : "text-[var(--kp-text-2)] hover:bg-white/60",
            )}
          >
            {g.title}
          </button>
        ))}
      </motion.div>

      <TagFilterBar
        className="mb-4"
        facets={tagFacets}
        value={tagFilter}
        onChange={(t) => {
          setTagFilter(t);
          setPage(1);
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/50 bg-white/40 p-4 shadow-[0_4px_16px_-8px_rgba(0,135,235,0.12)] backdrop-blur-xl sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
          <Input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="搜索标题或 slug…"
            className="h-10 border-[var(--kp-divider)] bg-white/60 pl-9 pr-9 text-sm backdrop-blur-sm transition focus:bg-white"
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
        <div className="flex shrink-0 gap-1 rounded-xl border border-[var(--kp-divider)] bg-white/50 p-1 backdrop-blur-sm">
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
                "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                publishFilter === value
                  ? "bg-gradient-to-r from-[var(--kp-brand-deep)] to-[var(--kp-brand)] text-white shadow-sm"
                  : "text-[var(--kp-text-2)] hover:bg-white/70",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </motion.div>

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
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.06 } },
              hidden: {},
            }}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {data.items.map((post, idx) => (
              <PostCard
                key={post.id}
                post={post}
                gardenLabel={gardenTitle(post.garden)}
                onDelete={() => setDeleteTarget(post)}
                deleting={remove.isPending && deleteTarget?.id === post.id}
                featured={idx === 0 && data.page === 1 && !keyword && !tagFilter}
              />
            ))}
          </motion.div>
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

function PostCard({
  post,
  gardenLabel,
  onDelete,
  deleting,
  featured,
}: {
  post: Post;
  gardenLabel: string;
  onDelete: () => void;
  deleting: boolean;
  featured?: boolean;
}) {
  const router = useRouter();

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 24, scale: 0.97 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { type: "spring", stiffness: 220, damping: 22 },
        },
      }}
      className={cn(
        "min-w-0",
        featured && "md:col-span-2 xl:col-span-2 xl:row-span-2",
      )}
    >
      <GlassTiltCard className={cn("group h-full", featured ? "p-6" : "p-5")}>
        <article data-testid="post-card" className="flex h-full flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge
              variant={post.published ? "default" : "secondary"}
              className={cn(
                "text-xs",
                post.published
                  ? "bg-gradient-to-r from-emerald-500/15 to-emerald-500/5 text-emerald-700 hover:from-emerald-500/20"
                  : "",
              )}
            >
              {post.published ? "已发布" : "草稿"}
            </Badge>
            <Badge variant="outline" className="text-xs border-[var(--kp-divider)] bg-white/40">
              {gardenLabel}
            </Badge>
            {post.category && (
              <Badge
                variant="outline"
                className="cursor-pointer text-xs border-[var(--kp-divider)] bg-white/40 hover:border-[var(--kp-brand)]/40"
                onClick={() => router.push(`/categories/${encodeURIComponent(post.category!)}`)}
              >
                {post.category}
              </Badge>
            )}
            {featured && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--kp-accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--kp-accent-deep)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--kp-accent)] animate-pulse" />
                最新
              </span>
            )}
          </div>

          <Link
            href={postDetailHref(post.slug, post.garden)}
            className={cn(
              "block font-semibold text-[var(--kp-text-1)] transition hover:text-[var(--kp-brand-deep)]",
              featured ? "kp-display-serif text-xl md:text-2xl" : "text-lg",
            )}
          >
            {post.title}
          </Link>
          <p
            className={cn(
              "mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--kp-text-2)]",
              featured && "line-clamp-3 md:text-base",
            )}
          >
            {post.excerpt ||
              (post.content ? `${post.content.slice(0, featured ? 260 : 160)}${post.content.length > (featured ? 260 : 160) ? "…" : ""}` : "暂无摘要")}
          </p>

          <div className="mt-auto pt-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--kp-text-3)]">
              <span className="kp-glass-pill">
                <Calendar className="h-3 w-3" />
                {new Date(post.updatedAt).toLocaleDateString("zh-CN")}
              </span>
              <span className="kp-glass-pill">
                <Eye className="h-3 w-3" />
                {post.viewCount} 阅读
              </span>
              {featured && (
                <span className="truncate font-mono text-[11px] text-[var(--kp-text-3)]">{post.slug}</span>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Link
                href={postDetailHref(post.slug, post.garden)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[var(--kp-brand-deep)] to-[var(--kp-brand)] py-2 text-xs font-medium text-white shadow-md shadow-[rgba(0,135,235,0.18)] transition hover:opacity-95",
                )}
              >
                <Edit2 className="h-3.5 w-3.5" />
                打开
                <ArrowUpRight className="h-3 w-3 opacity-70" />
              </Link>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="rounded-xl border border-[var(--kp-divider)] bg-white/50 px-3 py-2 text-xs text-red-500 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </article>
      </GlassTiltCard>
    </motion.div>
  );
}

// useSearchParams 需 Suspense 边界，否则 Next 16 下整页 CSR bailout
export default function PostsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--kp-text-3)]">
          加载文章列表…
        </div>
      }
    >
      <PostsPageContent />
    </Suspense>
  );
}
