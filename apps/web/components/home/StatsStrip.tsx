"use client";

import { Bot, FileText, FolderKanban, Zap } from "lucide-react";

export function StatsStrip({
  postCount,
  categoryCount,
}: {
  postCount: number;
  categoryCount: number;
}) {
  return (
    <section className="relative z-10 border-y border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 backdrop-blur-md">
      <div className="grid grid-cols-2 gap-px divide-x divide-[var(--kp-divider)] md:grid-cols-4">
        <StatTile icon={FileText} value={postCount} label="已发布文章" />
        <StatTile icon={FolderKanban} value={categoryCount} label="内容分类" />
        <StatTile icon={Bot} value={"∞"} label="Agent 待命" />
        <StatTile icon={Zap} value={"0ms"} label="本地响应" />
      </div>
    </section>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center transition-colors hover:bg-[var(--kp-bg-alt)]/60">
      <Icon className="h-6 w-6 text-[var(--kp-brand-deep)]" />
      <div className="text-2xl font-bold text-[var(--kp-text-1)]">{value}</div>
      <div className="text-xs uppercase tracking-wider text-[var(--kp-text-3)]">{label}</div>
    </div>
  );
}
