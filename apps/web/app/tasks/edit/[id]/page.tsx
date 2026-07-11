"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTask } from "@/lib/hooks";
import type { Task } from "@knowpilot/shared";

const STATUS_OPTIONS = ["pending", "running", "success", "failed"] as const;

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useTask();
  const { data: task, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Task>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--kp-text-2)]">Task 不存在</p>
          <Link href="/tasks" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof Task>(key: K) =>
    form[key] !== undefined ? form[key] : task[key];

  const updateField = <K extends keyof Task>(key: K, val: Task[K]) => {
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
        id: task.id,
        name: form.name ?? task.name,
        status: form.status ?? task.status,
        sessionId: form.sessionId !== undefined ? nullableString(form.sessionId) : task.sessionId,
        cronExpression: form.cronExpression !== undefined ? nullableString(form.cronExpression) : task.cronExpression,
        input: form.input !== undefined ? form.input : task.input,
        output: form.output !== undefined ? form.output : task.output,
      },
      {
        onSuccess: () => router.push("/tasks"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/tasks"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-soft)] text-[var(--kp-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)] flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-[var(--kp-brand-deep)]" />
              {task.name}
            </h1>
            <p className="text-xs text-[var(--kp-text-3)]">ID: {task.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">名称</label>
            <Input value={String(value("name") ?? "")} onChange={(e) => updateField("name", e.target.value)} className="bg-[var(--kp-bg)]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">状态</label>
              <select
                value={String(value("status") ?? "pending")}
                onChange={(e) => updateField("status", e.target.value as Task["status"])}
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
              <label className="text-sm font-medium text-[var(--kp-text-1)]">Cron 表达式</label>
              <Input
                value={value("cronExpression") ?? ""}
                onChange={(e) => updateField("cronExpression", e.target.value || null)}
                placeholder="留空表示单次任务"
                className="bg-[var(--kp-bg)]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">会话 ID</label>
            <Input
              value={value("sessionId") ?? ""}
              onChange={(e) => updateField("sessionId", e.target.value || null)}
              placeholder="可选"
              className="bg-[var(--kp-bg)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">输入（JSON）</label>
            <textarea
              value={stringifyJson(value("input"))}
              onChange={(e) => updateField("input", parseJson(e.target.value))}
              rows={6}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">输出（JSON）</label>
            <textarea
              value={stringifyJson(value("output"))}
              onChange={(e) => updateField("output", parseJson(e.target.value))}
              rows={6}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y font-mono"
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
            <Button variant="outline" type="button" onClick={() => router.push("/tasks")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
