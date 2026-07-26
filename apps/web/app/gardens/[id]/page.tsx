"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PenLine, FileText } from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { PostContent } from "@/components/post/PostContent";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { postDetailHref } from "@/lib/postHref";

export default function GardenHomePage() {
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  const { data: garden, isLoading, error } = trpc.garden.getById.useQuery(
    { id },
    { placeholderData: keepPreviousData },
  );
  const { data: posts } = trpc.post.list.useQuery({
    page: 1,
    pageSize: 8,
    garden: id,
    orderBy: "updatedAt",
    order: "desc",
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !garden) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10 text-center">
        <p className="text-[var(--kp-text-2)]">知识库不存在或已删除</p>
        <Link href="/gardens" className={cn(buttonVariants(), "mt-4 inline-flex")}>
          返回列表
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 lg:px-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/gardens"
          className="inline-flex items-center gap-1 text-sm text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]"
        >
          <ArrowLeft className="h-4 w-4" />
          全部知识库
        </Link>
        <div className="flex gap-2">
          <Link
            href={`/posts?garden=${encodeURIComponent(id)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex items-center gap-1")}
          >
            <FileText className="h-3.5 w-3.5" />
            全部文章
          </Link>
          <Link
            href={`/editor?garden=${encodeURIComponent(id)}`}
            className={cn(buttonVariants({ size: "sm" }), "inline-flex items-center gap-1")}
          >
            <PenLine className="h-3.5 w-3.5" />
            新建文章
          </Link>
        </div>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)]">{garden.title}</h1>
        <p className="mt-1 font-mono text-xs text-[var(--kp-text-3)]">
          content/{garden.id}/_garden.md
        </p>
        {garden.description && (
          <p className="mt-3 text-sm text-[var(--kp-text-2)]">{garden.description}</p>
        )}
      </header>

      <section className="mb-12 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6 sm:p-8">
        <PostContent content={garden.homeContent || "_（首页暂无正文，可用 garden_update 编辑）_"} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-[var(--kp-text-1)]">最近文章</h2>
        {!posts?.items.length ? (
          <p className="text-sm text-[var(--kp-text-3)]">本库还没有文章。</p>
        ) : (
          <ul className="space-y-2">
            {posts.items.map((p) => (
              <li key={p.id}>
                <Link
                  href={postDetailHref(p.slug, p.garden)}
                  className="block rounded-xl border border-[var(--kp-divider)] px-4 py-3 text-sm transition hover:border-[var(--kp-brand)]/40"
                >
                  <span className="font-medium text-[var(--kp-text-1)]">{p.title}</span>
                  <span className="mt-0.5 block font-mono text-xs text-[var(--kp-text-3)]">{p.slug}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
