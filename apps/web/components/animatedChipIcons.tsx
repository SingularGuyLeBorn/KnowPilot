"use client";

/**
 * Kimi 风格能力 chip 动态图标 —— 悬停/激活时 SVG 微动效（零 Lottie 依赖）。
 * 尊重 prefers-reduced-motion：降级为静态。
 */

import type { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 22 };

export type ChipIconState = "idle" | "hover" | "active";

interface IconProps {
  className?: string;
  state?: ChipIconState;
}

function useMotionSafe() {
  const reduce = useReducedMotion();
  return !reduce;
}

function IconShell({
  className,
  children,
  state = "idle",
  variants,
}: {
  className?: string;
  children: ReactNode;
  state?: ChipIconState;
  variants: Variants;
}) {
  const animate = useMotionSafe();
  return (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
      initial="idle"
      animate={animate ? state : "idle"}
      variants={variants}
      aria-hidden
    >
      {children}
    </motion.svg>
  );
}

/** 深度研究：显微镜轻微倾斜 + 物镜闪一下 */
export function IconDeepResearch({ className, state = "idle" }: IconProps) {
  const variants: Variants = {
    idle: { rotate: -14 },
    hover: { rotate: -28, y: -0.5, transition: SPRING },
    active: {
      rotate: [-14, -26, -14],
      transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
    },
  };
  return (
    <IconShell className={className} state={state} variants={variants}>
      <motion.circle
        cx="10"
        cy="8.5"
        r="3.2"
        variants={{
          idle: { scale: 1 },
          hover: { scale: 1.08 },
          active: { scale: [1, 1.12, 1], transition: { duration: 1.5, repeat: Infinity } },
        }}
      />
      <path d="M12.5 10.8 L17.5 18.2" />
      <path d="M15.8 16.2 L19.2 18.6" />
      <path d="M8.2 18.5 H14.2" />
      <motion.path
        d="M9.2 5.4 L10.8 5.4"
        variants={{
          idle: { opacity: 0.35 },
          hover: { opacity: 1 },
          active: { opacity: [0.35, 1, 0.35], transition: { duration: 1.2, repeat: Infinity } },
        }}
      />
    </IconShell>
  );
}

/** Skill：魔杖轻点 + 星点弹出 */
export function IconSkillWand({ className, state = "idle" }: IconProps) {
  const variants: Variants = {
    idle: { rotate: 0 },
    hover: { rotate: -18, transition: SPRING },
    active: { rotate: [0, -12, 0], transition: { duration: 1.2, repeat: Infinity } },
  };
  return (
    <IconShell className={className} state={state} variants={variants}>
      <path d="M14.5 4.5 L19.5 9.5" />
      <path d="M13.2 5.8 L5.5 18.8 L8.2 20.2 L15.8 7.2 Z" />
      <motion.g
        variants={{
          idle: { opacity: 0.4, scale: 0.85 },
          hover: { opacity: 1, scale: 1.15, transition: SPRING },
          active: { opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9], transition: { duration: 1.4, repeat: Infinity } },
        }}
      >
        <path d="M6 6 L6.6 7.4 L8 8 L6.6 8.6 L6 10 L5.4 8.6 L4 8 L5.4 7.4 Z" fill="currentColor" stroke="none" />
        <path d="M18 13 L18.4 14 L19.4 14.4 L18.4 14.8 L18 15.8 L17.6 14.8 L16.6 14.4 L17.6 14 Z" fill="currentColor" stroke="none" />
      </motion.g>
    </IconShell>
  );
}

/** 目标 /goal：旗帜轻扬 */
export function IconGoalFlag({ className, state = "idle" }: IconProps) {
  const variants: Variants = {
    idle: {},
    hover: {},
    active: {},
  };
  return (
    <IconShell className={className} state={state} variants={variants}>
      <path d="M6 20 V5" />
      <motion.path
        d="M6 5.5 C9 4.2 11 6.8 14 5.5 L14 12 C11 13.3 9 10.7 6 12 Z"
        fill="currentColor"
        fillOpacity="0.12"
        variants={{
          idle: { skewX: 0 },
          hover: { skewX: -8, transition: SPRING },
          active: {
            skewX: [0, -6, 0, 6, 0],
            transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
          },
        }}
        style={{ transformOrigin: "6px 5px" }}
      />
      <motion.circle
        cx="6"
        cy="5"
        r="1.2"
        fill="currentColor"
        stroke="none"
        variants={{
          idle: { scale: 1 },
          hover: { scale: 1.25 },
          active: { scale: [1, 1.3, 1], transition: { duration: 1.2, repeat: Infinity } },
        }}
      />
    </IconShell>
  );
}

/** 引用文档：页角轻折 + 行线滑入 */
export function IconDocRef({ className, state = "idle" }: IconProps) {
  const variants: Variants = {
    idle: {},
    hover: {},
    active: {},
  };
  return (
    <IconShell className={className} state={state} variants={variants}>
      <path d="M7 4.5 H14 L18 8.5 V19.5 H7 Z" />
      <motion.path
        d="M14 4.5 V8.5 H18"
        variants={{
          idle: { pathLength: 1 },
          hover: { pathLength: 1, y: 0.5 },
          active: {},
        }}
      />
      <motion.path
        d="M9.5 12 H15.5"
        variants={{
          idle: { opacity: 0.55, x: 0 },
          hover: { opacity: 1, x: 0.5 },
          active: { opacity: [0.55, 1, 0.55], transition: { duration: 1.2, repeat: Infinity } },
        }}
      />
      <motion.path
        d="M9.5 15 H13.5"
        variants={{
          idle: { opacity: 0.4, x: 0 },
          hover: { opacity: 0.9, x: 1 },
          active: { opacity: [0.4, 0.9, 0.4], transition: { duration: 1.2, repeat: Infinity, delay: 0.15 } },
        }}
      />
    </IconShell>
  );
}

/** 图片：相框轻微浮起 + 山线跳动 */
export function IconImageFrame({ className, state = "idle" }: IconProps) {
  const variants: Variants = {
    idle: { y: 0 },
    hover: { y: -1, transition: SPRING },
    active: { y: [0, -1.5, 0], transition: { duration: 1.3, repeat: Infinity } },
  };
  return (
    <IconShell className={className} state={state} variants={variants}>
      <rect x="4.5" y="5.5" width="15" height="13" rx="2" />
      <motion.circle
        cx="9"
        cy="10"
        r="1.4"
        fill="currentColor"
        stroke="none"
        variants={{
          idle: { scale: 1 },
          hover: { scale: 1.2 },
          active: { scale: [1, 1.25, 1], transition: { duration: 1.3, repeat: Infinity } },
        }}
      />
      <motion.path
        d="M5.5 16.5 L9.5 12.5 L12.5 15 L15 12 L18.5 16.5"
        variants={{
          idle: { pathOffset: 0 },
          hover: { y: -0.5 },
          active: {},
        }}
      />
    </IconShell>
  );
}

/** 集群 / Swarm：节点扩散 */
export function IconSwarmCluster({ className, state = "idle" }: IconProps) {
  const variants: Variants = {
    idle: {},
    hover: {},
    active: {},
  };
  return (
    <IconShell className={className} state={state} variants={variants}>
      <motion.circle
        cx="12"
        cy="12"
        r="2.2"
        fill="currentColor"
        stroke="none"
        variants={{
          idle: { scale: 1 },
          hover: { scale: 1.15 },
          active: { scale: [1, 1.2, 1], transition: { duration: 1.4, repeat: Infinity } },
        }}
      />
      <motion.g
        variants={{
          idle: { scale: 1 },
          hover: { scale: 1.12, transition: SPRING },
          active: { scale: [1, 1.08, 1], transition: { duration: 1.4, repeat: Infinity } },
        }}
        style={{ transformOrigin: "12px 12px" }}
      >
        <path d="M12 9.8 V6.5" />
        <path d="M12 14.2 V17.5" />
        <path d="M9.8 12 H6.5" />
        <path d="M14.2 12 H17.5" />
        <circle cx="12" cy="5.5" r="1.3" />
        <circle cx="12" cy="18.5" r="1.3" />
        <circle cx="5.5" cy="12" r="1.3" />
        <circle cx="18.5" cy="12" r="1.3" />
      </motion.g>
    </IconShell>
  );
}

/** 队列：横条依次点亮 */
export function IconQueueBars({ className, state = "idle" }: IconProps) {
  const variants: Variants = { idle: {}, hover: {}, active: {} };
  return (
    <IconShell className={className} state={state} variants={variants}>
      {[0, 1, 2].map((i) => (
        <motion.rect
          key={i}
          x={5}
          y={6 + i * 4.5}
          width={14 - i * 2}
          height="2.2"
          rx="1"
          fill="currentColor"
          stroke="none"
          variants={{
            idle: { opacity: 0.45 + i * 0.1, x: 0 },
            hover: { opacity: 1, x: 1, transition: { ...SPRING, delay: i * 0.04 } },
            active: {
              opacity: [0.4, 1, 0.4],
              transition: { duration: 1.1, repeat: Infinity, delay: i * 0.12 },
            },
          }}
        />
      ))}
    </IconShell>
  );
}
