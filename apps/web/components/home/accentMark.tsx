import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 品牌蓝花括号：{ 关键词 } */
export function CurlyMark({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("text-[var(--kp-brand)]", className)}>
      {"{"} {children} {"}"}
    </span>
  );
}

/** 品牌蓝直角括号：[关键词] */
export function SquareMark({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("text-[var(--kp-brand)]", className)}>
      [{children}]
    </span>
  );
}
