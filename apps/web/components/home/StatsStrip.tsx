"use client";

import { Bot, FileText, FolderKanban, Sparkles, Zap } from "lucide-react";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { StaggerContainer, StaggerItem } from "@/components/magicui/scroll-reveal";

export function StatsStrip({
  postCount,
  categoryCount,
}: {
  postCount: number;
  categoryCount: number;
}) {
  const stats = [
    { icon: FileText, value: postCount, label: "已发布文章" },
    { icon: FolderKanban, value: categoryCount, label: "内容分类" },
    { icon: Bot, value: "∞", label: "Agent 待命" },
    { icon: Zap, value: "0", label: "本地响应" },
    { icon: Sparkles, value: "∞", label: "蒸馏空间" },
  ];

  return (
    <section className="relative overflow-hidden border-y border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60">
      <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, var(--kp-brand-deep) 1px, transparent 0)", backgroundSize: "26px 26px" }} />

      <StaggerContainer className="relative z-10 mx-auto grid max-w-7xl grid-cols-2 divide-x divide-[var(--kp-divider)] md:grid-cols-5">
        {stats.map((stat) => (
          <StaggerItem key={stat.label}>
            <div className="group flex flex-col items-center gap-1.5 px-3 py-5 text-center transition-colors hover:bg-[var(--kp-bg)]/50">
              <stat.icon className="h-4 w-4 text-[var(--kp-brand-1)] transition-transform duration-300 group-hover:scale-110" />
              <div className="text-2xl font-black tabular-nums tracking-tight text-[var(--kp-text-1)] md:text-3xl">
                {typeof stat.value === "number" ? (
                  <NumberTicker value={stat.value} className="text-[var(--kp-text-1)]" />
                ) : (
                  stat.value
                )}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-text-3)]">{stat.label}</div>
            </div>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </section>
  );
}
