"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, Eye, Edit2, Trash2 } from "lucide-react";
import { DEFAULT_POST_GARDEN, isValidGardenIdFormat } from "@knowpilot/shared";
import { PostContent } from "@/components/post/PostContent";
import { TableOfContents, usePostTocVisible } from "@/components/post/TableOfContents";
import { PageSearch } from "@/components/post/PageSearch";
import { PostExportActions } from "@/components/post/PostExportActions";
import { ReadingProgressTracker } from "@/components/post/ReadingProgressTracker";
import { trpc } from "@/lib/trpc";
import { usePostMutations } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared";

export default function PostDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const slug = decodeURIComponent(params.slug as string);
  const gardenParam = searchParams.get("garden") ?? DEFAULT_POST_GARDEN;
  const garden = isValidGardenIdFormat(gardenParam) ? gardenParam : DEFAULT_POST_GARDEN;
  const articleRef = useRef<HTMLElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const tocVisible = usePostTocVisible();
  const utils = trpc.useUtils();
  const recordView = trpc.post.recordView.useMutation();
  const viewedIdsRef = useRef<Set<string>>(new Set());

  // 旧路径兼容：曾误放在博客花园下的 LLM Guide → 独立花园 llm-guide
  useEffect(() => {
    if (garden === DEFAULT_POST_GARDEN && slug.startsWith("llm-guide/")) {
      const nextSlug = slug.slice("llm-guide/".length);
      router.replace(
        `/posts/${encodeURIComponent(nextSlug)}?garden=${encodeURIComponent("llm-guide")}`,
      );
    }
  }, [garden, slug, router]);

  // 不用 keepPreviousData：避免先闪旧文再跳新文。侧栏 hover 预取命中缓存则瞬时切换。
  const { data: post, isPending } = trpc.post.getBySlug.useQuery(
    { slug, garden },
    {
      enabled: !(garden === DEFAULT_POST_GARDEN && slug.startsWith("llm-guide/")),
      staleTime: 5 * 60 * 1000,
    },
  );

  // 慢请求才出骨架，快切换（预取命中）不闪白
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!isPending || post) {
      const t = window.setTimeout(() => {
        if (alive) setShowSkeleton(false);
      }, 0);
      return () => {
        alive = false;
        window.clearTimeout(t);
      };
    }
    const t = window.setTimeout(() => {
      if (alive) setShowSkeleton(true);
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [isPending, post, slug, garden]);

  // 阅读计数与 getBySlug 分离；同会话同文只记一次
  useEffect(() => {
    if (!post?.id) return;
    if (viewedIdsRef.current.has(post.id)) return;
    try {
      const key = `kp-post-view:${post.id}`;
      if (sessionStorage.getItem(key) === "1") {
        viewedIdsRef.current.add(post.id);
        return;
      }
      sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage 不可用时仍用 ref 防同页重复
    }
    viewedIdsRef.current.add(post.id);
    recordView.mutateAsync({ id: post.id })
      .then((res) => {
        utils.post.getBySlug.setData({ slug: post.slug, garden: post.garden }, (prev) =>
          prev ? { ...prev, viewCount: res.viewCount } : prev,
        );
      })
      .catch(() => {});
  }, [post?.id, post?.slug, post?.garden, utils, recordView]);

  const { remove } = usePostMutations({
    onDeleteSuccess: () => router.push("/posts"),
  });

  const handleDelete = () => {
    if (!post) return;
    remove.mutate({ id: post.id });
  };

  return (
    <div
      className={cn(
        /* 左侧已有 PostSidebar，勿再用大比例水平 padding 拉出空隙 */
        "w-full px-4 py-8 sm:px-5 lg:px-6",
        tocVisible && "xl:pr-[20rem] 2xl:pr-[22rem]",
      )}
    >
      {showSkeleton && !post ? (
        <PostSkeleton />
      ) : post ? (
        <>
          <article ref={articleRef} key={post.id} className="kp-post-swap">
            {/* 半固定顶栏：相对 main 滚动容器 sticky，不随正文滚走 */}
            <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-border/70 bg-[var(--kp-bg)]/92 px-4 pb-3 pt-1 backdrop-blur-md sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6">
              <div className="mb-3 pt-1">
                <Link
                  href={
                    post.garden && post.garden !== DEFAULT_POST_GARDEN
                      ? `/gardens/${encodeURIComponent(post.garden)}`
                      : "/posts"
                  }
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ArrowLeft className="h-4 w-4" />
                  返回
                </Link>
              </div>
              <ReadingProgressTracker
                postId={post.id}
                slug={post.slug}
                garden={post.garden}
                title={post.title}
                articleRef={articleRef}
              />
              <header>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {post.title}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {!post.published && <Badge variant="secondary">草稿</Badge>}
                  {post.category && (
                    <Link href={`/categories/${encodeURIComponent(post.category)}`}>
                      <Badge
                        variant="secondary"
                        className="cursor-pointer hover:bg-primary/10 hover:text-primary"
                      >
                        {post.category}
                      </Badge>
                    </Link>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {new Date(post.updatedAt).toLocaleDateString("zh-CN")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="h-4 w-4" />
                    {post.viewCount} 阅读
                  </span>
                  <PostExportActions
                    post={{
                      title: post.title,
                      slug: post.slug,
                      content: post.content,
                      excerpt: post.excerpt,
                      category: post.category,
                      tags: post.tags,
                      published: post.published,
                    }}
                    articleRef={articleRef}
                  />
                  <Link
                    href={`/editor/${post.id}?garden=${encodeURIComponent(post.garden)}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "ml-auto inline-flex items-center gap-1 text-primary hover:text-primary/80",
                    )}
                  >
                    <Edit2 className="h-4 w-4" />
                    编辑
                  </Link>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={remove.isPending}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "inline-flex items-center gap-1 text-destructive hover:text-destructive/80",
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                    {remove.isPending ? "删除中…" : "删除"}
                  </button>
                </div>
                {post.tags?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {post.tags.map((tag: string) => (
                      <Link key={tag} href={`/tags/${encodeURIComponent(tag)}`}>
                        <Badge
                          variant="outline"
                          className="cursor-pointer hover:border-primary/50 hover:text-primary"
                        >
                          {tag}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </header>
            </div>

            <Card>
              <CardContent className="p-6 sm:p-8">
                <PostContent content={post.content} postSlug={post.slug} postGarden={post.garden} />
              </CardContent>
            </Card>
          </article>

          <PageSearch containerRef={articleRef} />
          <TableOfContents content={post.content} />

          <ConfirmDialog
            isOpen={confirmOpen}
            title="删除文章"
            description={`确定要删除《${post.title}》吗？此操作不可恢复。`}
            confirmLabel={remove.isPending ? "删除中…" : "确认删除"}
            isDestructive
            onConfirm={handleDelete}
            onCancel={() => setConfirmOpen(false)}
          />
        </>
      ) : isPending ? (
        <div className="min-h-[40vh]" aria-hidden />
      ) : (
        <NotFound />
      )}
    </div>
  );
}

function PostSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function NotFound() {
  return (
    <Card className="border-dashed">
      <CardContent className="p-12 text-center">
        <h2 className="text-lg font-semibold text-foreground">文章不存在</h2>
        <p className="mt-2 text-sm text-muted-foreground">这篇文章可能已被删除或尚未发布。</p>
        <Link href="/posts" className={cn(buttonVariants(), "mt-4 inline-flex items-center gap-2")}>
          <ArrowLeft className="h-4 w-4" />
          返回文章列表
        </Link>
      </CardContent>
    </Card>
  );
}
