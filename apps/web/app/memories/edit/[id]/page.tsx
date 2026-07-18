"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemory } from "@/lib/hooks";
import type { Memory } from "@knowpilot/shared";
import { memoryLabel } from "@/lib/displayLabels";

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
    const validToRaw = form.validTo !== undefined ? form.validTo : memory.validTo;
    let validTo: Date | null | undefined;
    if (validToRaw === null || validToRaw === "") {
      validTo = null;
    } else if (validToRaw !== undefined) {
      validTo = validToRaw instanceof Date ? validToRaw : new Date(String(validToRaw));
    }

    update.mutate(
      {
        id: memory.id,
        content: form.content ?? memory.content,
        type: form.type ?? memory.type,
        strength: form.strength ?? memory.strength,
        keywords: form.keywords ?? memory.keywords,
        scope: form.scope ?? memory.scope,
        status: (form.status ?? memory.status) as "active" | "superseded" | undefined,
        attribution: (form.attribution ?? memory.attribution) as
          | "user"
          | "agent"
          | "flush"
          | "experience"
          | "system"
          | null
          | undefined,
        validTo,
      },
      {
        onSuccess: () => router.push("/memories"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
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
              {memoryLabel({ content: String(value("content") ?? memory.content ?? "") })}
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

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">Scope</label>
              <Input
                value={String(value("scope") ?? "global")}
                onChange={(e) => updateField("scope", e.target.value)}
                placeholder="global / workspace:{id} / agent:{id}"
                className="bg-[var(--kp-bg)]"
              />
              <p className="text-[10px] text-[var(--kp-text-3)]">
                写入权限：仅超级 Agent 可写 global；勿伪造他 Agent / Workspace
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">状态</label>
              <select
                value={String(value("status") ?? "active")}
                onChange={(e) => updateField("status", e.target.value)}
                className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm"
              >
                <option value="active">active</option>
                <option value="superseded">superseded</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">归因</label>
              <select
                value={String(value("attribution") ?? "")}
                onChange={(e) =>
                  updateField("attribution", e.target.value ? e.target.value : null)
                }
                className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm"
              >
                <option value="">（未设）</option>
                <option value="user">user</option>
                <option value="agent">agent</option>
                <option value="flush">flush</option>
                <option value="experience">experience</option>
                <option value="system">system</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">有效至（可选）</label>
              <Input
                type="date"
                value={(() => {
                  const v = value("validTo");
                  if (!v) return "";
                  const d = v instanceof Date ? v : new Date(String(v));
                  if (Number.isNaN(d.getTime())) return "";
                  return d.toISOString().slice(0, 10);
                })()}
                onChange={(e) =>
                  updateField("validTo", e.target.value ? e.target.value : null)
                }
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
            <Button variant="outline" type="button" onClick={() => router.push("/memories")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
