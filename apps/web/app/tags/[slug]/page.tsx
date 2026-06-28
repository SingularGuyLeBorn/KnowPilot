"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, Eye, Hash } from "lucide-react";
import { Shell } from "@/components/layout/Shell";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";

export default function TagPage() {
  const params = useParams();
  const slug = decodeURIComponent(params.slug as string);

  const { data, isLoading } = trpc.post.list.useQuery({
    published: true,
    tag: slug,
    pageSize: 100,
    orderBy: "updatedAt",
    order: "desc",
  });

  return (
    <Shell>
      <div className="w-full px-[5%] py-8 md:px-[8%] lg:px-[10%] xl:px-[12%]">
        <div className="mb-8">
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
          <div className="mt-4 flex items-center gap-3">
            <Hash className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{slug}</h1>
              <p className="mt-1 text-sm text-muted-foreground">共 {data?.total ?? 0} 篇文章</p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <PostRowSkeleton key={i} />
            ))}
          </div>
        ) : data?.items.length ? (
          <div className="space-y-3">
            {data.items.map((post) => (
              <PostRow key={post.id} post={post} />
            ))}
          </div>
        ) : (
          <EmptyState tag={slug} />
        )}
      </div>
    </Shell>
  );
}

interface PostListItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  category: string | null;
  tags: string[];
  viewCount: number;
  updatedAt: Date | string;
}

function PostRow({ post }: { post: PostListItem }) {
  return (
    <Link href={`/posts/${encodeURIComponent(post.slug)}`} className="group block">
      <Card className="transition-all hover:-translate-y-[2px] hover:border-primary/20 hover:bg-accent hover:shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg group-hover:text-primary">{post.title}</CardTitle>
          <CardDescription className="line-clamp-2">
            {post.excerpt || (post.content ? post.content.slice(0, 160) : "") + (post.content && post.content.length > 160 ? "..." : "")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {post.category && <Badge variant="secondary">{post.category}</Badge>}
            {post.tags?.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className={cn(tag === post.tags?.find((t) => t === tag) && "border-primary/50 text-primary")}
              >
                {tag}
              </Badge>
            ))}
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(post.updatedAt).toLocaleDateString("zh-CN")}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {post.viewCount} 阅读
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PostRowSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardHeader>
    </Card>
  );
}

function EmptyState({ tag }: { tag: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <p className="text-muted-foreground">标签「{tag}」下还没有文章</p>
        <Link href="/posts" className={cn(buttonVariants(), "mt-4")}>
          浏览全部文章
        </Link>
      </CardContent>
    </Card>
  );
}
