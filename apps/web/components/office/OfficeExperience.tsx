"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { KnockKnockIntro } from "./KnockKnockIntro";
import { OfficeOverlays } from "./OfficeOverlays";
import { HOTSPOT_META, OFFICE_BRAND, type OfficeHotspotId } from "./officeContent";
import { OFFICE_VIEWS, type OfficeViewId } from "./officeNav";

const OfficeScene = dynamic(
  () => import("./OfficeScene").then((m) => m.OfficeScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#F3F6FA] text-sm text-[var(--kp-text-2)]">
        正在渲染办公室…
      </div>
    ),
  },
);

const VIEW_ORDER = ["overview", "desk", "board", "server", "shelf"] as const;

export function OfficeExperience() {
  const [entered, setEntered] = useState(false);
  const [hotspot, setHotspot] = useState<OfficeHotspotId | null>(null);
  const [viewId, setViewId] = useState<OfficeViewId>("overview");

  useEffect(() => {
    if (!entered) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        setViewId("walk");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered]);

  const hint = hotspot
    ? HOTSPOT_META[hotspot].hint
    : viewId === "walk"
      ? "WASD / 方向键走动 · 拖拽环顾 · 点物件探索"
      : "选机位或 WASD 走动 · 拖拽环顾 · 点物件探索";

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] w-full overflow-hidden bg-[#F3F6FA]">
      {!entered && <KnockKnockIntro onEnter={() => setEntered(true)} />}

      {entered && (
        <>
          <OfficeScene onSelect={setHotspot} activeId={hotspot} viewId={viewId} />

          <motion.div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 sm:p-4"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Link
              href="/"
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-3 py-1.5 text-xs font-medium text-[var(--kp-text-1)] shadow-sm backdrop-blur-md transition hover:bg-white/95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              首页
            </Link>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-full border border-white/70 bg-white/90 p-1 shadow-sm backdrop-blur-md">
                {VIEW_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setViewId(id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                      viewId === id
                        ? "bg-[var(--kp-brand)] text-white"
                        : "text-[var(--kp-text-2)] hover:bg-black/5"
                    }`}
                  >
                    {OFFICE_VIEWS[id].label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setViewId("walk")}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    viewId === "walk"
                      ? "bg-[#0F172A] text-white"
                      : "text-[var(--kp-text-2)] hover:bg-black/5"
                  }`}
                >
                  漫游
                </button>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/85 px-3 py-1.5 text-xs font-medium text-[var(--kp-text-1)] shadow-sm backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {OFFICE_BRAND.officeTitle}
              </div>
            </div>
          </motion.div>

          {/* 简易方向键（触控/鼠标） */}
          <motion.div
            className="pointer-events-none absolute bottom-20 right-4 z-20 sm:bottom-24"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <div className="pointer-events-auto grid grid-cols-3 gap-1 rounded-2xl border border-white/70 bg-white/90 p-1.5 shadow-lg backdrop-blur-md">
              <span />
              <WalkPadKey label="W" code="KeyW" />
              <span />
              <WalkPadKey label="A" code="KeyA" />
              <WalkPadKey label="S" code="KeyS" />
              <WalkPadKey label="D" code="KeyD" />
            </div>
          </motion.div>

          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <div className="max-w-xl rounded-full border border-white/70 bg-white/92 px-4 py-2 text-center text-xs font-medium text-[var(--kp-text-1)] shadow-lg backdrop-blur-md sm:text-sm">
              {hint}
            </div>
          </motion.div>

          <OfficeOverlays hotspot={hotspot} onClose={() => setHotspot(null)} />
        </>
      )}
    </div>
  );
}

/** 屏幕方向垫：按下时派发真实 KeyboardEvent，供 CameraNavigator 消费 */
function WalkPadKey({ label, code }: { label: string; code: string }) {
  const fire = (type: "keydown" | "keyup") => {
    window.dispatchEvent(new KeyboardEvent(type, { code, key: label.toLowerCase(), bubbles: true }));
  };
  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F1F5F9] text-xs font-bold text-[var(--kp-text-1)] active:bg-[var(--kp-brand)] active:text-white"
      onPointerDown={(e) => {
        e.preventDefault();
        fire("keydown");
      }}
      onPointerUp={() => fire("keyup")}
      onPointerLeave={() => fire("keyup")}
    >
      {label}
    </button>
  );
}
