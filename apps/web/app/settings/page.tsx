/**
 * 系统设置 — 远程访问 / Cloudflare / 鉴权状态 (L5)
 */

"use client";

import React from "react";
import Link from "next/link";
import { Cloud, Lock, Shield, ExternalLink, Palette } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { clearAuthToken } from "@/lib/auth";
import { LoadingState, NativeCapabilitiesPanel, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { useNativeCapabilities } from "@/lib/hooks";
import { ThemeToggle } from "@/components/themeToggle";

export default function SettingsPage() {
  const { data, isLoading, refetch } = trpc.auth.status.useQuery();
  const { data: caps } = useNativeCapabilities();

  const handleLogout = () => {
    clearAuthToken();
    void refetch();
    window.location.href = "/login";
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        title="远程访问与安全"
        description="通过 Cloudflare Tunnel 暴露公网时，建议同时启用 Access 或 AUTH_MODE 密码保护。"
      />

      {isLoading || !data ? (
        <LoadingState count={2} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Lock className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              应用鉴权
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-[var(--kp-text-3)]">AUTH 模式</dt>
                <dd>{data.enabled ? "password（已启用）" : "none（单用户开放）"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--kp-text-3)]">当前会话</dt>
                <dd>{data.authenticated ? "已登录" : "未登录"}</dd>
              </div>
            </dl>
            {data.enabled && data.authenticated && (
              <Button variant="outline" size="sm" onClick={handleLogout}>
                退出登录
              </Button>
            )}
            {data.remote.authRecommended && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3">
                检测到 PUBLIC_URL 已配置但 AUTH 未启用。公网暴露前请设置 AUTH_MODE=password 或 Cloudflare Access。
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Cloud className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              Cloudflare Tunnel
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--kp-text-3)] shrink-0">PUBLIC_URL</dt>
                <dd className="truncate">{data.remote.publicUrl ?? "未配置"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--kp-text-3)]">Tunnel Token</dt>
                <dd>{data.remote.tunnelConfigured ? "已配置" : "未配置"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--kp-text-3)]">CORS</dt>
                <dd>{data.remote.corsOrigins.length ? data.remote.corsOrigins.join(", ") : "默认 localhost"}</dd>
              </div>
            </dl>
            <Link
              href="https://one.dash.cloudflare.com/"
              target="_blank"
              className="inline-flex items-center gap-1 text-xs text-[var(--kp-brand-deep)] hover:underline"
            >
              Cloudflare Zero Trust 控制台
              <ExternalLink className="h-3 w-3" />
            </Link>
          </section>

          <section className="rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Palette className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              外观主题
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--kp-text-2)]">选择浅色、深色或跟随系统</span>
              <ThemeToggle />
            </div>
          </section>

          <section className="md:col-span-2 rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)] mb-3">
              <Shield className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              Cloudflare Access 建议步骤
            </div>
            <ol className="list-decimal list-inside space-y-2 text-xs text-[var(--kp-text-2)]">
              <li>在 Zero Trust → Access → Applications 为 Tunnel 域名创建 Self-hosted 应用</li>
              <li>Policy 选择 One-time PIN 或 Google / GitHub 登录</li>
              <li>与 AUTH_MODE=password 叠加可形成双重保护</li>
              <li>详见项目文档 docs/deployment/cloudflare-tunnel.md</li>
            </ol>
          </section>
        </div>
      )}

      {caps && (
        <NativeCapabilitiesPanel
          data={caps}
          compact
          title="原生运行时能力"
          showSearchEnginesInCompact
          detailHref="/tools"
          detailLabel="Tools 详情"
        />
      )}
    </div>
  );
}
