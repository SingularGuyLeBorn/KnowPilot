"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { MilkdownStyles } from "@/components/editor/MilkdownEditor";

const MilkdownEditor = dynamic(
  () => import("@/components/editor/MilkdownEditor").then((m) => m.MilkdownEditor),
  { ssr: false }
);
import { ImageUploadButton, useImageDrop, useImagePaste } from "@/components/editor/ImageUploadButton";
import { usePostMutations } from "@/lib/hooks";
import { useAutoSave } from "@/lib/useAutoSave";
import { cn } from "@/lib/utils";

export default function NewPostPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");

  const { lastSavedAt } = useAutoSave({
    title,
    content,
    category,
    tags,
    published: false,
    enabled: true,
    onRestored: (draft) => {
      setTitle(draft.title);
      setContent(draft.content);
      setCategory(draft.category);
      setTags(draft.tags);
    },
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadKey, setUploadKey] = useState(0);

  const { create } = usePostMutations({
    onCreateSuccess: (slug) => {
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
    if (!title.trim()) return;
    create.mutate(
      {
        title: title.trim(),
        content,
        category: category || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        published: publish,
      },
      {
        onError: (error) => {
          setErrorMessage(error.message || "创建文章时发生网络错误");
        },
        onSuccess: (result) => {
          if (!result.success) {
            setErrorMessage(result.error?.message || "创建文章失败");
          }
        },
      }
    );
  };

  return (
    <>
      <MilkdownStyles />
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/posts"
              className="inline-flex items-center gap-1 text-sm text-[var(--kp-text-2)] transition hover:text-[var(--kp-text-1)]"
            >
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文章标题"
              className="bg-transparent text-lg font-semibold text-[var(--kp-text-1)] outline-none placeholder:text-[var(--kp-text-3)]"
            />
          </div>
          <div className="flex items-center gap-3">
            {errorMessage && (
              <span className="max-w-xs truncate text-xs text-red-500" title={errorMessage}>
                {errorMessage}
              </span>
            )}
            {lastSavedAt && (
              <span className="hidden text-xs text-[var(--kp-text-3)] sm:inline">
                草稿已保存 {lastSavedAt.toLocaleTimeString("zh-CN")}
              </span>
            )}
            <ImageUploadButton onUploaded={appendImage} />
            <button
              onClick={() => handleSave(false)}
              disabled={create.isPending || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-4 py-2 text-sm font-medium text-[var(--kp-text-1)] transition hover:bg-[var(--kp-bg-mute)] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              保存草稿
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={create.isPending || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--kp-brand-deep)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              发布
            </button>
          </div>
        </div>

        {/* Meta fields */}
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

        {/* Editor */}
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
              key={uploadKey}
              initialValue={content}
              onChange={setContent}
            />
          </div>
        </div>
      </div>
    </>
  );
}
