"use client";

/**
 * Three.js 星空：idle 后再挂载，首屏先靠 CSS 渐变占位，避免进首页立刻抢主线程。
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { StarFieldVariant } from "./StarField";

const StarField = dynamic(() => import("./StarField").then((m) => m.StarField), {
  ssr: false,
  loading: () => null,
});

export function DeferredStarField({
  variant,
  className,
  idleTimeoutMs = 1800,
}: {
  variant: StarFieldVariant;
  className?: string;
  idleTimeoutMs?: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const warm = () => setReady(true);
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm, { timeout: idleTimeoutMs });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, Math.min(900, idleTimeoutMs));
    return () => window.clearTimeout(t);
  }, [idleTimeoutMs]);

  if (!ready) return null;
  return <StarField variant={variant} className={cn(className)} />;
}
