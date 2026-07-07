"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, KeyRound, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCredential } from "@/lib/hooks";
import type { Credential } from "@knowpilot/shared";

const TYPE_OPTIONS = ["api_key", "token", "password"] as const;

const TYPE_LABEL: Record<Credential["type"], string> = {
  api_key: "API Key",
  token: "Token",
  password: "密码",
};

export default function CredentialDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useCredential();
  const { data: cred, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Credential>>({});
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--vp-c-brand)]" />
      </div>
    );
  }

  if (!cred) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--vp-c-text-2)]">凭据不存在</p>
          <Link href="/credentials" className="text-sm text-[var(--vp-c-brand)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof Credential>(key: K) =>
    form[key] !== undefined ? form[key] : cred[key];

  const updateField = <K extends keyof Credential>(key: K, val: Credential[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const parseScope = (text: string) =>
    text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const formatScope = (scope?: string[]) => (scope ?? []).join(", ");

  const formatDateLocal = (d?: string | Date | null) => {
    if (!d) return "";
    const date = new Date(d);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 16);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // value 留空表示不修改（API 不再返回明文，无法回填原值）
    const valuePayload = form.value && form.value.trim() ? form.value : undefined;
    update.mutate(
      {
        id: cred.id,
        name: form.name ?? cred.name,
        type: form.type ?? cred.type,
        value: valuePayload,
        scope: form.scope ?? cred.scope,
        expiresAt: form.expiresAt !== undefined ? (form.expiresAt ? new Date(form.expiresAt as string) : null) : cred.expiresAt,
      } as any,
      {
        onSuccess: () => router.push("/credentials"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/credentials"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--vp-c-bg-soft)] text-[var(--vp-c-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--vp-c-text-1)] flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-[var(--vp-c-brand)]" />
              {cred.name}
            </h1>
            <p className="text-xs text-[var(--vp-c-text-3)]">ID: {cred.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">名称</label>
            <Input value={String(value("name") ?? "")} onChange={(e) => updateField("name", e.target.value)} className="bg-[var(--vp-c-bg)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">类型</label>
            <select
              value={String(value("type") ?? "api_key")}
              onChange={(e) => updateField("type", e.target.value as Credential["type"])}
              className="w-full rounded-lg border border-[var(--vp-c-divider)] bg-[var(--vp-c-bg)] px-3 py-2 text-sm text-[var(--vp-c-text-1)] outline-none focus:border-[var(--vp-c-brand)] focus:ring-1 focus:ring-[var(--vp-c-brand)]"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">值</label>
            <div className="flex items-center gap-2">
              <Input
                type={revealed ? "text" : "password"}
                value={String(value("value") ?? "")}
                onChange={(e) => updateField("value", e.target.value)}
                placeholder="留空表示不修改（出于安全，原值不回填）"
                className="bg-[var(--vp-c-bg)] flex-1 font-mono"
              />
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--vp-c-divider)] text-[var(--vp-c-text-2)] hover:bg-[var(--vp-c-bg-soft)]"
                aria-label={revealed ? "隐藏" : "显示"}
              >
                {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">作用域（逗号分隔）</label>
            <Input value={formatScope(value("scope") as string[] | undefined)} onChange={(e) => updateField("scope", parseScope(e.target.value))} className="bg-[var(--vp-c-bg)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--vp-c-text-1)]">过期时间</label>
            <Input
              type="datetime-local"
              value={formatDateLocal(value("expiresAt"))}
              onChange={(e) => updateField("expiresAt", e.target.value)}
              className="bg-[var(--vp-c-bg)]"
            />
          </div>

          {cred.metadata && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--vp-c-text-1)]">Metadata（只读）</label>
              <pre className="rounded-lg bg-[var(--vp-c-bg-soft)] px-3 py-2 text-xs text-[var(--vp-c-text-2)] overflow-auto max-h-40">
                {JSON.stringify(cred.metadata, null, 2)}
              </pre>
            </div>
          )}

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
            <Button variant="outline" type="button" onClick={() => router.push("/credentials")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
