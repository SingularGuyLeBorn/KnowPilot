"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { KnockKnockIntro } from "./KnockKnockIntro";
import { OfficeOverlays } from "./OfficeOverlays";
import { OFFICE_BRAND, type OfficeHotspotId } from "./officeContent";

const OfficeScene = dynamic(
  () => import("./OfficeScene").then((m) => m.OfficeScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#E8EEF5] text-sm text-[var(--kp-text-2)]">
        正在渲染办公室…
      </div>
    ),
  },
);

export function OfficeExperience() {
  const [entered, setEntered] = useState(false);
  const [hotspot, setHotspot] = useState<OfficeHotspotId | null>(null);

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] w-full overflow-hidden bg-[#E8EEF5]">
      {!entered && <KnockKnockIntro onEnter={() => setEntered(true)} />}

      {entered && (
        <>
          <OfficeScene onSelect={setHotspot} activeId={hotspot} />

          <motion.div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3 sm:p-4"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Link
              href="/"
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-xs font-medium text-[var(--kp-text-1)] shadow-sm backdrop-blur-md transition hover:bg-white/90"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              首页
            </Link>
            <div className="rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-xs font-medium text-[var(--kp-text-1)] shadow-sm backdrop-blur-md">
              {OFFICE_BRAND.name} · {OFFICE_BRAND.en}
            </div>
          </motion.div>

          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <div className="rounded-full border border-white/70 bg-white/90 px-4 py-2 text-center text-xs font-medium text-[var(--kp-text-1)] shadow-lg backdrop-blur-md sm:text-sm">
              Drag to look around · Click objects to explore
            </div>
          </motion.div>

          <OfficeOverlays hotspot={hotspot} onClose={() => setHotspot(null)} />
        </>
      )}
    </div>
  );
}
