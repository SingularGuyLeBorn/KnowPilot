"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { keepPreviousData } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { DEFAULT_POST_GARDEN, isValidGardenIdFormat } from "@knowpilot/shared";
import { PostLiveDoc } from "@/components/post/PostLiveDoc";
import { trpc, catchUnlessCancelled } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PostDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const slug = decodeURIComponent(params.slug as string);
  const gardenParam = searchParams.get("garden") ?? DEFAULT_POST_GARDEN;
  const garden = isValidGardenIdFormat(gardenParam) ? gardenParam : DEFAULT_POST_GARDEN;
  const utils = trpc.useUtils();
  const recordView = trpc.post.recordView.useMutation();
  const viewedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (garden === DEFAULT_POST_GARDEN && slug.startsWith("llm-guide/")) {
      const nextSlug = slug.slice("llm-guide/".length);
      router.replace(
        `/posts/${encodeURIComponent(nextSlug)}?garden=${encodeURIComponent("llm-guide")}`,
      );
    }
  }, [garden, slug, router]);

  const { data: post, isPending, isFetching } = trpc.post.getBySlug.useQuery(
    { slug, garden },
    {
      enabled: !(garden === DEFAULT_POST_GARDEN && slug.startsWith("llm-guide/")),
      staleTime: 5 * 60 * 1000,
      // 切文时保留上一篇，避免卸掉整页再挂骨架/编辑器
      placeholderData: keepPreviousData,
    },
  );
  const postMatchesRoute =
    !!post && post.slug === slug && (post.garden ?? DEFAULT_POST_GARDEN) === garden;

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
      // ignore
    }
    viewedIdsRef.current.add(post.id);
    recordView
      .mutateAsync({ id: post.id })
      .then((res) => {
        utils.post.getBySlug.setData({ slug: post.slug, garden: post.garden }, (prev) =>
          prev ? { ...prev, viewCount: res.viewCount } : prev,
        );
      })
      .catch(catchUnlessCancelled("app/posts/[slug]/page.tsx"));
  }, [post?.id, post?.slug, post?.garden, utils, recordView]);

  if (showSkeleton && !post) {
    return (
      <div className="w-full px-4 py-8 sm:px-5 lg:px-6">
        <PostSkeleton />
      </div>
    );
  }

  if (postMatchesRoute && post) {
    return <PostLiveDoc key={post.id} post={post} />;
  }

  // 仍在拉新文：留上一篇（placeholder）或轻占位，不闪空
  if (isPending || isFetching) {
    if (post) {
      return (
        <div className="pointer-events-none opacity-60 transition-opacity">
          <PostLiveDoc key={post.id} post={post} />
        </div>
      );
    }
    return <div className="min-h-[40vh]" aria-hidden />;
  }

  return (
    <div className="w-full px-4 py-8 sm:px-5 lg:px-6">
      <NotFound />
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
        <p className="mt-2 text-sm text-muted-foreground">这篇文章可能已被删除或尚未同步。</p>
        <Link href="/posts" className={cn(buttonVariants(), "mt-4 inline-flex items-center gap-2")}>
          <ArrowLeft className="h-4 w-4" />
          返回文章列表
        </Link>
      </CardContent>
    </Card>
  );
}
