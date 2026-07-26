"use client";

import { createElement } from "react";

import {
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  CircleX,
  Code,
  Code2,
  Command,
  CornerDownLeft,
  Cpu,
  Eye,
  FileText,
  Files,
  FolderOpen,
  GitBranch,
  HardDrive,
  Hammer,
  Keyboard,
  MessageSquare,
  PenLine,
  Play,
  ScrollText,
  Search,
  Settings,
  Slash,
  Sparkles,
  Terminal,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Lucide 图标名 → 组件（Skill.icon 等 DB 字段只允许存名称，禁止存 emoji） */
const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  Code,
  Code2,
  Cpu,
  Eye,
  FileText,
  Files,
  FolderOpen,
  GitBranch,
  HardDrive,
  Hammer,
  MessageSquare,
  PenLine,
  Play,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Wand2,
  Zap,
};

export function resolveLucideIcon(name?: string | null, fallback: LucideIcon = Wand2): LucideIcon {
  if (!name) return fallback;
  const trimmed = name.trim();
  if (!trimmed || !/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) return fallback;
  return LUCIDE_ICON_MAP[trimmed] ?? fallback;
}

export function LucideIconByName({
  name,
  className,
  fallback = Wand2,
}: {
  name?: string | null;
  className?: string;
  fallback?: LucideIcon;
}) {
  const Icon = resolveLucideIcon(name, fallback);
  return createElement(Icon, { className, "aria-hidden": true });
}

/** KnowPilot 品牌 Logo — SVG，非字母占位 */
export function KnowPilotLogo({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="KnowPilot"
    >
      <rect width="32" height="32" rx="8" className="fill-[var(--kp-brand,#b8a090)]" />
      <path
        d="M10 9h12a1.5 1.5 0 0 1 1.5 1.5V21a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 21V10.5A1.5 1.5 0 0 1 10 9Z"
        stroke="white"
        strokeWidth="1.5"
      />
      <path d="M12 9V7.5A1.5 1.5 0 0 1 13.5 6h5A1.5 1.5 0 0 1 20 7.5V9" stroke="white" strokeWidth="1.5" />
      <path d="M13 14h6M13 17h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="22" cy="22" r="3.5" fill="white" fillOpacity="0.95" />
      <path d="M22 20.2v3.6M20.2 22h3.6" stroke="var(--kp-brand,#b8a090)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 快捷键提示键帽 — 用 Lucide 图标，不用 ↑↓↵ 等字符 */
export function KbdKey({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label?: string;
}) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-1">
      <Icon className="h-3 w-3" aria-hidden />
      {label ? <span className="sr-only">{label}</span> : null}
    </kbd>
  );
}

const kbdBoxClass =
  "inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-1";

/** SVG 键帽字母 K — 非 Unicode 字符 */
function SvgKeyK({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path
        d="M2.5 2v8M2.5 6h3.5M6 2.5l3 3.5M6 9.5l3-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** ⌘/Ctrl + K 快捷键提示 */
export function ShortcutCmdK({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <kbd className={kbdBoxClass}>
        <Command className="h-3 w-3" aria-hidden />
        <span className="sr-only">Command</span>
      </kbd>
      <kbd className={kbdBoxClass}>
        <SvgKeyK className="h-3 w-3" />
        <span className="sr-only">K</span>
      </kbd>
    </span>
  );
}

/** Esc 关闭提示 — 用图标，不用 ESC 文本 */
export function ShortcutEsc({ className }: { className?: string }) {
  return (
    <kbd className={cn(kbdBoxClass, className)}>
      <CircleX className="h-3 w-3" aria-hidden />
      <span className="sr-only">Escape</span>
    </kbd>
  );
}

/** SVG Ctrl 修饰键 — 非 Unicode 字符 */
function SvgKeyCtrl({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 12" fill="none" className={className} aria-hidden>
      <path
        d="M2 3.5h4.5a1.5 1.5 0 1 1 0 3H4v2.5M2 3.5V9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ctrl + Enter 快捷键提示 */
export function ShortcutCtrlEnter({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <kbd className={kbdBoxClass}>
        <SvgKeyCtrl className="h-3 w-3.5" />
        <span className="sr-only">Ctrl</span>
      </kbd>
      <kbd className={kbdBoxClass}>
        <CornerDownLeft className="h-3 w-3" aria-hidden />
        <span className="sr-only">Enter</span>
      </kbd>
    </span>
  );
}

/** / + Skill 快捷键提示 */
export function ShortcutSlashSkill({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <kbd className={kbdBoxClass}>
        <Slash className="h-3 w-3" aria-hidden />
        <span className="sr-only">斜杠</span>
      </kbd>
      <Wand2 className="h-3.5 w-3.5 text-[var(--kp-text-3)]" aria-hidden />
    </span>
  );
}

/**
 * 聊天快捷键提示 — 收成一枚键盘图标，悬停看完整说明。
 * 避免在空输入框右上角堆一排 kbd（视觉噪音大、像第二套工具栏）。
 */
export function ChatShortcutHints({
  isStreaming = false,
  className,
}: {
  isStreaming?: boolean;
  className?: string;
}) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--kp-text-3)] transition hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-2)]",
            className,
          )}
          aria-label="快捷键说明"
        >
          <Keyboard className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] space-y-1 px-3 py-2 text-left text-[11px] leading-relaxed">
          <div>Enter · 换行</div>
          <div>{isStreaming ? "Ctrl+Enter · 加入队列" : "Ctrl+Enter · 发送"}</div>
          <div>/ · 选择 Skill</div>
          <div>/compact · 压缩上下文</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** 统一 source key（platform-sync 用 screenshots 复数） */
function normalizePlatformSource(source: string): string {
  if (source === "screenshots") return "screenshot";
  return source;
}

const PLATFORM_LABELS: Record<string, string> = {
  zhihu: "知乎",
  xhs: "小红书",
  bilibili: "B站",
  wechat: "微信",
  screenshot: "截图",
  url: "链接",
};

export function platformSourceLabel(source: string): string {
  const key = normalizePlatformSource(source);
  return PLATFORM_LABELS[key] ?? source;
}

/** 主题线稿：底 brand-soft，线 brand-deep；属性写死在 path 上，避免 g 透传异常 */
function PlatformGlyph({ source }: { source: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (source) {
    case "zhihu":
      return (
        <>
          <path
            {...common}
            d="M9 12c0-3.3 3-6 7-6s6.2 2.2 6.8 5.2A5 5 0 0 1 21 20.5h-1l-3 2.2.7-2.2A6.2 6.2 0 0 1 9 12z"
          />
          <path {...common} d="M14.5 10.6c.8-.8 2.2-.8 3 0 .6.6.6 1.5 0 2.1-.5.5-1 .7-1.3 1.3-.2.4-.3.8-.3 1.2" />
          <circle cx="16" cy="18.2" r="0.9" fill="currentColor" />
        </>
      );
    case "xhs":
      return (
        <>
          <path
            {...common}
            d="M10 9h10a2 2 0 0 1 2 2v11.2c0 .5-.6.8-1 .5l-3.2-2.1H10a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z"
          />
          <path {...common} d="M12.2 13.5h6.5M12.2 16.5h4.5" />
        </>
      );
    case "bilibili":
      return (
        <>
          <rect {...common} x="7.5" y="11.5" width="17" height="12" rx="2.8" />
          <path {...common} d="M11.5 8.2l2.8 3M20.5 8.2l-2.8 3" />
          <circle cx="13" cy="16.8" r="1" fill="currentColor" />
          <circle cx="19" cy="16.8" r="1" fill="currentColor" />
          <path {...common} d="M14 19.5c1 0.9 3 0.9 4 0" />
        </>
      );
    case "wechat":
      return (
        <>
          <path
            {...common}
            d="M11.5 9.5c-3.6 0-6.5 2.4-6.5 5.3 0 1.7.9 3.2 2.4 4.1l-.5 1.8 2.1-1.1c.7.2 1.5.3 2.3.3.4 0 .7 0 1.1-.1"
          />
          <path
            {...common}
            d="M15.2 15c0-2.8 2.8-5.1 6.3-5.1S27.8 12.2 27.8 15s-2.8 5.1-6.3 5.1c-.7 0-1.4-.1-2.1-.3l-2 1 .4-1.7c-1.4-1-2.2-2.4-2.2-4.1z"
          />
          <circle cx="19.4" cy="14.9" r="0.75" fill="currentColor" />
          <circle cx="23.2" cy="14.9" r="0.75" fill="currentColor" />
        </>
      );
    case "screenshot":
      return (
        <>
          <rect {...common} x="7.5" y="10.8" width="17" height="12.5" rx="2.4" />
          <circle {...common} cx="16" cy="17" r="3" />
          <path {...common} d="M11.5 10.8l1-2h7l1 2" />
        </>
      );
    case "url":
      return (
        <>
          <path {...common} d="M13.2 19l-1.1 1.1a2.8 2.8 0 0 1-4-4l2.5-2.5a2.8 2.8 0 0 1 4 0" />
          <path {...common} d="M18.8 13l1.1-1.1a2.8 2.8 0 0 1 4 4l-2.5 2.5a2.8 2.8 0 0 1-4 0" />
          <path {...common} d="M13.8 18.2l4.4-4.4" />
        </>
      );
    default:
      return (
        <>
          <circle {...common} cx="16" cy="16" r="6.5" />
          <path {...common} d="M16 13v3.2l2 1.2" />
        </>
      );
  }
}

export function PlatformSourceIcon({
  source,
  size = 20,
  className,
  title,
}: {
  source: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const key = normalizePlatformSource(source);
  const label = PLATFORM_LABELS[key] ?? source;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 text-[var(--kp-brand-deep)]", className)}
      role="img"
      aria-label={title ?? label}
    >
      <rect width="32" height="32" rx="8" fill="var(--kp-brand-soft)" />
      <PlatformGlyph source={key} />
    </svg>
  );
}
