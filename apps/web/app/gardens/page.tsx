"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ChevronRight, FileText, Layers, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmDialog, EmptyState, LoadingState } from "@/components/shared";
import { ContinueReadingCard } from "@/components/post/ContinueReading";
import { SEED_GARDENS } from "@knowpilot/shared";
import { postDetailHref } from "@/lib/postHref";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };
const easeOut = [0.22, 1, 0.36, 1] as const;

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

  const items = data?.items ?? [];
  const totalPosts = items.reduce((sum, g) => sum + (g.postCount ?? 0), 0);

  return (
    <div className="relative w-full overflow-x-hidden">
      {/* 氛围层：莫兰迪柔光，不对齐工程灰底 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% -10%, color-mix(in srgb, var(--kp-brand) 22%, transparent), transparent 55%)," +
            "radial-gradient(ellipse 60% 40% at 90% 10%, color-mix(in srgb, var(--kp-brand-light, var(--kp-brand)) 18%, transparent), transparent 50%)," +
            "radial-gradient(ellipse 50% 30% at 50% 100%, color-mix(in srgb, var(--kp-brand) 10%, transparent), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--kp-text-3) 35%, transparent) 1px, transparent 0)",
          backgroundSize: "28px 28px",
          maskImage: "linear-gradient(to bottom, black, transparent)",
        }}
      />

      <div className="mx-auto w-full max-w-6xl px-6 py-10 pb-16 lg:px-10 lg:py-14">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: easeOut }}
          className="mb-12 text-center sm:mb-14"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...spring, delay: 0.05 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 px-3 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm"
          >
            <Layers className="h-3.5 w-3.5 text-[var(--kp-brand)]" />
            数字花园
          </motion.div>
          <h1 className="text-4xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-5xl">
            知识库
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-[var(--kp-text-2)] md:text-lg">
            一座库，一个首页，一棵文章树。先选库，再读写。
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.12 }}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-3.5 py-1.5 text-xs text-[var(--kp-text-2)] backdrop-blur-sm"
            >
              <span className="kp-stat-number text-sm font-semibold text-[var(--kp-text-1)]">
                {items.length}
              </span>
              座库
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.18 }}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-3.5 py-1.5 text-xs text-[var(--kp-text-2)] backdrop-blur-sm"
            >
              <FileText className="h-3.5 w-3.5 text-[var(--kp-brand)]" />
              <span className="kp-stat-number text-sm font-semibold text-[var(--kp-text-1)]">
                {totalPosts}
              </span>
              篇文章
            </motion.div>
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.24 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setOpen(true)}
              className={cn(buttonVariants(), "inline-flex items-center gap-2 rounded-full px-4")}
            >
              <Plus className="h-4 w-4" />
              新建知识库
            </motion.button>
          </div>
        </motion.header>

        <ContinueReadingCard className="mx-auto mb-10 max-w-xl" />

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -12, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.35, ease: easeOut }}
              className="mb-10 overflow-hidden"
            >
              <div className="rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/90 p-5 shadow-sm backdrop-blur-md kp-card-premium sm:p-6">
                <h2 className="mb-4 text-sm font-semibold text-[var(--kp-text-1)]">新建知识库</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    value={id}
                    onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                    placeholder="短标识（如 research-notes）"
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
                    className="sm:col-span-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]/40"
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
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <LoadingState />
        ) : !items.length ? (
          <EmptyState title="还没有知识库" description="点击「新建知识库」创建第一座花园" />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {items.map((g, index) => {
              const isSeed = (SEED_GARDENS as readonly string[]).includes(g.id);
              const count = g.postCount ?? 0;
              const recent = g.recentPosts ?? [];
              const homeHref = `/gardens/${encodeURIComponent(g.id)}`;
              return (
                <motion.article
                  key={g.id}
                  initial={{ opacity: 0, y: 28 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: 0.08 + index * 0.08, ease: easeOut }}
                  whileHover={{ y: -6 }}
                  className="group relative flex flex-col overflow-hidden rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/85 p-6 shadow-sm backdrop-blur-sm kp-card-premium transition-[border-color,box-shadow,background-color] duration-500 hover:border-[var(--kp-brand)]/40 hover:bg-[var(--kp-bg-alt)] hover:shadow-[0_12px_40px_-12px_color-mix(in_srgb,var(--kp-brand)_35%,transparent)]"
                >
                  <div
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-1 origin-left scale-x-[0.45] bg-gradient-to-r from-[var(--kp-brand)] via-[var(--kp-brand-light,var(--kp-brand))] to-transparent opacity-60 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-100"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[var(--kp-brand)]/0 blur-2xl transition-all duration-500 group-hover:bg-[var(--kp-brand)]/15"
                  />

                  <div className="relative mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-[var(--kp-text-3)] transition-colors group-hover:text-[var(--kp-brand)]">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <Link
                          href={homeHref}
                          className="truncate text-xl font-semibold tracking-tight text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-brand-deep)]"
                        >
                          {g.title}
                        </Link>
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-[var(--kp-text-3)]">{g.id}</p>
                    </div>
                    {!isSeed && (
                      <button
                        type="button"
                        title="删除空库"
                        onClick={() => setDeleteId(g.id)}
                        className="rounded-lg p-1.5 text-[var(--kp-text-3)] opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <p className="relative mb-4 line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed text-[var(--kp-text-2)] transition-colors group-hover:text-[var(--kp-text-1)]">
                    {g.description || "暂无说明"}
                  </p>

                  {recent.length > 0 && (
                    <ul className="relative mb-5 space-y-1.5 border-t border-[var(--kp-divider)]/80 pt-4">
                      {recent.map((p) => (
                        <li key={p.slug}>
                          <Link
                            href={postDetailHref(p.slug, g.id)}
                            className="group/item flex items-center gap-2 text-sm text-[var(--kp-text-2)] transition-colors hover:text-[var(--kp-brand-deep)]"
                          >
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform group-hover/item:translate-x-0.5" />
                            <span className="truncate">{p.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="relative mt-auto flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-[var(--kp-text-3)]">
                      <span className="font-semibold tabular-nums text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-brand-deep)]">
                        {count}
                      </span>{" "}
                      篇文章
                    </span>
                    <Link
                      href={homeHref}
                      className={cn(
                        buttonVariants({ size: "sm" }),
                        "inline-flex items-center gap-1 text-xs shadow-sm transition-all duration-300",
                        /* 触控设备常显；精细指针设备仅 hover / 键盘 focus 出现 */
                        "opacity-100 translate-y-0",
                        "md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100",
                        "md:focus-visible:translate-y-0 md:focus-visible:opacity-100",
                      )}
                    >
                      打开首页
                      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 text-center"
        >
          <Link
            href="/posts"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kp-brand-deep)] transition-colors hover:text-[var(--kp-text-1)]"
          >
            查看全部文章
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </motion.div>
      </div>

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
