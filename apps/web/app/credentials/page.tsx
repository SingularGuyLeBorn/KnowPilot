/**
 * Credentials 凭据管理页面 (L5 敏感数据)
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Plus, ShieldAlert, Download } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Credential } from "@knowpilot/shared";
import { useCredential } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, Pagination } from "@/components/shared";

const TYPE_LABEL: Record<Credential["type"], string> = {
  api_key: "API Key",
  token: "Token",
  password: "密码",
};

function maskValue(value: string): string {
  return value || "••••••••";
}

const SCOPE_COLORS: Record<string, string> = {
  llm: "bg-emerald-500/10 text-emerald-700",
  github: "bg-slate-500/10 text-slate-700",
  feishu: "bg-blue-500/10 text-blue-700",
  yuque: "bg-amber-500/10 text-amber-700",
  search: "bg-purple-500/10 text-purple-700",
  mcp: "bg-pink-500/10 text-pink-700",
  browser: "bg-cyan-500/10 text-cyan-700",
};

function formatExpiresAt(expiresAt?: string | Date | null): string | null {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (isNaN(d.getTime())) return null;
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天过期";
  return `${days} 天后过期`;
}

export default function CredentialsPage() {
  const { useList, useCreate, useDelete, useImportFromEnv } = useCredential();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const importMutation = useImportFromEnv();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const handleCreateDemo = () => {
    createMutation.mutate({
      name: `demo_key_${Date.now().toString(36).slice(-4)}`,
      type: "api_key",
      value: `kp-demo-${Math.random().toString(36).slice(2, 10)}`,
      scope: ["llm"],
    });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
    }
  };

  const handleImportFromEnv = () => {
    importMutation.mutate(undefined, {
      onSuccess: (res) => {
        alert(`导入完成：${res.imported.length} 个成功，${res.skipped.length} 个已存在跳过`);
      },
      onError: (err) => alert(`导入失败：${err.message}`),
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-[var(--vp-c-divider)] bg-gradient-to-br from-[var(--vp-c-bg-alt)] to-[var(--vp-c-bg-soft)] p-8 shadow-sm"
      >
        <div className="absolute right-0 top-0 -translate-y-12 translate-x-12 opacity-5 blur-2xl">
          <KeyRound className="w-80 h-80 text-[var(--vp-c-brand)]" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700">
              <ShieldAlert className="w-3.5 h-3.5" />
              敏感数据 · 本地存储
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--vp-c-text-1)]">
              Credentials 凭据库
            </h1>
            <p className="text-sm text-[var(--vp-c-text-3)] max-w-xl">
              管理 API Key / Token 等敏感凭据，按 scope 隔离用途。启用 AUTH_MODE=password 时建议配合远程访问使用。
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto shrink-0">
            <Button
              onClick={handleImportFromEnv}
              disabled={importMutation.isPending}
              variant="outline"
              className="flex items-center gap-2 px-5 py-6 rounded-2xl border-[var(--vp-c-divider)] hover:bg-[var(--vp-c-bg-soft)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Download className="w-5 h-5" />
              从 .env 导入
            </Button>
            <Button
              onClick={handleCreateDemo}
              disabled={createMutation.isPending}
              className="flex items-center gap-2 bg-[var(--vp-c-brand)] text-white hover:bg-[var(--vp-c-brand-dark)] px-5 py-6 rounded-2xl shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-5 h-5" />
              添加示例凭据
            </Button>
          </div>
        </div>
      </motion.div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="凭据库为空"
          description="尚未保存任何 API Key 或 Token。也可继续使用 .env 中的环境变量。"
          actionLabel="添加示例凭据"
          onAction={handleCreateDemo}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.items.map((cred: Credential, idx: number) => (
              <motion.div
                key={cred.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.04, type: "spring", stiffness: 200, damping: 20 },
                }}
                className="group relative overflow-hidden rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 p-5 hover:shadow-lg transition-all"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-sm text-[var(--vp-c-text-1)]">{cred.name}</h3>
                    <span className="text-[10px] text-[var(--vp-c-text-3)]">{TYPE_LABEL[cred.type]}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link
                      href={`/credentials/edit/${cred.id}`}
                      className="text-xs text-[var(--vp-c-brand)] hover:text-[var(--vp-c-brand-dark)] px-2 py-0.5 rounded hover:bg-[var(--vp-c-brand-soft)]"
                    >
                      编辑
                    </Link>
                    <button
                      type="button"
                      onClick={() => setDeleteId(cred.id)}
                      className="text-xs text-red-500 hover:text-red-600"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-[var(--vp-c-bg-soft)] px-3 py-2 font-mono text-xs text-[var(--vp-c-text-2)] mb-3">
                  <span className="flex-1 truncate">{maskValue(cred.valuePreview)}</span>
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  {(cred.scope ?? []).map((s) => (
                    <span
                      key={s}
                      className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${SCOPE_COLORS[s] || "bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]"}`}
                    >
                      {s}
                    </span>
                  ))}
                  {(!cred.scope || cred.scope.length === 0) && (
                    <span className="text-[10px] text-[var(--vp-c-text-3)]">无 scope</span>
                  )}
                </div>
                {cred.expiresAt && (
                  <div className="text-[10px] text-[var(--vp-c-text-3)]">
                    {formatExpiresAt(cred.expiresAt)}
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {data && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="删除凭据"
        description="确定永久删除该凭据吗？依赖此 Key 的集成将无法继续工作。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
