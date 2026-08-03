"use client";

/**
 * 主页 / About 共用「赛车跑道」动态 SVG。
 * 沿贝塞尔曲线路径移动的光点，象征迭代速度。纯 SVG + CSS，无 WebGL，首屏轻量。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

interface RacingTrackProps {
  className?: string;
  /** 光点数量 */
  cars?: number;
  /** 自动隐藏于 prefers-reduced-motion */
  respectReducedMotion?: boolean;
}

export function RacingTrack({ className, cars = 5, respectReducedMotion = true }: RacingTrackProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [reduced, setReduced] = useState(false);
  const [size, setSize] = useState({ width: 1000, height: 200 });

  useEffect(() => {
    if (respectReducedMotion) {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const apply = () => setReduced(mq.matches);
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [respectReducedMotion]);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: Math.max(320, cr.width), height: Math.max(120, cr.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pathD = useMemo(() => {
    const w = size.width;
    const h = size.height;
    const y = h / 2;
    return `M 0 ${y} C ${w * 0.25} ${y - h * 0.35}, ${w * 0.35} ${y + h * 0.35}, ${w * 0.5} ${y} S ${w * 0.75} ${y - h * 0.35}, ${w} ${y}`;
  }, [size]);

  if (reduced) {
    return <div className={cn("opacity-30", className)} aria-hidden="true" />;
  }

  return (
    <svg
      ref={svgRef}
      className={cn("w-full overflow-visible", className)}
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="trackGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--kp-brand-light)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--kp-accent)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--kp-brand-light)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={pathD} fill="none" stroke="url(#trackGradient)" strokeWidth={size.height * 0.06} strokeLinecap="round" />
      <path d={pathD} fill="none" stroke="var(--kp-divider)" strokeWidth={1} strokeDasharray="8 8" opacity={0.5} />
      {Array.from({ length: cars }).map((_, i) => (
        <Car key={i} index={i} total={cars} pathD={pathD} />
      ))}
    </svg>
  );
}

function Car({ index, total, pathD }: { index: number; total: number; pathD: string }) {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const delay = useMemo(() => (index / total) * -4, [index, total]);
  const duration = useMemo(() => 4 + index * 0.6, [index]);

  return (
    <circle r={5} fill="var(--kp-accent)">
      {mounted && (
        <animateMotion dur={`${duration}s`} repeatCount="indefinite" begin={`${delay}s`} path={pathD} rotate="auto" />
      )}
    </circle>
  );
}
