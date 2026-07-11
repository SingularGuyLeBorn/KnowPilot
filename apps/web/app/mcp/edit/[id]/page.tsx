"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMcp } from "@/lib/hooks";
import type { McpServer } from "@knowpilot/shared";

export default function McpDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { useById, useUpdate } = useMcp();
  const { data: server, isLoading } = useById(id);
  const update = useUpdate();

  const [form, setForm] = useState<Partial<McpServer>>({});
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--kp-brand-deep)]" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[var(--kp-text-2)]">MCP 服务器不存在</p>
          <Link href="/mcp" className="text-sm text-[var(--kp-brand-deep)] hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const value = <K extends keyof McpServer>(key: K) =>
    form[key] !== undefined ? form[key] : server[key];

  const updateField = <K extends keyof McpServer>(key: K, val: McpServer[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const parseArgs = (text: string) =>
    text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const formatArgs = (args?: string[]) => (args ?? []).join("\n");

  const parseEnv = (text: string): Record<string, string> => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, string>;
    } catch {
      // ignore
    }
    return {};
  };

  const formatEnv = (env?: Record<string, string>) => JSON.stringify(env ?? {}, null, 2);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    update.mutate(
      {
        id: server.id,
        name: form.name ?? server.name,
        command: form.command ?? server.command,
        args: form.args ?? server.args,
        env: form.env ?? server.env,
        enabled: form.enabled ?? server.enabled,
      },
      {
        onSuccess: () => router.push("/mcp"),
        onError: (err: Error) => setError(err.message || "保存失败"),
      },
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/mcp"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--kp-bg-soft)] text-[var(--kp-text-1)]"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)] flex items-center gap-2">
              <Cpu className="w-5 h-5 text-[var(--kp-brand-deep)]" />
              {server.name}
            </h1>
            <p className="text-xs text-[var(--kp-text-3)]">ID: {server.id}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">名称</label>
            <Input value={String(value("name") ?? "")} onChange={(e) => updateField("name", e.target.value)} className="bg-[var(--kp-bg)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">命令</label>
            <Input value={String(value("command") ?? "")} onChange={(e) => updateField("command", e.target.value)} placeholder="npx / uvx / node" className="bg-[var(--kp-bg)]" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">参数（每行一个）</label>
            <textarea
              value={formatArgs(value("args") as string[] | undefined)}
              onChange={(e) => updateField("args", parseArgs(e.target.value))}
              rows={4}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--kp-text-1)]">环境变量（JSON）</label>
            <textarea
              value={formatEnv(value("env") as Record<string, string> | undefined)}
              onChange={(e) => updateField("env", parseEnv(e.target.value))}
              rows={5}
              className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand-deep)] focus:ring-1 focus:ring-[var(--kp-brand-deep)] resize-y font-mono"
            />
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
            <Button variant="outline" type="button" onClick={() => router.push("/mcp")}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
