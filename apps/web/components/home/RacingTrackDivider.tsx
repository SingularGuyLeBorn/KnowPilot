"use client";

import dynamic from "next/dynamic";
import { ArrowRight, Feather } from "lucide-react";
import Link from "next/link";

const RacingTrack = dynamic(
  () => import("@/components/home/RacingTrack").then((m) => m.RacingTrack),
  { ssr: false, loading: () => <div className="h-32" aria-hidden /> },
);

export function RacingTrackDivider() {
  return (
    <section className="relative overflow-hidden px-[5%] py-16 md:px-[8%] lg:px-[10%]">
      <div className="relative mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">
              Fast Iteration
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              从想法到文章，只需一次对话
            </h2>
          </div>
          <Link
            href="/chat"
            className="group inline-flex items-center gap-2 rounded-full bg-[var(--kp-brand-deep)] px-5 py-2.5 text-sm font-medium text-white transition-transform hover:-translate-y-0.5"
          >
            <Feather className="h-4 w-4" />
            试试 Agent
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        <RacingTrack className="h-32 w-full" />
      </div>
    </section>
  );
}
