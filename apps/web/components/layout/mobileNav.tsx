"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  PenLine,
  MessageSquare,
  LayoutGrid,
  X,
  Bot,
  Wand2,
  Cpu,
  Brain,
  HardDrive,
  Files,
  GitBranch,
  CalendarClock,
  ScrollText,
  Settings,
  Zap,
  ShieldCheck,
  FileCode2,
  Search,
  BarChart3,
  Wrench,
  Activity,
  KeyRound,
  Globe,
  Sparkles,
  PlusCircle,
  UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileMoreItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  group: string;
};

/** 底栏「更多」里的全站入口（与 Sidebar 对齐，便于手机摸到管理页） */
export const MOBILE_MORE_ITEMS: MobileMoreItem[] = [
  { href: "/dashboard", icon: BarChart3, label: "系统看板", group: "常用" },
  { href: "/agents", icon: Bot, label: "Agents", group: "常用" },
  { href: "/approvals", icon: ShieldCheck, label: "审批队列", group: "常用" },
  { href: "/free-models", icon: Sparkles, label: "免费模型", group: "常用" },
  { href: "/settings", icon: Settings, label: "系统设置", group: "常用" },
  { href: "/subagents", icon: Bot, label: "子 Agent 任务", group: "智能工作台" },
  { href: "/skills", icon: Wand2, label: "Skill 管理", group: "智能工作台" },
  { href: "/mcp", icon: Cpu, label: "MCP 服务器", group: "智能工作台" },
  { href: "/sources", icon: Globe, label: "信息源", group: "智能工作台" },
  { href: "/memories", icon: Brain, label: "长期记忆", group: "智能工作台" },
  { href: "/prompts", icon: FileCode2, label: "提示词模板", group: "智能工作台" },
  { href: "/tools", icon: Wrench, label: "工具注册", group: "智能工作台" },
  { href: "/runs", icon: Activity, label: "执行记录", group: "智能工作台" },
  { href: "/search", icon: Search, label: "全局搜索", group: "智能工作台" },
  { href: "/triggers", icon: Zap, label: "事件触发器", group: "自动化" },
  { href: "/workspaces", icon: HardDrive, label: "工作区管理", group: "系统与运维" },
  { href: "/files", icon: Files, label: "文件管理", group: "系统与运维" },
  { href: "/git", icon: GitBranch, label: "Git 仓库", group: "系统与运维" },
  { href: "/tasks", icon: CalendarClock, label: "后台任务", group: "系统与运维" },
  { href: "/logs", icon: ScrollText, label: "运行日志", group: "系统与运维" },
  { href: "/credentials", icon: KeyRound, label: "凭据管理", group: "系统与运维" },
  { href: "/editor", icon: PlusCircle, label: "写作", group: "博客" },
  { href: "/about", icon: UserCircle, label: "About", group: "博客" },
];

const PRIMARY = [
  { href: "/", icon: Home, label: "首页", match: (p: string) => p === "/" || p === "" },
  {
    href: "/posts",
    icon: PenLine,
    label: "博客",
    match: (p: string) =>
      p.startsWith("/posts") || p.startsWith("/categories") || p.startsWith("/tags") || p.startsWith("/editor"),
  },
  {
    href: "/chat",
    icon: MessageSquare,
    label: "Chat",
    match: (p: string) => p.startsWith("/chat"),
  },
] as const;

function isMoreActive(pathname: string): boolean {
  if (PRIMARY.some((t) => t.match(pathname))) return false;
  return MOBILE_MORE_ITEMS.some(
    (item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)),
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const moreActive = isMoreActive(pathname);

  const grouped = useMemo(() => {
    const map = new Map<string, MobileMoreItem[]>();
    for (const item of MOBILE_MORE_ITEMS) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, []);

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="更多导航">
          <button
            type="button"
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            aria-label="关闭"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 max-h-[78dvh] overflow-y-auto rounded-t-2xl",
              "border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-2xl",
              "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] pt-3",
            )}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--kp-bg-mute)]" />
            <div className="mb-2 flex items-center justify-between px-4">
              <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">更多</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                aria-label="关闭更多"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-3 pb-2">
              {grouped.map(([group, items]) => (
                <div key={group}>
                  <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-[var(--kp-text-3)]">
                    {group}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const active =
                        pathname === item.href ||
                        (item.href !== "/" && pathname.startsWith(item.href));
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          className={cn(
                            "flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                            active
                              ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                              : "bg-[var(--kp-bg)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="手机主导航"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 border-t border-[var(--kp-divider)]",
          "bg-[var(--kp-glass-bg)] backdrop-blur-md md:hidden",
          "pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <div className="grid h-14 grid-cols-4">
          {PRIMARY.map((tab) => {
            const Icon = tab.icon;
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition",
                  active
                    ? "text-[var(--kp-brand-deep)]"
                    : "text-[var(--kp-text-3)] active:bg-[var(--kp-bg-mute)]",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.25]")} />
                {tab.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition",
              moreActive || moreOpen
                ? "text-[var(--kp-brand-deep)]"
                : "text-[var(--kp-text-3)] active:bg-[var(--kp-bg-mute)]",
            )}
            aria-expanded={moreOpen}
            aria-label="更多"
          >
            <LayoutGrid className={cn("h-5 w-5", (moreActive || moreOpen) && "stroke-[2.25]")} />
            更多
          </button>
        </div>
      </nav>
    </>
  );
}
