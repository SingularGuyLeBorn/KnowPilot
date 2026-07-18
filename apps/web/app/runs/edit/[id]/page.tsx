"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRun } from "@/lib/hooks";
import type { Run } from "@knowpilot/shared";
import { runLabel } from "@/lib/displayLabels";

const STATUS_OPTIONS = ["pending", "running", "success", "failed", "cancelled"] as const;

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useRun();
  const { data: run, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Run>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--kp-text-2)]">Run 记录不存在</p>
          <Link href="/runs" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof Run>(key: K) =>
    form[key] !== undefined ? form[key] : run[key];

  const updateField = <K extends keyof Run>(key: K, val: Run[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const stringifyJson = (v: unknown) =>
    v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2);

  const parseJson = (text: string): unknown => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      {
        id: run.id,
        status: form.status ?? run.status,
        output: form.output !== undefined ? form.output : run.output,
        toolCalls: form.toolCalls !== undefined ? form.toolCalls : run.toolCalls,
        tokenUsage: form.tokenUsage !== undefined ? form.tokenUsage : run.tokenUsage,
        error: form.error !== undefined ? form.error : run.error,
        durationMs: form.durationMs ?? run.durationMs,
      },
      {
        onSuccess: () => router.push("/runs"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  const jsonField = (label: string, key: keyof Run, rows = 6) => (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-[var(--kp-text-1)]">{label}</label>
      <textarea
        value={stringifyJson(value(key))}
        onChange={(e) => updateField(key, parseJson(e.target.value) as Run[keyof Run])}
        rows={rows}
        className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y font-mono"
      />
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/runs"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-soft)] text-[var(--kp-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)] flex items-center gap-2">
              <Activity className="w-5 h-5 text-[var(--kp-brand-deep)]" />
              {runLabel({ status: String(value("status") ?? run.status) })}
            </h1>
            <p className="text-xs text-[var(--kp-text-3)]">ID: {run.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">状态</label>
              <select
                value={String(value("status") ?? "pending")}
                onChange={(e) => updateField("status", e.target.value as Run["status"])}
                className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)]"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">耗时（ms）</label>
              <Input
                type="number"
                min={0}
                value={String(value("durationMs") ?? "")}
                onChange={(e) => updateField("durationMs", Number(e.target.value))}
                className="bg-[var(--kp-bg)]"
              />
            </div>
          </div>

          {jsonField("输出", "output", 8)}
          {jsonField("工具调用", "toolCalls", 6)}
          {jsonField("Token 用量", "tokenUsage", 4)}
          {jsonField("错误", "error", 4)}

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
            <Button variant="outline" type="button" onClick={() => router.push("/runs")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
