"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { MilkdownStyles } from "@/components/editor/MilkdownEditor";
import { ImageUploadButton, useImageDrop, useImagePaste } from "@/components/editor/ImageUploadButton";
import { usePostMutations } from "@/lib/hooks";
import { useAutoSave } from "@/lib/useAutoSave";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const MilkdownEditor = dynamic(
  () => import("@/components/editor/MilkdownEditor").then((m) => m.MilkdownEditor),
  { ssr: false }
);

interface Post {
  id: string;
  slug: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  published: boolean;
}

export default function EditPostPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: post, isLoading } = trpc.post.getById.useQuery(
    { id },
    { enabled: !!id && id !== "new" && id !== "undefined" && id.length > 5 }
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[var(--kp-text-2)]">加载中...</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[var(--kp-text-2)]">文章不存在</div>
      </div>
    );
  }

  return <EditorForm key={post.id} id={id} post={post} />;
}

function EditorForm({ id, post }: { id: string; post: Post }) {
  const router = useRouter();

  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const [category, setCategory] = useState(post.category || "");
  const [tags, setTags] = useState(post.tags?.join(", ") || "");
  const [published, setPublished] = useState(post.published);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadKey, setUploadKey] = useState(0);

  const { lastSavedAt, isSaving } = useAutoSave({
    id,
    title,
    content,
    category,
    tags,
    published,
    enabled: true,
  });

  const { update } = usePostMutations({
    onUpdateSuccess: (slug) => {
      router.push(`/posts/${encodeURIComponent(slug)}`);
    },
  });

  const appendImage = (markdown: string) => {
    setContent((prev) => (prev ? `${prev}\n${markdown}` : markdown));
    setUploadKey((k) => k + 1);
  };

  const { dragOver, dropHandlers } = useImageDrop(appendImage);
  const pasteHandlers = useImagePaste(appendImage);

  const handleSave = (publish = false) => {
    if (!title.trim() || !id) return;
    update.mutate(
      {
        id,
        title: title.trim(),
        content,
        category: category || null,
        tags: tags
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean),
        published: publish,
      },
      {
        onError: (error) => {
          setErrorMessage(error.message || "更新文章时发生网络错误");
        },
        onSuccess: (result) => {
          if (!result.success) {
            setErrorMessage(result.error?.message || "更新文章失败");
          }
        },
      }
    );
    setPublished(publish);
  };

  return (
    <>
      <MilkdownStyles />
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href={`/posts/${encodeURIComponent(post.slug)}`}
              className="inline-flex shrink-0 items-center gap-1 text-sm text-[var(--kp-text-2)] transition hover:text-[var(--kp-text-1)]"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文章标题"
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-[var(--kp-text-1)] outline-none placeholder:text-[var(--kp-text-3)]"
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {errorMessage && (
              <span className="max-w-xs truncate text-xs text-red-500" title={errorMessage}>
                {errorMessage}
              </span>
            )}
            {(lastSavedAt || isSaving) && (
              <span className="hidden text-xs text-[var(--kp-text-3)] sm:inline">
                {isSaving ? "保存中…" : `已保存 ${lastSavedAt?.toLocaleTimeString("zh-CN")}`}
              </span>
            )}
            <ImageUploadButton onUploaded={appendImage} />
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={update.isPending || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-4 py-2 text-sm font-medium text-[var(--kp-text-1)] transition hover:bg-[var(--kp-bg-mute)] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              保存草稿
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={update.isPending || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--kp-brand-deep)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              发布
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 sm:px-6">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="分类"
            className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-1.5 text-sm text-[var(--kp-text-1)] outline-none placeholder:text-[var(--kp-text-3)]"
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="标签，用逗号分隔"
            className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-1.5 text-sm text-[var(--kp-text-1)] outline-none placeholder:text-[var(--kp-text-3)]"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div
            {...dropHandlers}
            {...pasteHandlers}
            className={cn(
              "h-full rounded-xl transition-colors",
              dragOver && "bg-[var(--kp-brand)]/5 ring-2 ring-[var(--kp-brand)]/30"
            )}
          >
            <MilkdownEditor
              key={`${post.id}-${uploadKey}`}
              initialValue={content}
              onChange={setContent}
            />
          </div>
        </div>
      </div>
    </>
  );
}
