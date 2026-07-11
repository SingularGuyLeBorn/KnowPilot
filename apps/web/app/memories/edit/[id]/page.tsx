"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemory } from "@/lib/hooks";
import type { Memory } from "@knowpilot/shared";

export default function MemoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useMemory();
  const { data: memory, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Memory>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--kp-text-2)]">记忆不存在</p>
          <Link href="/memories" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof Memory>(key: K) =>
    form[key] !== undefined ? form[key] : memory[key];

  const updateField = <K extends keyof Memory>(key: K, val: Memory[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const parseKeywords = (text: string) =>
    text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const formatKeywords = (keywords?: string[]) => (keywords ?? []).join(", ");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      {
        id: memory.id,
        content: form.content ?? memory.content,
        type: form.type ?? memory.type,
        strength: form.strength ?? memory.strength,
        keywords: form.keywords ?? memory.keywords,
      },
      {
        onSuccess: () => router.push("/memories"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/memories"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-soft)] text-[var(--kp-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)] flex items-center gap-2">
              <Brain className="w-5 h-5 text-[var(--kp-brand-deep)]" />
              记忆 · {memory.id.slice(0, 8)}
            </h1>
            <p className="text-xs text-[var(--kp-text-3)]">ID: {memory.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">内容</label>
            <textarea
              value={String(value("content") ?? "")}
              onChange={(e) => updateField("content", e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">类型</label>
              <Input value={String(value("type") ?? "")} onChange={(e) => updateField("type", e.target.value)} placeholder="episodic / semantic" className="bg-[var(--kp-bg)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">强度（0-1）</label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={String(value("strength") ?? "")}
                onChange={(e) => updateField("strength", Number(e.target.value))}
                className="bg-[var(--kp-bg)]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">关键词（逗号分隔）</label>
            <Input value={formatKeywords(value("keywords") as string[] | undefined)} onChange={(e) => updateField("keywords", parseKeywords(e.target.value))} className="bg-[var(--kp-bg)]" />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={update.isPending} className="bg-[var(--kp-brand-deep)] text-white hover:bg-[var(--kp-brand-deep)]">
              {update.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              保存
            </Button>
            <Button variant="outline" type="button" onClick={() => router.push("/memories")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
