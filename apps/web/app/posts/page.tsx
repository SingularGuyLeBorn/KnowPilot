"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PenLine, Calendar, Eye, FolderOpen, Hash } from "lucide-react";
import { Shell } from "@/components/layout/Shell";
import { trpc } from "@/lib/trpc";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TagCloud } from "@/components/post/TagCloud";
import { CategoryList } from "@/components/post/CategoryList";

export default function PostsPage() {
  const { data, isLoading } = trpc.post.list.useQuery({
    published: true,
    pageSize: 50,
    orderBy: "updatedAt",
    order: "desc",
  });

  return (
    <Shell>
      <div className="w-full px-[5%] py-8 md:px-[8%] lg:px-[10%] xl:px-[12%]">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">文章</h1>
            <p className="mt-1 text-sm text-muted-foreground">共 {data?.total ?? 0} 篇已发布文章</p>
          </div>
          <Link
            href="/editor/new"
            className={cn(buttonVariants(), "inline-flex items-center gap-2")}
          >
            <PenLine className="h-4 w-4" />
            写文章
          </Link>
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
          <EmptyState />
        )}

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
              <FolderOpen className="h-5 w-5 text-primary" />
              分类
            </h2>
            <CategoryList />
          </section>
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
              <Hash className="h-5 w-5 text-primary" />
              标签云
            </h2>
            <TagCloud />
          </section>
        </div>
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
  viewCount: number;
  updatedAt: Date | string;
}

function PostRow({ post }: { post: PostListItem }) {
  const router = useRouter();
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
            {post.category && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  router.push(`/categories/${encodeURIComponent(post.category!)}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/categories/${encodeURIComponent(post.category!)}`);
                  }
                }}
              >
                <Badge variant="secondary" className="cursor-pointer hover:bg-primary/10 hover:text-primary">
                  {post.category}
                </Badge>
              </span>
            )}
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

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <p className="text-muted-foreground">还没有已发布的文章</p>
        <Link href="/editor/new" className={cn(buttonVariants(), "mt-4")}>
          写第一篇
        </Link>
      </CardContent>
    </Card>
  );
}
