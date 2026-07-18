"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGit } from "@/lib/hooks";
import type { GitRepo } from "@knowpilot/shared";

export default function GitRepoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useGit();
  const { data: repo, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<GitRepo>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--kp-text-2)]">Git 仓库不存在</p>
          <Link href="/git" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof GitRepo>(key: K) =>
    form[key] !== undefined ? form[key] : repo[key];

  const updateField = <K extends keyof GitRepo>(key: K, val: GitRepo[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const nullableString = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s || null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      {
        id: repo.id,
        name: form.name ?? repo.name,
        path: form.path ?? repo.path,
        branch: form.branch ?? repo.branch,
        remoteUrl: form.remoteUrl !== undefined ? nullableString(form.remoteUrl) : repo.remoteUrl,
      },
      {
        onSuccess: () => router.push("/git"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/git"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-soft)] text-[var(--kp-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)] flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-[var(--kp-brand-deep)]" />
              {repo.name}
            </h1>
            <p className="text-xs text-[var(--kp-text-3)]">ID: {repo.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">名称</label>
            <Input value={String(value("name") ?? "")} onChange={(e) => updateField("name", e.target.value)} className="bg-[var(--kp-bg)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">本地路径</label>
            <Input value={String(value("path") ?? "")} onChange={(e) => updateField("path", e.target.value)} className="bg-[var(--kp-bg)] font-mono text-xs" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">分支</label>
              <Input value={String(value("branch") ?? "")} onChange={(e) => updateField("branch", e.target.value)} className="bg-[var(--kp-bg)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">远程 URL</label>
              <Input
                value={value("remoteUrl") ?? ""}
                onChange={(e) => updateField("remoteUrl", e.target.value || null)}
                placeholder="可选"
                className="bg-[var(--kp-bg)]"
              />
            </div>
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
            <Button variant="outline" type="button" onClick={() => router.push("/git")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
