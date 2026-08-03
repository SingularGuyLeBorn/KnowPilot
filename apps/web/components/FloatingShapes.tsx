"use client";

import { cn } from "@/lib/utils";

interface FloatingShapesProps {
  /** 背景装饰变体：dot-grid, rings, blob, circuit */
  variant?: "dot-grid" | "rings" | "blob" | "circuit" | "grid";
  className?: string;
  /** 仅用于 circuit 变体 */
  density?: "sparse" | "normal" | "dense";
}

export function FloatingShapes({ variant = "dot-grid", className, density = "normal" }: FloatingShapesProps) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {variant === "dot-grid" && <DotGrid />}
      {variant === "rings" && <Rings />}
      {variant === "blob" && <Blob />}
      {variant === "circuit" && <Circuit density={density} />}
      {variant === "grid" && <SquareGrid />}
    </div>
  );
}

function DotGrid() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.18]" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="dot-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" className="fill-[var(--kp-brand)]" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dot-grid)" />
    </svg>
  );
}

function Rings() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.12]" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--kp-brand-light)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--kp-accent)" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <circle cx="20%" cy="30%" r="120" fill="none" stroke="url(#ring-grad)" strokeWidth="1" />
      <circle cx="80%" cy="70%" r="180" fill="none" stroke="url(#ring-grad)" strokeWidth="1" />
      <circle cx="60%" cy="20%" r="80" fill="none" stroke="var(--kp-accent)" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function Blob() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.14]" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="blob-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--kp-accent)" />
          <stop offset="100%" stopColor="var(--kp-brand)" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <path
        d="M-60,420 C120,280 360,520 540,360 C760,180 980,460 1220,320 C1380,220 1500,420 1580,540 L1580,820 L-60,820 Z"
        fill="url(#blob-grad)"
      />
    </svg>
  );
}

function Circuit({ density }: { density: FloatingShapesProps["density"] }) {
  const step = density === "sparse" ? 80 : density === "dense" ? 40 : 56;
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.10]" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="circuit-grid" width={step} height={step} patternUnits="userSpaceOnUse">
          <path d={`M0 ${step / 2} h${step} M${step / 2} 0 v${step}`} stroke="var(--kp-brand-light)" strokeWidth="1" fill="none" />
          <circle cx={step / 2} cy={step / 2} r="2" className="fill-[var(--kp-accent)]" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#circuit-grid)" />
    </svg>
  );
}

function SquareGrid() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="square-grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <rect width="46" height="46" fill="none" stroke="var(--kp-brand-light)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#square-grid)" />
    </svg>
  );
}
