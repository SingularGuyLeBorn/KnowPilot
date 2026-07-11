"use client";

/**
 * Agent 头像系统 — 100 个 SVG 预设
 *
 * 设计：
 * - 20 套莫兰迪双色配色 × 5 种几何 motif = 100 个不重复头像
 * - 按 agent id（cuid）哈希稳定取一个，零迁移、零存储：同一 Agent 永远同一头像
 * - 纯 SVG 渲染，无图片资源，任意尺寸清晰（size 由 consumer 控制）
 * - 配色与项目 --kp 莫兰迪色系同源（低饱和、暖灰底 + 一个克制的强调色），不引入霓虹
 *
 * 配色刻意避开 finesse anti-cheap 黑名单里的「beige+brass 一统天下」：
 * 在莫兰迪基调上轮换鼠尾草、雾蓝、赭石、黏土、梅紫、橄榄等 20 个分支，
 * 每个 Agent 因此有可辨识的「人格色」而非千篇一律的暖咖。
 */

import { memo } from "react";
import { cn } from "@/lib/utils";

export const AVATAR_PRESET_COUNT = 100;

/** 三段式命名（finesse design-dna 约定）：名字 (hex) — 角色约束 */
interface Palette {
  /** 名字 */
  name: string;
  /** 背景顶色（渐变起点） */
  bg: string;
  /** 背景底色（渐变终点） */
  bg2: string;
  /** motif 主色 */
  fg: string;
  /** motif 强调点 */
  accent: string;
}

/** 20 套莫兰迪配色分支 */
const PALETTES: Palette[] = [
  { name: "陶土", bg: "#e8dcd2", bg2: "#d8c3b3", fg: "#7a5c4a", accent: "#b8765a" },
  { name: "鼠尾草", bg: "#dfe4d8", bg2: "#c4ccb4", fg: "#5a6b4a", accent: "#7e9468" },
  { name: "雾蓝", bg: "#d8dfe6", bg2: "#bcc8d4", fg: "#4a5c6b", accent: "#6b8294" },
  { name: "赭石", bg: "#ece0cf", bg2: "#d9c4a3", fg: "#7a5e34", accent: "#b08545" },
  { name: "黏土", bg: "#e6d8ce", bg2: "#d0bda9", fg: "#6e5340", accent: "#a87a5a" },
  { name: "梅紫", bg: "#e0d6e0", bg2: "#c8b8c8", fg: "#5e4a5e", accent: "#8a6a8a" },
  { name: "橄榄", bg: "#e2e2d2", bg2: "#c6c6a8", fg: "#5a5a34", accent: "#82824a" },
  { name: "砂岩", bg: "#e8e2d8", bg2: "#d2c8b8", fg: "#6e6452", accent: "#9a8e72" },
  { name: "青瓷", bg: "#d6e0dc", bg2: "#b4c4be", fg: "#3e5650", accent: "#5e8076" },
  { name: "暮粉", bg: "#ecd6d2", bg2: "#dab8b2", fg: "#7a4a44", accent: "#b07068" },
  { name: "烟灰", bg: "#e0ddd8", bg2: "#c4bfb8", fg: "#4a4642", accent: "#6e6862" },
  { name: "芥末", bg: "#e6e2c8", bg2: "#cec8a0", fg: "#5e5634", accent: "#8a804a" },
  { name: "石板", bg: "#dcdfe4", bg2: "#c0c4cc", fg: "#3e4650", accent: "#5e6876" },
  { name: "砖红", bg: "#e8d4cc", bg2: "#d2b0a2", fg: "#6e4438", accent: "#a0685a" },
  { name: "苔绿", bg: "#dce4d2", bg2: "#bcc8a8", fg: "#4e5e34", accent: "#6e8448" },
  { name: "藕荷", bg: "#e4d8e0", bg2: "#ccbac8", fg: "#5e4654", accent: "#8a6a80" },
  { name: "驼金", bg: "#ece2d4", bg2: "#d8c8b0", fg: "#6e5a3e", accent: "#a08858" },
  { name: "靛青", bg: "#d4d8e4", bg2: "#b4bcd0", fg: "#3e4664", accent: "#5a6494" },
  { name: "焦糖", bg: "#e8dcc8", bg2: "#d2bd9c", fg: "#6e5234", accent: "#a0784a" },
  { name: "冷砂", bg: "#e2e0dc", bg2: "#c8c4be", fg: "#52504a", accent: "#76726a" },
];

const MOTIF_COUNT = 5;

/** cuid → 0..99 稳定哈希（FNV-1a 变体，足够分散） */
export function avatarIndexForId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % AVATAR_PRESET_COUNT;
}

/** 名字兜底哈希（无 id 时用 name，便于静态预览） */
export function avatarIndexForName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % AVATAR_PRESET_COUNT;
}

function presetOf(index: number): { palette: Palette; motif: number } {
  const safe = ((index % AVATAR_PRESET_COUNT) + AVATAR_PRESET_COUNT) % AVATAR_PRESET_COUNT;
  const motif = safe % MOTIF_COUNT;
  const palette = PALETTES[Math.floor(safe / MOTIF_COUNT) % PALETTES.length];
  return { palette, motif };
}

/** 唯一渐变 id 前缀，避免同页多个头像 <defs> 冲突 */
let _uid = 0;
function nextUid(): string {
  _uid = (_uid + 1) & 0xffff;
  return `kpav-${_uid.toString(36)}`;
}

/* ---------- 5 种几何 motif ---------- */

function MotifOrbit({ p }: { p: Palette }) {
  return (
    <g>
      <circle cx="32" cy="32" r="14" fill="none" stroke={p.fg} strokeWidth="2" opacity="0.55" />
      <circle cx="32" cy="32" r="8" fill={p.fg} opacity="0.85" />
      <circle cx="48" cy="20" r="3.2" fill={p.accent} />
      <circle cx="16" cy="44" r="2.4" fill={p.accent} opacity="0.8" />
      <path d="M32 18 A14 14 0 0 1 46 32" fill="none" stroke={p.accent} strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function MotifArcs({ p }: { p: Palette }) {
  return (
    <g strokeLinecap="round">
      <path d="M14 44 A18 18 0 0 1 50 22" fill="none" stroke={p.fg} strokeWidth="3" opacity="0.5" />
      <path d="M18 46 A16 16 0 0 1 48 28" fill="none" stroke={p.fg} strokeWidth="2.4" opacity="0.75" />
      <path d="M22 48 A14 14 0 0 1 46 34" fill="none" stroke={p.accent} strokeWidth="2.4" />
      <circle cx="46" cy="34" r="3" fill={p.accent} />
      <circle cx="14" cy="44" r="2.2" fill={p.fg} opacity="0.7" />
    </g>
  );
}

function MotifConstellation({ p }: { p: Palette }) {
  const pts = [
    [22, 20], [42, 18], [48, 34], [30, 30], [18, 42], [38, 46],
  ] as const;
  return (
    <g>
      <path
        d={`M${pts[0][0]} ${pts[0][1]} L${pts[2][0]} ${pts[2][1]} M${pts[2][0]} ${pts[2][1]} L${pts[4][0]} ${pts[4][1]} M${pts[3][0]} ${pts[3][1]} L${pts[5][0]} ${pts[5][1]}`}
        fill="none"
        stroke={p.fg}
        strokeWidth="1.2"
        opacity="0.5"
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 2 || i === 5 ? 3 : 2} fill={i % 3 === 0 ? p.accent : p.fg} />
      ))}
      <circle cx="32" cy="32" r="1.4" fill={p.accent} opacity="0.8" />
    </g>
  );
}

function MotifPeaks({ p }: { p: Palette }) {
  return (
    <g>
      <path d="M10 46 L24 26 L34 38 L44 22 L54 46 Z" fill={p.fg} opacity="0.55" />
      <path d="M10 46 L24 26 L34 38" fill="none" stroke={p.accent} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="44" cy="22" r="2.6" fill={p.accent} />
      <path d="M10 48 H54" stroke={p.fg} strokeWidth="1.4" opacity="0.4" />
    </g>
  );
}

function MotifGrid({ p }: { p: Palette }) {
  const cells = [0, 1, 2, 3, 4].flatMap((r) =>
    [0, 1, 2, 3, 4].map((c) => [16 + c * 7, 16 + r * 7] as const),
  );
  const lit = new Set([6, 8, 12, 18, 24]);
  return (
    <g>
      {cells.map(([x, y], i) => (
        <rect
          key={i}
          x={x - 2.2}
          y={y - 2.2}
          width="4.4"
          height="4.4"
          rx="1"
          fill={lit.has(i) ? p.accent : p.fg}
          opacity={lit.has(i) ? 0.95 : 0.4}
        />
      ))}
    </g>
  );
}

const MOTIFS = [MotifOrbit, MotifArcs, MotifConstellation, MotifPeaks, MotifGrid];

export interface AgentAvatarProps {
  /** Agent cuid —— 优先用于稳定取头像 */
  id?: string;
  /** Agent 名字 —— 无 id 时兜底 */
  name?: string;
  /** 直接指定 0..99 预设索引（picker 用） */
  index?: number;
  size?: number;
  className?: string;
  /** 圆角风格：默认圆形；传入 'rounded' 得到圆角方块 */
  shape?: "circle" | "rounded";
}

/** 单个 Agent 头像 */
export const AgentAvatar = memo(function AgentAvatar({
  id,
  name,
  index,
  size = 36,
  className,
  shape = "circle",
}: AgentAvatarProps) {
  const idx = index ?? (id ? avatarIndexForId(id) : avatarIndexForName(name ?? "KnowPilot"));
  const { palette, motif } = presetOf(idx);
  const Motif = MOTIFS[motif];
  const gid = nextUid();
  const clipId = `${gid}-clip`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("block shrink-0", className)}
      role="img"
      aria-label={`${palette.name}色 Agent 头像`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.bg} />
          <stop offset="1" stopColor={palette.bg2} />
        </linearGradient>
        <clipPath id={clipId}>
          {shape === "circle" ? <circle cx="32" cy="32" r="32" /> : <rect x="0" y="0" width="64" height="64" rx="14" />}
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="0" width="64" height="64" fill={`url(#${gid})`} />
        {/* 极轻暗角，给 motif 一个光学焦点 */}
        <radialGradient id={`${gid}-vig`} cx="0.5" cy="0.42" r="0.62">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.10" />
        </radialGradient>
        <rect x="0" y="0" width="64" height="64" fill={`url(#${gid}-vig)`} />
        <Motif p={palette} />
      </g>
      {/* 半透明内边框，finesse substrate：translucent borders 而非硬黑线 */}
      {shape === "circle" ? (
        <circle cx="32" cy="32" r="31" fill="none" stroke={palette.fg} strokeOpacity="0.18" />
      ) : (
        <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="none" stroke={palette.fg} strokeOpacity="0.18" />
      )}
    </svg>
  );
});

/* ---------- 选择器：100 个预设网格，供 Agent 编辑器未来接入 ---------- */

export interface AgentAvatarPickerProps {
  /** 当前选中索引 */
  selectedIndex?: number;
  onPick: (index: number) => void;
  size?: number;
  className?: string;
}

export const AgentAvatarPicker = memo(function AgentAvatarPicker({
  selectedIndex,
  onPick,
  size = 40,
  className,
}: AgentAvatarPickerProps) {
  return (
    <div
      className={cn("grid grid-cols-10 gap-1.5", className)}
      role="listbox"
      aria-label="选择 Agent 头像"
    >
      {Array.from({ length: AVATAR_PRESET_COUNT }, (_, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={i}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onPick(i)}
            className={cn(
              "rounded-full p-0.5 transition",
              selected
                ? "ring-2 ring-[var(--kp-brand)] ring-offset-1 ring-offset-[var(--kp-bg)]"
                : "hover:bg-[var(--kp-bg-mute)]",
            )}
            aria-label={`头像 ${i + 1}`}
          >
            <AgentAvatar index={i} size={size} />
          </button>
        );
      })}
    </div>
  );
});
