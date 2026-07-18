/**
 * 系统设置 — 远程访问 / Cloudflare / 鉴权状态 (L5)
 */

"use client";

import React from "react";
import Link from "next/link";
import {
  Cloud,
  Lock,
  Shield,
  ExternalLink,
  Palette,
  Smartphone,
  CheckCircle2,
  CircleAlert,
  Circle,
  Terminal,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { clearAuthToken } from "@/lib/auth";
import { LoadingState, NativeCapabilitiesPanel, PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { useNativeCapabilities } from "@/lib/hooks";
import { ThemeToggle } from "@/components/themeToggle";
import { cn } from "@/lib/utils";

type CheckTone = "ok" | "warn" | "todo";

function CheckRow({
  tone,
  title,
  detail,
}: {
  tone: CheckTone;
  title: string;
  detail: React.ReactNode;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? CircleAlert : Circle;
  return (
    <li className="flex gap-2.5 text-xs leading-relaxed" data-tone={tone}>
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          tone === "ok" && "text-emerald-700 dark:text-emerald-400",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "todo" && "text-[var(--kp-text-3)]",
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="font-medium text-[var(--kp-text-1)]">{title}</p>
        <p className="mt-0.5 text-[var(--kp-text-2)]">{detail}</p>
      </div>
    </li>
  );
}

export default function SettingsPage() {
  const { data, isLoading, refetch } = trpc.auth.status.useQuery();
  const { data: caps } = useNativeCapabilities();

  const handleLogout = () => {
    clearAuthToken();
    void refetch();
    window.location.href = "/login";
  };

  return (
    <div className="flex-1 space-y-5 overflow-y-auto bg-[var(--kp-bg)] px-3 py-4 sm:space-y-6 sm:p-6 md:p-8">
      <PageHeader
        title="远程访问与安全"
        description="通过 Cloudflare Tunnel 暴露公网时，建议同时启用 Access 或 AUTH_MODE 密码保护。手机请用下方 PUBLIC_URL 或临时隧道地址访问。"
      />

      {isLoading || !data ? (
        <LoadingState count={2} />
      ) : (
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <section
            className="space-y-3 rounded-2xl border border-[var(--kp-brand)]/25 bg-[var(--kp-brand-soft)]/40 p-4 sm:space-y-4 sm:p-6 md:col-span-2"
            data-testid="settings-remote-checklist"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Shield className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              远程就绪检查清单
            </div>
            <ul className="space-y-3">
              <CheckRow
                tone={data.enabled ? "ok" : data.remote.publicUrl ? "warn" : "todo"}
                title="应用鉴权 AUTH_MODE=password"
                detail={
                  data.enabled
                    ? "已启用密码保护。"
                    : "公网暴露前请在 .env 设置 AUTH_MODE=password 与 AUTH_PASSWORD。"
                }
              />
              <CheckRow
                tone={data.remote.publicUrl ? "ok" : "todo"}
                title="PUBLIC_URL（固定域名 / Settings 展示）"
                detail={
                  data.remote.publicUrl ? (
                    <a
                      href={data.remote.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-medium text-[var(--kp-brand-deep)] underline"
                    >
                      {data.remote.publicUrl}
                    </a>
                  ) : (
                    <>
                      命名隧道请写入固定公网 URL。临时{" "}
                      <code className="rounded bg-black/5 px-1 font-mono">trycloudflare.com</code>{" "}
                      同源 rewrite 一般可不写。
                    </>
                  )
                }
              />
              <CheckRow
                tone={data.remote.tunnelConfigured ? "ok" : "todo"}
                title="Cloudflare Tunnel Token / 配置"
                detail={
                  data.remote.tunnelConfigured
                    ? "已检测到 CLOUDFLARE_TUNNEL_TOKEN（适合长期远程）。"
                    : "未配置 Token 也可用临时隧道：仓库根目录执行 pnpm remote。"
                }
              />
              <CheckRow
                tone="todo"
                title="（可选）Cloudflare Access 二次门禁"
                detail="Zero Trust → Access → Self-hosted 应用 + OTP/SSO，与应用密码可叠加。步骤见下方。"
              />
            </ul>
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--kp-bg)]/70 px-3 py-2 text-[11px] text-[var(--kp-text-2)]">
              <Terminal className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
              <span>
                一键远程：<code className="font-mono">pnpm remote</code>（dev + 临时隧道）·{" "}
                <code className="font-mono">pnpm remote:named</code>（Token/config）
              </span>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-4 sm:space-y-4 sm:p-6 md:col-span-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Smartphone className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              手机使用要点
            </div>
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-[var(--kp-text-2)]">
              <li>只用 Tunnel 的 https 地址，不要指望家里局域网 IP 穿网。</li>
              <li>底部导航：首页 / 博客 / Chat / 更多；Chat 左栏在手机上是全屏叠层。</li>
              <li>可「添加到主屏幕」做成类 App 入口；不支持离线（见下方 PWA 说明或文档）。</li>
            </ul>
          </section>

          <section className="space-y-4 rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-4 sm:p-6">
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
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                检测到 PUBLIC_URL 已配置但 AUTH 未启用。公网暴露前请设置 AUTH_MODE=password 或 Cloudflare Access。
              </p>
            )}
          </section>

          <section className="space-y-4 rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-4 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Cloud className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              Cloudflare Tunnel
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-[var(--kp-text-3)]">PUBLIC_URL</dt>
                <dd className="truncate">{data.remote.publicUrl ?? "未配置"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--kp-text-3)]">Tunnel Token</dt>
                <dd>{data.remote.tunnelConfigured ? "已配置" : "未配置"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--kp-text-3)]">CORS</dt>
                <dd>
                  {data.remote.corsOrigins.length
                    ? data.remote.corsOrigins.join(", ")
                    : "默认 localhost"}
                </dd>
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

          <section className="space-y-4 rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-4 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Palette className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              外观主题
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--kp-text-2)]">选择浅色、深色或跟随系统</span>
              <ThemeToggle />
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-4 sm:p-6 md:col-span-2">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Shield className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              Cloudflare Access 检查清单
            </div>
            <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed text-[var(--kp-text-2)]">
              <li>
                Zero Trust →{" "}
                <strong className="font-medium text-[var(--kp-text-1)]">Access → Applications</strong>
                ，为 Tunnel 域名创建 Self-hosted 应用（Application domain = 你的公网主机名）。
              </li>
              <li>
                添加 Policy：身份源选{" "}
                <strong className="font-medium text-[var(--kp-text-1)]">One-time PIN</strong> 或
                Google / GitHub；Include 规则收紧到你自己的邮箱。
              </li>
              <li>
                用无痕窗口打开公网 URL：应先出现 Cloudflare 登录墙，再进入 KnowPilot{" "}
                <code className="rounded bg-black/5 px-1 font-mono">/login</code>（若已开
                AUTH）。
              </li>
              <li>
                与 <code className="rounded bg-black/5 px-1 font-mono">AUTH_MODE=password</code>{" "}
                叠加形成双重保护；Agent 工具仍在本机执行，密码与 Access 都不能替代沙箱。
              </li>
              <li>
                完整步骤见{" "}
                <code className="rounded bg-black/5 px-1 font-mono">
                  docs/development/cloudflare-tunnel.md
                </code>
                。
              </li>
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
