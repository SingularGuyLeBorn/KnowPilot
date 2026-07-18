"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Calendar, Tag } from "lucide-react";
import Link from "next/link";

interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  tags: string[];
  createdAt: string | Date;
}

interface RecentIntelligenceProps {
  posts: Post[];
}

function formatDate(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RecentIntelligence({ posts }: RecentIntelligenceProps) {
  return (
    <section className="relative px-[5%] py-24 md:px-[8%] lg:px-[10%]">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as const }}
          className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end"
        >
          <div>
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
              最近文章
            </h2>
            <p className="max-w-lg text-[var(--kp-text-2)]">
              从想法到发布，记录正在生长的知识。
            </p>
          </div>
          <Link
            href="/posts"
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kp-brand-deep)] transition-colors hover:text-[var(--kp-text-1)]"
          >
            查看全部
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </motion.div>

        {posts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="rounded-3xl kp-card p-12 text-center text-[var(--kp-text-3)]"
          >
            还没有文章，去写一篇吧。
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post, index) => (
              <motion.article
                key={post.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{
                  duration: 0.7,
                  delay: index * 0.1,
                  ease: [0.22, 1, 0.36, 1] as const,
                }}
              >
                <Link
                  href={`/posts/${encodeURIComponent(post.slug)}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-3xl kp-card p-6 transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:shadow-[rgba(184,160,144,0.16)]"
                >
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--kp-brand)] via-[var(--kp-brand-light)] to-transparent opacity-60 transition-opacity group-hover:opacity-100" />

                  <div className="mb-4 flex items-center gap-3 text-xs text-[var(--kp-text-3)]">
                    {post.category ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand-soft)] px-2.5 py-1 font-medium text-[var(--kp-brand-deep)]">
                        <Tag className="h-3 w-3" />
                        {post.category}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(post.createdAt)}
                    </span>
                  </div>

                  <h3 className="mb-3 line-clamp-2 text-xl font-semibold text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-brand-deep)]">
                    {post.title}
                  </h3>

                  <p className="mb-6 line-clamp-3 flex-1 text-sm leading-relaxed text-[var(--kp-text-2)]">
                    {post.excerpt || "暂无摘要"}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {post.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-[var(--kp-divider)] px-2 py-0.5 text-xs text-[var(--kp-text-3)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(184,160,144,0.18),transparent_70%)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
                </Link>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
