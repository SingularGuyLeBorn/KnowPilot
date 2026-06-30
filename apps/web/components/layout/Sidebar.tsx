"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Wand2,
  Cpu,
  Brain,
  MessageSquare,
  HardDrive,
  Files,
  GitBranch,
  CalendarClock,
  ScrollText,
  Settings,
  ChevronDown,
  ChevronRight,
  Zap,
  ShieldCheck,
  FileCode2,
  Search,
  BarChart3,
  Wrench,
  Activity,
  KeyRound,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KnowPilotLogo } from "@/lib/icons";

interface SidebarProps {
  className?: string;
}

interface NavSubItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavSubItem[];
}

const STORAGE_KEY = "kp-sidebar-width";
const MIN_WIDTH = 240;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 288;

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    ai: true,
    ops: true,
    automation: true,
  });

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(saved))));
        }
      } catch {
        // ignore
      }
    });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsResizing(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [width]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (e: PointerEvent) => {
      const delta = e.clientX - startXRef.current;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + delta));
      setWidth(next);
    };

    const handleUp = () => {
      setIsResizing(false);
      try {
        localStorage.setItem(STORAGE_KEY, String(width));
      } catch {
        // ignore
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
    };
  }, [isResizing, width]);

  const navGroups: Record<string, NavGroup> = {
    ai: {
      title: "智能工作台",
      icon: Cpu,
      items: [
        { href: "/chat", icon: MessageSquare, label: "Agent 对话" },
        { href: "/agents", icon: Bot, label: "Agent 管理" },
        { href: "/skills", icon: Wand2, label: "Skill 管理" },
        { href: "/mcp", icon: Cpu, label: "MCP 服务器" },
        { href: "/sources", icon: Globe, label: "信息源" },
        { href: "/memories", icon: Brain, label: "长期记忆" },
        { href: "/prompts", icon: FileCode2, label: "提示词模板" },
        { href: "/tools", icon: Wrench, label: "工具注册" },
        { href: "/runs", icon: Activity, label: "执行记录" },
        { href: "/search", icon: Search, label: "全局搜索" },
      ],
    },
    automation: {
      title: "自动化与工作流",
      icon: Zap,
      items: [
        { href: "/triggers", icon: Zap, label: "事件触发器" },
        { href: "/approvals", icon: ShieldCheck, label: "审批队列" },
      ],
    },
    ops: {
      title: "系统与运维",
      icon: Settings,
      items: [
        { href: "/workspaces", icon: HardDrive, label: "工作区管理" },
        { href: "/files", icon: Files, label: "文件管理" },
        { href: "/git", icon: GitBranch, label: "Git 仓库" },
        { href: "/tasks", icon: CalendarClock, label: "后台任务" },
        { href: "/logs", icon: ScrollText, label: "运行日志" },
        { href: "/credentials", icon: KeyRound, label: "凭据管理" },
        { href: "/dashboard", icon: BarChart3, label: "系统看板" },
        { href: "/settings", icon: Settings, label: "系统设置" },
      ],
    },
  };

  const renderNavGroup = (key: string, group: NavGroup) => {
    const isExpanded = expandedGroups[key];
    const GroupIcon = group.icon;
    return (
      <div key={key} className="space-y-1">
        <button
          type="button"
          onClick={() => toggleGroup(key)}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
        >
          <span className="flex items-center gap-2">
            <GroupIcon className="h-4 w-4 text-[var(--kp-brand)]" />
            {group.title}
          </span>
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {isExpanded && (
          <div className="space-y-0.5 pl-1">
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              const ItemIcon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                    isActive
                      ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                      : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]"
                  )}
                >
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      suppressHydrationWarning
      className={cn(
        "relative flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]",
        isResizing && "select-none",
        className
      )}
      style={{ width }}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <Link href="/" className="flex shrink-0 items-center gap-3 border-b border-[var(--kp-divider)] px-5 py-4 transition hover:bg-[var(--kp-bg-mute)]">
          <KnowPilotLogo size={36} className="shrink-0" />
          <div>
            <p className="text-base font-bold tracking-tight text-[var(--kp-text-1)]">控制台</p>
            <p className="text-xs text-[var(--kp-text-3)]">Agent · 运维</p>
          </div>
        </Link>

        {/* 主导航：占满剩余高度 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          {Object.entries(navGroups).map(([key, group]) => renderNavGroup(key, group))}
        </div>
      </div>

      <div
        onPointerDown={handlePointerDown}
        className={cn(
          "absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-[var(--kp-brand)]/20",
          isResizing && "bg-[var(--kp-brand)]/30"
        )}
        aria-label="调整侧边栏宽度"
        role="separator"
      />
    </aside>
  );
}
