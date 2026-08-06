"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { OFFICE_BRAND } from "./officeContent";

interface KnockKnockIntroProps {
  onEnter: () => void;
}

export function KnockKnockIntro({ onEnter }: KnockKnockIntroProps) {
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const start = performance.now();
    const duration = 2200;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setReady(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleKnock = () => {
    if (!ready || exiting) return;
    setExiting(true);
    window.setTimeout(onEnter, 680);
  };

  return (
    <AnimatePresence>
      {!exiting ? (
        <motion.div
          key="knock"
          className="absolute inset-0 z-40 flex flex-col items-center justify-center"
          style={{ background: "linear-gradient(160deg, #F4F7FB 0%, #E8EEF5 55%, #DCE7F5 100%)" }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            type="button"
            onClick={handleKnock}
            disabled={!ready}
            className="group relative flex flex-col items-center gap-8 border-0 bg-transparent p-4 outline-none disabled:cursor-wait"
            aria-label={ready ? "敲门进入办公室" : "正在加载"}
          >
            <div className="flex items-center gap-6 md:gap-10">
              <motion.span
                className="text-3xl font-semibold tracking-tight text-[#111827] md:text-5xl"
                animate={ready ? { x: [0, -2, 2, 0] } : {}}
                transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
              >
                Knock Knock.
              </motion.span>

              {/* 敲门手势（几何） */}
              <motion.div
                className="relative h-20 w-20 md:h-28 md:w-28"
                animate={{ rotate: ready ? [0, -8, 0] : 0 }}
                transition={{ repeat: Infinity, duration: 0.9, ease: "easeInOut" }}
              >
                <div
                  className="absolute inset-2 rounded-[40%] shadow-md"
                  style={{ background: "#F5C6A0" }}
                />
                <div
                  className="absolute -right-1 top-3 h-8 w-5 rounded-full md:h-10 md:w-6"
                  style={{ background: "#F5C6A0" }}
                />
                {ready && (
                  <motion.div
                    className="absolute -top-2 left-1/2 flex -translate-x-1/2 flex-col gap-0.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 0.9 }}
                  >
                    <span className="block h-0.5 w-4 rounded-full bg-[#9CA3AF]" />
                    <span className="block h-0.5 w-5 rounded-full bg-[#9CA3AF]" />
                    <span className="block h-0.5 w-3 rounded-full bg-[#9CA3AF]" />
                  </motion.div>
                )}
              </motion.div>

              {/* 玻璃门 · 浅色科技 */}
              <div className="relative h-36 w-28 md:h-48 md:w-36">
                <div
                  className="absolute inset-0 rounded-md shadow-lg"
                  style={{
                    background: "linear-gradient(145deg, #F8FAFC 0%, #E2E8F0 100%)",
                    border: "1px solid rgba(148,163,184,0.55)",
                  }}
                />
                <div
                  className="absolute inset-[10%] rounded-[2px]"
                  style={{
                    background: "linear-gradient(180deg, rgba(224,242,254,0.85), rgba(248,250,252,0.95))",
                    border: "1px solid rgba(14,165,233,0.25)",
                  }}
                />
                <span className="absolute left-1/2 top-[28%] -translate-x-1/2 text-sm font-semibold tracking-wide text-[#0B3A66] md:text-base">
                  {OFFICE_BRAND.doorLabel}
                </span>
                <div
                  className="absolute right-[18%] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full shadow md:h-5 md:w-5"
                  style={{ background: "#0087EB" }}
                />
              </div>
            </div>

            <p className="text-sm text-[#6B7280]">
              {ready ? "点击敲门进入 · Enter the digital garden office" : "准备房间中…"}
            </p>
          </button>

          <div className="absolute bottom-16 left-1/2 w-[min(720px,86vw)] -translate-x-1/2">
            <div className="h-px w-full bg-[#94A3B8]/60" />
            <div className="mt-2 flex items-center justify-between text-xs text-[#64748B]">
              <span>
                Load
                <span className="animate-pulse">|</span>
              </span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-[#CBD5E1]">
              <motion.div
                className="h-full origin-left rounded-full bg-[#0087EB]"
                style={{ scaleX: progress }}
              />
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="fade"
          className="absolute inset-0 z-40"
          style={{ background: "#E8ECEF" }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.55 }}
        />
      )}
    </AnimatePresence>
  );
}
