"use client";

import { useParams, useRouter } from "next/navigation";
import { useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, Eye, Edit2, Trash2 } from "lucide-react";
import { Shell } from "@/components/layout/Shell";
import { MarkdownRenderer } from "@/components/post/MarkdownRenderer";
import { TableOfContents } from "@/components/post/TableOfContents";
import { PageSearch } from "@/components/post/PageSearch";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = decodeURIComponent(params.slug as string);
  const articleRef = useRef<HTMLElement>(null);

  const { data: post, isLoading } = trpc.post.getBySlug.useQuery({ slug });
  const utils = trpc.useUtils();

  const deletePost = trpc.post.delete.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        utils.post.list.invalidate();
        utils.post.tree.invalidate();
        router.push("/posts");
      } else {
        alert(`删除失败：${result.error?.message || "未知错误"}`);
      }
    },
    onError: (error) => {
      alert(`删除失败：${error.message}`);
    },
  });

  const handleDelete = () => {
    if (!post) return;
    if (!window.confirm(`确定要删除文章《${post.title}》吗？此操作不可恢复。`)) return;
    deletePost.mutate({ id: post.id });
  };

  return (
    <Shell>
      <div className="w-full px-[5%] py-8 md:px-[8%] lg:px-[12%] xl:pr-[19rem] 2xl:pr-[21rem]">
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

        {isLoading ? (
          <PostSkeleton />
        ) : post ? (
          <>
            <article ref={articleRef}>
              <header className="mb-8">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {post.title}
                </h1>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
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
                    onClick={handleDelete}
                    disabled={deletePost.isPending}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "inline-flex items-center gap-1 text-destructive hover:text-destructive/80"
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                    {deletePost.isPending ? "删除中…" : "删除"}
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
                  <MarkdownRenderer content={post.content} postSlug={post.slug} />
                </CardContent>
              </Card>
            </article>

            <TableOfContents content={post.content} />
          </>
        ) : (
          <NotFound />
        )}
      </div>
    </Shell>
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
