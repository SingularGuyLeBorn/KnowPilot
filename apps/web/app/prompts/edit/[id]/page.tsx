"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePrompt } from "@/lib/hooks";
import type { Prompt } from "@knowpilot/shared";

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = usePrompt();
  const { data: prompt, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Prompt>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--kp-text-2)]">Prompt 不存在</p>
          <Link href="/prompts" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof Prompt>(key: K) =>
    form[key] !== undefined ? form[key] : prompt[key];

  const updateField = <K extends keyof Prompt>(key: K, val: Prompt[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const parseList = (text: string) =>
    text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const formatList = (list?: string[]) => (list ?? []).join(", ");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      {
        id: prompt.id,
        name: form.name ?? prompt.name,
        version: form.version ?? prompt.version,
        description: form.description ?? prompt.description,
        variables: form.variables ?? prompt.variables,
        tags: form.tags ?? prompt.tags,
        content: form.content ?? prompt.content,
      },
      {
        onSuccess: () => router.push("/prompts"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/prompts"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-soft)] text-[var(--kp-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)] flex items-center gap-2">
              <FileCode2 className="w-5 h-5 text-[var(--kp-brand-deep)]" />
              {prompt.name}
            </h1>
            <p className="text-xs text-[var(--kp-text-3)]">ID: {prompt.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">名称</label>
              <Input value={String(value("name") ?? "")} onChange={(e) => updateField("name", e.target.value)} className="bg-[var(--kp-bg)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">版本</label>
              <Input value={String(value("version") ?? "")} onChange={(e) => updateField("version", e.target.value)} className="bg-[var(--kp-bg)]" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">描述</label>
            <textarea
              value={String(value("description") ?? "")}
              onChange={(e) => updateField("description", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">变量（逗号分隔）</label>
              <Input value={formatList(value("variables") as string[] | undefined)} onChange={(e) => updateField("variables", parseList(e.target.value))} className="bg-[var(--kp-bg)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">标签（逗号分隔）</label>
              <Input value={formatList(value("tags") as string[] | undefined)} onChange={(e) => updateField("tags", parseList(e.target.value))} className="bg-[var(--kp-bg)]" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">内容</label>
            <textarea
              value={String(value("content") ?? "")}
              onChange={(e) => updateField("content", e.target.value)}
              rows={12}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y"
            />
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
            <Button variant="outline" type="button" onClick={() => router.push("/prompts")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
