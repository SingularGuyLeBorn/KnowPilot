"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSkill } from "@/lib/hooks";
import type { Skill } from "@knowpilot/shared";

export default function SkillDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useSkill();
  const { data: skill, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<Skill>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--kp-text-2)]">Skill 不存在</p>
          <Link href="/skills" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = (key: keyof Skill) => (form[key] !== undefined ? form[key] : skill[key]);

  const updateField = <K extends keyof Skill>(key: K, val: Skill[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = { id: skill.id };
    const fields: (keyof Skill)[] = ["name", "description", "trigger", "icon", "enabled", "code", "metaJson"];
    for (const field of fields) {
      const v = form[field] !== undefined ? form[field] : skill[field];
      payload[field] = v;
    }
    update.mutate(payload, {
      onSuccess: () => router.push("/skills"),
      onError: (err: Error) => setError(err.message || "保存失败"),
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/skills"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-soft)] text-[var(--kp-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)] flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-[var(--kp-brand-deep)]" />
              {skill.name}
            </h1>
            <p className="text-xs text-[var(--kp-text-3)]">ID: {skill.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">名称</label>
            <Input value={String(value("name") ?? "")} onChange={(e) => updateField("name", e.target.value)} className="bg-[var(--kp-bg)]" />
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
              <label className="text-sm font-medium text-[var(--kp-text-1)]">触发词</label>
              <Input value={String(value("trigger") ?? "")} onChange={(e) => updateField("trigger", e.target.value)} className="bg-[var(--kp-bg)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-[var(--kp-text-1)]">图标</label>
              <Input value={String(value("icon") ?? "")} onChange={(e) => updateField("icon", e.target.value)} placeholder="Lucide 图标名称" className="bg-[var(--kp-bg)]" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--kp-text-2)]">
            <input
              type="checkbox"
              checked={Boolean(value("enabled"))}
              onChange={(e) => updateField("enabled", e.target.checked)}
              className="h-4 w-4 rounded border-[var(--kp-divider)] text-[var(--kp-brand-deep)] focus:ring-[var(--kp-brand-deep)]"
            />
            启用
          </label>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">代码</label>
            <textarea
              value={String(value("code") ?? "")}
              onChange={(e) => updateField("code", e.target.value)}
              rows={12}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">元数据 JSON</label>
            <textarea
              value={String(value("metaJson") ?? "")}
              onChange={(e) => updateField("metaJson", e.target.value)}
              rows={4}
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
            <Button variant="outline" type="button" onClick={() => router.push("/skills")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
