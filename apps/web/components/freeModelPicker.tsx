"use client";

/**
 * 免费模型选择列表：序号 / 出版商 / 名称 / 上下文 / 模态 / id
 * 供 Chat Goal 设置与 /free-models 复用展示约定。
 */

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function publisherFromModelId(id: string): string {
  const slash = id.indexOf("/");
  if (slash <= 0) return "—";
  return id.slice(0, slash);
}

function formatContext(n?: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export type FreeModelPick = {
  id: string;
  name: string;
  publisher: string;
  contextLength?: number;
  modality?: string;
  index: number;
};

export function FreeModelPicker({
  value,
  onChange,
  className,
  allowAuto = true,
}: {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
  allowAuto?: boolean;
}) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const modelsQuery = trpc.llm.listFreeModels.useQuery(
    { q: q.trim() || undefined, modality: "text", sort: "context_desc" },
    { staleTime: 30_000 },
  );

  const items: FreeModelPick[] = useMemo(() => {
    const raw = modelsQuery.data?.items ?? [];
    return raw.map((m, i) => ({
      id: m.id,
      name: m.name,
      publisher: publisherFromModelId(m.id),
      contextLength: m.contextLength,
      modality: m.modality,
      index: i + 1,
    }));
  }, [modelsQuery.data?.items]);

  return (
    <div className={cn("space-y-2", className)} data-testid="free-model-picker">
      {allowAuto && (
        <button
          type="button"
          onClick={() => onChange("auto")}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
            value === "auto" || !value
              ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
              : "border-[var(--kp-divider)] hover:bg-[var(--kp-bg-mute)]",
          )}
        >
          <span className="font-mono text-[10px] text-[var(--kp-text-3)]">#0</span>
          <span className="font-medium">自动（OpenRouter 免费最强）</span>
          {(value === "auto" || !value) && <Check className="ml-auto h-3.5 w-3.5" />}
        </button>
      )}
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索出版商 / 名称 / id…"
        className="h-8 text-xs"
      />
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-[var(--kp-divider)] divide-y divide-[var(--kp-divider)]">
        {items.length === 0 && (
          <li className="px-2.5 py-4 text-center text-[11px] text-[var(--kp-text-3)]">
            {modelsQuery.isLoading ? "加载中…" : "暂无 :free 模型"}
          </li>
        )}
        {items.map((m) => {
          const selected = value === m.id;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onChange(m.id)}
                className={cn(
                  "flex w-full items-start gap-2 px-2.5 py-2 text-left text-xs transition-colors",
                  selected
                    ? "bg-[var(--kp-brand-soft)]"
                    : "hover:bg-[var(--kp-bg-mute)]",
                )}
              >
                <span className="w-7 shrink-0 font-mono text-[10px] text-[var(--kp-text-3)]">
                  #{m.index}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-[var(--kp-bg-mute)] px-1 py-0.5 text-[10px] font-medium text-[var(--kp-text-2)]">
                      {m.publisher}
                    </span>
                    <span className="font-medium text-[var(--kp-text-1)]">{m.name}</span>
                    <span className="text-[10px] text-[var(--kp-text-3)]">
                      {formatContext(m.contextLength)} ctx
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    <code className="truncate font-mono text-[10px] text-[var(--kp-text-3)]">
                      {m.id}
                    </code>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        void navigator.clipboard.writeText(m.id).then(() => {
                          setCopied(m.id);
                          window.setTimeout(() => setCopied(null), 1200);
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          void navigator.clipboard.writeText(m.id);
                        }
                      }}
                      className="inline-flex rounded p-0.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg)]"
                      title="复制 id"
                    >
                      {copied === m.id ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </span>
                  </div>
                </div>
                {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
