"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/hooks";
import type { Workspace } from "@knowpilot/shared";

export default function WorkspaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useWorkspace();
  const { data: workspace, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Workspace>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--vp-c-brand)]" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--vp-c-text-2)]">Workspace 不存在</p>
          <Link href="/workspaces" className="text-sm text-[var(--vp-c-brand)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof Workspace>(key: K) =>
    form[key] !== undefined ? form[key] : workspace[key];

  const updateField = <K extends keyof Workspace>(key: K, val: Workspace[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      {
        id: workspace.id,
        name: form.name ?? workspace.name,
        description: form.description ?? workspace.description,
        path: form.path ?? workspace.path,
      },
      {
        onSuccess: () => router.push("/workspaces"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/workspaces"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--vp-c-bg-soft)] text-[var(--vp-c-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--vp-c-text-1)] flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-[var(--vp-c-brand)]" />
              {workspace.name}
            </h1>
            <p className="text-xs text-[var(--vp-c-text-3)]">ID: {workspace.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">名称</label>
            <Input value={String(value("name") ?? "")} onChange={(e) => updateField("name", e.target.value)} className="bg-[var(--vp-c-bg)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">描述</label>
            <textarea
              value={String(value("description") ?? "")}
              onChange={(e) => updateField("description", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[var(--vp-c-divider)] bg-[var(--vp-c-bg)] px-3 py-2 text-sm text-[var(--vp-c-text-1)] outline-none focus:border-[var(--vp-c-brand)] focus:ring-1 focus:ring-[var(--vp-c-brand)] resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">本地路径</label>
            <Input value={String(value("path") ?? "")} onChange={(e) => updateField("path", e.target.value)} className="bg-[var(--vp-c-bg)] font-mono text-xs" />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={update.isPending} className="bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)]">
              {update.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              保存
            </Button>
            <Button variant="outline" type="button" onClick={() => router.push("/workspaces")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
