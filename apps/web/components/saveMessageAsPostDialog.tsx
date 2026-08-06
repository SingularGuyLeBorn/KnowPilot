"use client";
import { catchUnlessCancelled } from "@/lib/trpc";

/**
 * Chat → 知识库落库完整对话框：新建 / 覆盖更新 / 追加到已有文章。
 * 正文以服务端 messageId 为准（post.createFromChat）。
 * 表单状态用 key 重挂载重置，避免 effect 内 setState。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookPlus, Loader2, X } from "lucide-react";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { formatGardenId } from "@/lib/gardenDisplay";
import { postDetailHref } from "@/lib/postHref";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type SaveMessageAsPostTarget = {
  sessionId: string;
  messageId: string;
  /** 预填标题 / 预览（前端展示用，落库仍走服务端正文） */
  previewTitle?: string;
  previewExcerpt?: string;
};

type Mode = "create" | "update" | "append";

export function SaveMessageAsPostDialog({
  open,
  target,
  onClose,
  onSuccess,
}: {
  open: boolean;
  target: SaveMessageAsPostTarget | null;
  onClose: () => void;
  onSuccess?: (href: string) => void;
}) {
  if (!open || !target) return null;
  return (
    <SaveMessageAsPostDialogInner
      key={`${target.sessionId}:${target.messageId}`}
      target={target}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}

function SaveMessageAsPostDialogInner({
  target,
  onClose,
  onSuccess,
}: {
  target: SaveMessageAsPostTarget;
  onClose: () => void;
  onSuccess?: (href: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("create");
  const [garden, setGarden] = useState<string>(DEFAULT_POST_GARDEN);
  const [title, setTitle] = useState(target.previewTitle?.slice(0, 80) || "");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [published, setPublished] = useState(true);
  const [targetPostId, setTargetPostId] = useState("");
  const [appendHeading, setAppendHeading] = useState("");
  const [postQuery, setPostQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultHref, setResultHref] = useState<string | null>(null);

  const { data: gardens } = trpc.garden.list.useQuery(
    { page: 1, pageSize: 100 },
    { staleTime: 60_000 },
  );
  const searchQ = trpc.post.search.useQuery(
    { query: postQuery.trim() || "a", limit: 20, garden },
    { enabled: (mode === "update" || mode === "append") && postQuery.trim().length >= 1 },
  );
  const listRecent = trpc.post.list.useQuery(
    { page: 1, pageSize: 20, garden, orderBy: "updatedAt", order: "desc" },
    { enabled: (mode === "update" || mode === "append") && postQuery.trim().length < 1 },
  );

  const createFromChat = trpc.post.createFromChat.useMutation();
  const utils = trpc.useUtils();

  const candidatePosts = useMemo(() => {
    if (postQuery.trim().length >= 1) return searchQ.data ?? [];
    return listRecent.data?.items ?? [];
  }, [postQuery, searchQ.data, listRecent.data?.items]);

  const submit = () => {
    setError(null);
    createFromChat
      .mutateAsync({
        sessionId: target.sessionId,
        messageId: target.messageId,
        mode,
        garden,
        title: title.trim() || undefined,
        targetPostId: mode === "create" ? undefined : targetPostId || undefined,
        category: category.trim() || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        published,
        appendHeading: mode === "append" ? appendHeading.trim() || undefined : undefined,
      })
      .then(async (res) => {
        if (!res.success || !res.data) {
          setError(res.error?.message || "落库失败");
          return;
        }
        const href = postDetailHref(res.data.slug, res.data.garden ?? garden);
        setResultHref(href);
        await Promise.all([
          utils.post.list.invalidate().catch(catchUnlessCancelled("components/saveMessageAsPostDialog.tsx")),
          utils.post.tree.invalidate().catch(catchUnlessCancelled("components/saveMessageAsPostDialog.tsx")),
          utils.post.related.invalidate().catch(catchUnlessCancelled("components/saveMessageAsPostDialog.tsx")),
        ]);
        onSuccess?.(href);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "落库失败");
      });
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      data-testid="save-message-as-post-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !createFromChat.isPending) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
            <BookPlus className="h-4 w-4 text-[var(--kp-brand)]" />
            写入知识库
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {target.previewExcerpt && (
          <p className="mb-3 line-clamp-3 rounded-lg border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg-mute)]/40 px-2.5 py-2 text-[11px] text-[var(--kp-text-3)]">
            {target.previewExcerpt}
          </p>
        )}

        {resultHref ? (
          <div className="space-y-3" data-testid="save-message-as-post-success">
            <p className="text-sm text-[var(--kp-text-1)]">已写入知识库。</p>
            <Link
              href={resultHref}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "inline-flex")}
            >
              打开文章
            </Link>
            <button type="button" onClick={onClose} className="ml-2 text-xs text-[var(--kp-text-3)] underline">
              关闭
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["create", "新建文章"],
                  ["append", "追加到已有"],
                  ["update", "覆盖已有正文"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs",
                    mode === id
                      ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                      : "border-[var(--kp-divider)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="block text-xs text-[var(--kp-text-3)]">
              花园
              <select
                value={garden}
                onChange={(e) => setGarden(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-sm text-[var(--kp-text-1)]"
              >
                {(gardens?.items ?? [{ id: DEFAULT_POST_GARDEN, title: "博客" }]).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title} ({formatGardenId(g.id)})
                  </option>
                ))}
              </select>
            </label>

            {(mode === "create" || mode === "update") && (
              <label className="block text-xs text-[var(--kp-text-3)]">
                标题
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={mode === "create" ? "不填则取正文首行" : "可选，留空保留原标题"}
                  className="mt-1 w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-sm text-[var(--kp-text-1)]"
                />
              </label>
            )}

            {(mode === "update" || mode === "append") && (
              <div className="space-y-2">
                <label className="block text-xs text-[var(--kp-text-3)]">
                  搜索已有文章
                  <input
                    value={postQuery}
                    onChange={(e) => setPostQuery(e.target.value)}
                    placeholder="关键词…"
                    className="mt-1 w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-sm"
                  />
                </label>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--kp-divider)]">
                  {candidatePosts.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-[var(--kp-text-3)]">无候选文章</p>
                  ) : (
                    candidatePosts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setTargetPostId(p.id);
                          if (!title) setTitle(p.title);
                        }}
                        className={cn(
                          "flex w-full flex-col items-start px-2.5 py-1.5 text-left text-xs",
                          targetPostId === p.id
                            ? "bg-[var(--kp-brand-soft)]"
                            : "hover:bg-[var(--kp-bg-mute)]",
                        )}
                      >
                        <span className="font-medium text-[var(--kp-text-1)]">{p.title}</span>
                        <span className="text-[10px] text-[var(--kp-text-3)]">
                          {p.garden}/{p.slug}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {mode === "append" && (
              <label className="block text-xs text-[var(--kp-text-3)]">
                追加二级标题（可选）
                <input
                  value={appendHeading}
                  onChange={(e) => setAppendHeading(e.target.value)}
                  placeholder="例如：对话摘录 · 2026-07-29"
                  className="mt-1 w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-sm"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-[var(--kp-text-3)]">
                分类
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs text-[var(--kp-text-3)]">
                标签（逗号分隔）
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-1.5 text-sm"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--kp-text-2)]">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              发布（写入后可在花园中阅读）
            </label>

            {error && (
              <p className="text-xs text-red-600" data-testid="save-message-as-post-error">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                disabled={createFromChat.isPending}
              >
                取消
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={
                  createFromChat.isPending ||
                  ((mode === "update" || mode === "append") && !targetPostId)
                }
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "inline-flex items-center gap-1",
                )}
                data-testid="save-message-as-post-submit"
              >
                {createFromChat.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    写入中…
                  </>
                ) : (
                  "确认写入"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
