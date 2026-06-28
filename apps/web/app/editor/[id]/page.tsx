"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Send } from "lucide-react";
import { Shell } from "@/components/layout/Shell";
import { MilkdownEditor, MilkdownStyles } from "@/components/editor/MilkdownEditor";
import { trpc } from "@/lib/trpc";
import { useAutoSave } from "@/lib/useAutoSave";

export default function EditPostPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: post, isLoading } = trpc.post.getById.useQuery({ id });

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [published, setPublished] = useState(false);

  useEffect(() => {
    if (post) {
      setTitle(post.title);
      setContent(post.content);
      setCategory(post.category || "");
      setTags(post.tags?.join(", ") || "");
      setPublished(post.published);
    }
  }, [post]);

  const { lastSavedAt, isSaving } = useAutoSave({
    id,
    title,
    content,
    category,
    tags,
    published,
    enabled: !!post,
  });

  const updatePost = trpc.post.update.useMutation({
    onSuccess: (updated) => {
      router.push(`/posts/${encodeURIComponent(updated.slug)}`);
    },
  });

  const handleSave = (publish = false) => {
    if (!title.trim() || !id) return;
    updatePost.mutate({
      id,
      title: title.trim(),
      content,
      category: category || null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      published: publish,
    });
    setPublished(publish);
  };

  if (isLoading) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center">
          <div className="text-[var(--kp-text-2)]">加载中...</div>
        </div>
      </Shell>
    );
  }

  if (!post) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center">
          <div className="text-[var(--kp-text-2)]">文章不存在</div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell className="overflow-hidden">
      <MilkdownStyles />
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href={`/posts/${encodeURIComponent(post.slug)}`}
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
            {(lastSavedAt || isSaving) && (
              <span className="hidden text-xs text-[var(--kp-text-3)] sm:inline">
                {isSaving ? "保存中…" : `已保存 ${lastSavedAt?.toLocaleTimeString("zh-CN")}`}
              </span>
            )}
            <button
              onClick={() => handleSave(false)}
              disabled={updatePost.isPending || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-4 py-2 text-sm font-medium text-[var(--kp-text-1)] transition hover:bg-[var(--kp-bg-mute)] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              保存草稿
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={updatePost.isPending || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--kp-brand)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--kp-brand-dark)] disabled:opacity-50"
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
          <MilkdownEditor
            key={post.id}
            initialValue={content}
            onChange={setContent}
          />
        </div>
      </div>
    </Shell>
  );
}
