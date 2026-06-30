"use client";

import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import { keepPreviousData } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Eye, Edit2, Trash2 } from "lucide-react";
import { PostContent } from "@/components/post/PostContent";
import { TableOfContents } from "@/components/post/TableOfContents";
import { PageSearch } from "@/components/post/PageSearch";
import { PostExportActions } from "@/components/post/PostExportActions";
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
  const router = useRouter();
  const slug = decodeURIComponent(params.slug as string);
  const articleRef = useRef<HTMLElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: post, isLoading } = trpc.post.getBySlug.useQuery(
    { slug },
    { placeholderData: keepPreviousData }
  );

  const { remove } = usePostMutations({
    onDeleteSuccess: () => router.push("/posts"),
  });

  const handleDelete = () => {
    if (!post) return;
    remove.mutate({ id: post.id });
  };

  return (
    <div className="w-full px-[5%] py-8 md:px-[8%] lg:px-[12%] xl:pr-[20rem] 2xl:pr-[22rem]">
        <div className="mb-6">
          <Link
            href="/posts"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            返回文章列表
          </Link>
        </div>

        {isLoading && !post ? (
          <PostSkeleton />
        ) : post ? (
          <>
            <article ref={articleRef}>
              <header className="mb-8">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {post.title}
                </h1>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  {!post.published && (
                    <Badge variant="secondary">草稿</Badge>
                  )}
                  {post.category && (
                    <Link href={`/categories/${encodeURIComponent(post.category)}`}>
                      <Badge variant="secondary" className="cursor-pointer hover:bg-primary/10 hover:text-primary">
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
                    href={`/editor/${post.id}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "ml-auto inline-flex items-center gap-1 text-primary hover:text-primary/80"
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
                      "inline-flex items-center gap-1 text-destructive hover:text-destructive/80"
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                    {remove.isPending ? "删除中…" : "删除"}
                  </button>
                </div>
                {post.tags?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.tags.map((tag: string) => (
                      <Link key={tag} href={`/tags/${encodeURIComponent(tag)}`}>
                        <Badge variant="outline" className="cursor-pointer hover:border-primary/50 hover:text-primary">
                          {tag}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}

                <div className="mt-4 max-w-md">
                  <PageSearch containerRef={articleRef} />
                </div>
              </header>

              <Card>
                <CardContent className="p-6 sm:p-8">
                  <PostContent content={post.content} postSlug={post.slug} />
                </CardContent>
              </Card>
            </article>

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
