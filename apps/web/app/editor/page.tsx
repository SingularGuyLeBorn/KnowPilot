"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import dynamic from "next/dynamic";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";

const MilkdownEditor = dynamic(
  () => import("@/components/editor/MilkdownEditor").then((m) => m.MilkdownEditor),
  { ssr: false }
);
import { usePostMutations } from "@/lib/usePostMutations";
import { postDetailHref } from "@/lib/postHref";
import { useAutoSave } from "@/lib/useAutoSave";
import { trpc } from "@/lib/trpc";

function NewPostPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gardenFromUrl = searchParams.get("garden") || DEFAULT_POST_GARDEN;
  const { data: gardens } = trpc.garden.list.useQuery({ page: 1, pageSize: 100 });

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [garden, setGarden] = useState(gardenFromUrl);
  /** 新建页稳定草稿键：附件落 uploads/{garden}/_draft/{draftKey}/，与 slug 解耦 */
  const [draftKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  );

  const { lastSavedAt } = useAutoSave({
    title,
    content,
    category,
    tags,
    published: true,
    enabled: true,
    onRestored: (draft) => {
      setTitle(draft.title);
      setContent(draft.content);
      setCategory(draft.category);
      setTags(draft.tags);
    },
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { create } = usePostMutations({
    onCreateSuccess: ({ slug, garden: g }) => {
      router.push(postDetailHref(slug, g));
    },
  });

  const handleCreate = () => {
    if (!title.trim()) return;
    create.mutate(
      {
        title: title.trim(),
        content,
        garden,
        category: category || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        published: true,
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
      },
    );
  };

  return (
    <>
      <div className="flex h-full flex-col">
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
                本地已记 {lastSavedAt.toLocaleTimeString("zh-CN")}
              </span>
            )}
            <button
              type="button"
              onClick={handleCreate}
              disabled={create.isPending || !title.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--kp-brand-deep)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {create.isPending ? "创建中…" : "创建文章"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 border-b border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 sm:px-6">
          <select
            value={garden}
            onChange={(e) => {
              const next = e.target.value;
              setGarden(next);
              // 侧栏跟所选花园走
              const params = new URLSearchParams(searchParams.toString());
              params.set("garden", next);
              router.replace(`/editor?${params.toString()}`, { scroll: false });
            }}
            className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-1.5 text-sm text-[var(--kp-text-1)] outline-none"
            title="知识库花园（content/{garden}/）"
          >
            {(gardens?.items ?? [{ id: DEFAULT_POST_GARDEN, title: "博客" }]).map((g) => (
              <option key={g.id} value={g.id}>
                {g.title} ({g.id})
              </option>
            ))}
          </select>
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
          <MilkdownEditor
            initialValue={content}
            onChange={setContent}
            docMeta={{ title, garden, draftKey }}
          />
        </div>
      </div>
    </>
  );
}

// useSearchParams 需 Suspense 边界，否则 Next 16 下整页 CSR bailout
export default function NewPostPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--kp-text-3)]">
          加载编辑器…
        </div>
      }
    >
      <NewPostPageContent />
    </Suspense>
  );
}
