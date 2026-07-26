"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmDialog, EmptyState, LoadingState } from "@/components/shared";
import { SEED_GARDENS } from "@knowpilot/shared";

export default function GardensPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.garden.list.useQuery({ page: 1, pageSize: 100 });
  const create = trpc.garden.create.useMutation({
    onSuccess: () => {
      utils.garden.list.invalidate().catch(() => {});
      setOpen(false);
      setId("");
      setTitle("");
      setDescription("");
      setHomeContent("");
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const remove = trpc.garden.delete.useMutation({
    onSuccess: () => {
      utils.garden.list.invalidate().catch(() => {});
      setDeleteId(null);
    },
  });

  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [homeContent, setHomeContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreate = () => {
    if (!id.trim() || !title.trim()) {
      setError("请填写 id 与标题");
      return;
    }
    create.mutate({
      id: id.trim(),
      title: title.trim(),
      description: description.trim() || null,
      homeContent: homeContent.trim() || `# ${title.trim()}\n\n欢迎来到本知识库。\n`,
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)]">知识库</h1>
          <p className="mt-1 text-sm text-[var(--kp-text-3)]">
            每座库 = content/&#123;id&#125;/ + 首页 _garden.md。可新建第 N 座。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(buttonVariants(), "inline-flex items-center gap-2")}
        >
          <Plus className="h-4 w-4" />
          新建知识库
        </button>
      </div>

      {open && (
        <div className="mb-8 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--kp-text-1)]">新建花园</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              placeholder="id（如 research-notes）"
              className="font-mono text-sm"
            />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="显示标题"
              className="text-sm"
            />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说明（可选）"
              className="sm:col-span-2 text-sm"
            />
            <textarea
              value={homeContent}
              onChange={(e) => setHomeContent(e.target.value)}
              placeholder="首页 Markdown（可选，默认生成欢迎文）"
              rows={4}
              className="sm:col-span-2 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none"
            />
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={create.isPending}
              className={cn(buttonVariants(), "text-sm")}
            >
              {create.isPending ? "创建中…" : "创建"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className={cn(buttonVariants({ variant: "outline" }), "text-sm")}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : !data?.items.length ? (
        <EmptyState title="还没有知识库" description="点击「新建知识库」创建第一座花园" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.items.map((g) => {
            const isSeed = (SEED_GARDENS as readonly string[]).includes(g.id);
            return (
              <article
                key={g.id}
                className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 transition hover:border-[var(--kp-brand)]/30"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-[var(--kp-brand)]" />
                    <div>
                      <Link
                        href={`/gardens/${encodeURIComponent(g.id)}`}
                        className="text-lg font-semibold text-[var(--kp-text-1)] hover:text-[var(--kp-brand-deep)]"
                      >
                        {g.title}
                      </Link>
                      <p className="font-mono text-xs text-[var(--kp-text-3)]">{g.id}</p>
                    </div>
                  </div>
                  {!isSeed && (
                    <button
                      type="button"
                      title="删除空库"
                      onClick={() => setDeleteId(g.id)}
                      className="rounded p-1.5 text-[var(--kp-text-3)] hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mb-4 line-clamp-2 text-sm text-[var(--kp-text-2)]">
                  {g.description || "暂无说明"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/gardens/${encodeURIComponent(g.id)}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs")}
                  >
                    打开首页
                  </Link>
                  <Link
                    href={`/posts?garden=${encodeURIComponent(g.id)}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs")}
                  >
                    浏览文章
                  </Link>
                  <Link
                    href={`/editor?garden=${encodeURIComponent(g.id)}`}
                    className={cn(buttonVariants({ size: "sm" }), "text-xs")}
                  >
                    新建文章
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        title="删除知识库"
        description={`确定删除空库「${deleteId}」？目录将移入回收站。若仍有文章会失败。`}
        confirmLabel="删除"
        isDestructive
        onConfirm={() => deleteId && remove.mutate({ id: deleteId })}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
