"use client";

/**
 * 文章页 = 编辑页：所见即所得，自动保存。
 * 删除/重命名等管理操作在左侧目录 hover 菜单里。
 */

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, Eye } from "lucide-react";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";
import { MilkdownStyles } from "@/components/editor/MilkdownEditor";
import { TableOfContents, usePostTocVisible } from "@/components/post/TableOfContents";
import { PageSearch } from "@/components/post/PageSearch";
import { SelectionExplain } from "@/components/post/SelectionExplain";
import { PostExportActions } from "@/components/post/PostExportActions";
import { RelatedPosts } from "@/components/post/RelatedPosts";
import { ReadingProgressTracker } from "@/components/post/ReadingProgressTracker";
import { useAutoSave } from "@/lib/useAutoSave";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MilkdownEditor = dynamic(
  () => import("@/components/editor/MilkdownEditor").then((m) => m.MilkdownEditor),
  { ssr: false },
);

export interface PostLiveDocModel {
  id: string;
  slug: string;
  garden: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  published: boolean;
  updatedAt: Date | string;
  viewCount: number;
}

export function PostLiveDoc({ post }: { post: PostLiveDocModel }) {
  const articleRef = useRef<HTMLElement>(null);
  const tocVisible = usePostTocVisible();

  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);

  const { lastSavedAt, isSaving, saveNow } = useAutoSave({
    id: post.id,
    title,
    content,
    category: post.category || "",
    tags: (post.tags || []).join(", "),
    published: true,
    enabled: true,
  });

  return (
    <div
      className={cn(
        "w-full px-4 py-6 sm:px-5 lg:px-6",
        tocVisible && "xl:pr-[20rem] 2xl:pr-[22rem]",
      )}
    >
      <MilkdownStyles />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
        <span className="text-xs text-[var(--kp-text-3)]" title="改动 2 秒后写入 Markdown 文件；Ctrl+S 立刻保存">
          {isSaving
            ? "保存中…"
            : lastSavedAt
              ? `已写入文件 ${lastSavedAt.toLocaleTimeString("zh-CN")}`
              : "Ctrl+S 保存 · 停顿后自动落盘"}
        </span>
      </div>

      <article ref={articleRef} key={post.id} className="kp-post-swap">
        <ReadingProgressTracker
          postId={post.id}
          slug={post.slug}
          garden={post.garden}
          title={title}
          articleRef={articleRef}
        />
        <header className="mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-transparent text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground sm:text-4xl"
            placeholder="标题"
          />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
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
                title,
                slug: post.slug,
                content,
                excerpt: null,
                category: post.category,
                tags: post.tags,
                published: true,
              }}
              articleRef={articleRef}
            />
          </div>
          {post.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
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

        <MilkdownEditor
          initialValue={content}
          onChange={setContent}
          onManualSave={saveNow}
          docMeta={{ title, garden: post.garden, slug: post.slug }}
          className="border-0 shadow-none"
        />
      </article>

      <RelatedPosts postId={post.id} />

      <PageSearch containerRef={articleRef} />
      <SelectionExplain
        containerRef={articleRef}
        title={title}
        slug={post.slug}
        garden={post.garden}
      />
      <TableOfContents content={content} />
    </div>
  );
}
