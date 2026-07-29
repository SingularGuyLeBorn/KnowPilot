"use client";

/**
 * 文章页 = 编辑页：所见即所得，自动保存。
 * 默认 PostContent 阅读态（含 ```viz Remotion）；显式点正文文字才挂 Milkdown。
 * 交互控件（播放/链接/代码工具栏）不得进编辑——否则会卸正文闪出「只有相关笔记」。
 */

import dynamic from "next/dynamic";
import { useCallback, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, Eye } from "lucide-react";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";
import { PostContent } from "@/components/post/PostContent";
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

/** 这些目标上的点击是交互，不是「点文进编辑」 */
const NO_EDIT_CLICK_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "video",
  "audio",
  "canvas",
  "summary",
  "[role='button']",
  "[contenteditable='true']",
  "[data-no-edit-click]",
  ".not-prose",
  ".kp-code-block",
].join(", ");

function isNoEditClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(NO_EDIT_CLICK_SELECTOR));
}

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
  /**
   * editorRequested：开始拉 Milkdown chunk
   * editorSurfaceReady：编辑面已挂上，才卸阅读面（原子切换，禁止中间空白窗）
   */
  const [editorRequested, setEditorRequested] = useState(false);
  const [editorSurfaceReady, setEditorSurfaceReady] = useState(false);

  const { lastSavedAt, isSaving, saveNow } = useAutoSave({
    id: post.id,
    title,
    content,
    category: post.category || "",
    tags: (post.tags || []).join(", "),
    published: true,
    enabled: editorSurfaceReady,
  });

  const requestEditor = useCallback(() => {
    setEditorRequested(true);
  }, []);

  const handleReadingClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (isNoEditClickTarget(e.target)) return;
      requestEditor();
    },
    [requestEditor],
  );

  const showReading = !editorSurfaceReady;

  return (
    <div
      className={cn(
        "w-full px-4 py-6 sm:px-5 lg:px-6",
        tocVisible && "xl:pr-[20rem] 2xl:pr-[22rem]",
      )}
    >
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
        <span
          className="text-xs text-[var(--kp-text-3)]"
          title="改动 2 秒后写入 Markdown 文件；Ctrl+S 立刻保存"
        >
          {!editorSurfaceReady
            ? editorRequested
              ? "正在加载编辑器…"
              : "阅读中 · 点击正文编辑"
            : isSaving
              ? "保存中…"
              : lastSavedAt
                ? `已写入文件 ${lastSavedAt.toLocaleTimeString("zh-CN")}`
                : "Ctrl+S 保存 · 停顿后自动落盘"}
        </span>
      </div>

      <article ref={articleRef} className="kp-post-swap">
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

        {/* 编辑面：先离屏挂载，ready 后再显示；阅读面同期保留 → 无空白窗 */}
        {editorRequested && (
          <div
            className={cn(!editorSurfaceReady && "pointer-events-none absolute -left-[9999px] top-0 w-[min(100%,48rem)] opacity-0")}
            aria-hidden={!editorSurfaceReady}
          >
            <MilkdownEditor
              key={post.id}
              initialValue={content}
              onChange={setContent}
              onManualSave={saveNow}
              onEditorReady={() => setEditorSurfaceReady(true)}
              docMeta={{
                title,
                garden: post.garden,
                slug: post.slug,
                postId: post.id,
              }}
              className="border-0 shadow-none"
            />
          </div>
        )}

        {showReading && (
          <div
            className="w-full cursor-text rounded-xl border border-transparent text-left transition hover:border-[var(--kp-divider-light)]"
            onClick={handleReadingClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                if (isNoEditClickTarget(e.target)) return;
                requestEditor();
              }
            }}
            role="presentation"
            title="点击正文编辑"
          >
            <PostContent
              content={content}
              postSlug={post.slug}
              postGarden={post.garden}
              className="prose prose-neutral dark:prose-invert max-w-none"
            />
          </div>
        )}
      </article>

      {/* 阅读态也展示；勿绑 editorReady（否则误进编辑时只剩相关笔记） */}
      <RelatedPosts postId={post.id} />

      <PageSearch containerRef={articleRef} />
      {editorSurfaceReady && (
        <SelectionExplain
          containerRef={articleRef}
          title={title}
          slug={post.slug}
          garden={post.garden}
        />
      )}
      <TableOfContents content={content} />
    </div>
  );
}
