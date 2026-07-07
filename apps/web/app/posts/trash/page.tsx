"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePostMutations } from "@/lib/hooks";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pagination, ConfirmDialog, EmptyState, LoadingState } from "@/components/shared";
import type { Post } from "@knowpilot/shared";

export default function PostTrashPage() {
  const [page, setPage] = useState(1);
  const [restoreTarget, setRestoreTarget] = useState<Post | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Post | null>(null);

  const { data, isLoading, refetch } = trpc.post.listDeleted.useQuery();
  const { restore, permanentDelete } = usePostMutations();

  const handleRestore = async (post: Post) => {
    const res = await restore.mutateAsync({ id: post.id });
    if (res.success) void refetch();
    setRestoreTarget(null);
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget) return;
    const res = await permanentDelete.mutateAsync({ id: deleteTarget.id });
    if (res.success) {
      setDeleteTarget(null);
      void refetch();
    }
  };

  const pageSize = 10;
  const total = data?.items.length ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const items = data?.items.slice((page - 1) * pageSize, page * pageSize) ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)]">文章回收站</h1>
          <p className="mt-1 text-sm text-[var(--kp-text-3)]">
            共 {total} 篇已删除文章，可恢复或永久删除
          </p>
        </div>
        <Link
          href="/posts"
          className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-2")}
        >
          <ArrowLeft className="h-4 w-4" />
          返回文章列表
        </Link>
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : total === 0 ? (
        <EmptyState title="回收站为空" description="删除的文章会出现在这里，可随时恢复。" />
      ) : (
        <>
          <div className="mb-6 space-y-3">
            {items.map((post) => (
              <div
                key={post.id}
                data-testid="trash-post-card"
                className="flex flex-col gap-3 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-[var(--kp-text-1)]">{post.title}</h3>
                  <p className="mt-1 text-xs text-[var(--kp-text-3)]">
                    slug: {post.slug} · 删除于 {post.deletedAt ? new Date(post.deletedAt).toLocaleString("zh-CN") : "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreTarget(post)}
                    disabled={restore.isPending}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-1.5 text-xs font-medium text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    恢复
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(post)}
                    disabled={permanentDelete.isPending}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    永久删除
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination page={page} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} />
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={!!restoreTarget}
        title="恢复文章"
        description={`确定恢复「${restoreTarget?.title ?? ""}」？恢复后将重新出现在文章列表中。`}
        confirmLabel="恢复"
        onConfirm={() => restoreTarget && void handleRestore(restoreTarget)}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="永久删除文章"
        description={`确定永久删除「${deleteTarget?.title ?? ""}」？此操作不可撤销，本地 Markdown 文件也会被删除。`}
        confirmLabel="永久删除"
        isDestructive
        onConfirm={handlePermanentDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
