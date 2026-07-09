/**
 * 全局搜索页面 (L5)
 */

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Search, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";

const ENTITY_LABELS: Record<string, string> = {
  post: "文章",
  agent: "Agent",
  skill: "Skill",
  memory: "记忆",
  task: "任务",
  mcp: "MCP",
  message: "消息",
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading, isFetching } = trpc.search.global.useQuery(
    { query: debounced, limit: 30 },
    { enabled: debounced.length >= 2 },
  );

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={Search}
        title="搜索 KnowPilot"
      />
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--vp-c-text-3)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文章、Agent、Skill、记忆、消息…"
          data-testid="global-search-input"
          className="w-full rounded-2xl border border-[var(--vp-c-divider)] bg-[var(--vp-c-bg)] py-3 pl-10 pr-4 text-sm outline-none focus:border-[var(--vp-c-brand)]"
          autoFocus
        />
      </div>
      {data && (
        <p className="text-xs text-[var(--vp-c-text-3)] flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {data.hits.length} 条结果 · {data.tookMs}ms
        </p>
      )}

      {debounced.length < 2 ? (
        <EmptyState title="输入至少 2 个字符" description="将搜索文章、Agent、Skill、记忆、任务、MCP 与聊天消息。" />
      ) : isLoading || isFetching ? (
        <LoadingState count={4} />
      ) : !data?.hits.length ? (
        <EmptyState title="无匹配结果" description={`没有找到与「${debounced}」相关的内容。`} />
      ) : (
        <ul className="space-y-2">
          {data.hits.map((hit) => (
            <li key={`${hit.entity}-${hit.id}`}>
              <Link
                href={hit.href}
                className="block rounded-xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/50 px-4 py-3 hover:border-[var(--vp-c-brand)]/30 hover:shadow-sm transition"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-medium rounded-full bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)] px-2 py-0.5">
                    {ENTITY_LABELS[hit.entity] ?? hit.entity}
                  </span>
                </div>
                <p className="text-sm font-medium text-[var(--vp-c-text-1)] line-clamp-1">{hit.title}</p>
                {hit.subtitle && (
                  <p className="text-xs text-[var(--vp-c-text-3)] line-clamp-1 mt-0.5">{hit.subtitle}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
