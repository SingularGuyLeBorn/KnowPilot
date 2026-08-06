"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Compass,
  Github,
  Mail,
  MapPin,
  MessageSquare,
  PenLine,
  Wrench,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { OasisMindLogo } from "@/lib/icons";

const Particles = dynamic(
  () => import("@/components/magicui/particles").then((m) => m.Particles),
  { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

const easeSpring = [0.22, 1, 0.36, 1] as const;

const ROLE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  独立开发者: Wrench,
  AI: Compass,
  自动化: PenLine,
  数字花园: BookOpen,
  能源: PenLine,
  小红书: BookOpen,
};

function roleIcon(role: string) {
  for (const key of Object.keys(ROLE_ICON)) {
    if (role.includes(key)) return ROLE_ICON[key];
  }
  return null;
}

function SocialIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p.includes("github")) return <Github className="h-3.5 w-3.5" />;
  return <ArrowUpRight className="h-3.5 w-3.5" />;
}

/** ENTJ「指挥官」：王冠 + 罗盘——自定义 SVG，避开 Lucide 撞车 */
function EntjCommanderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path
        d="M6 14L9.5 8.5L16 12L22.5 8.5L26 14V18.5C26 20.4 24.4 22 22.5 22H9.5C7.6 22 6 20.4 6 18.5V14Z"
        fill="currentColor"
        opacity="0.22"
      />
      <path
        d="M6 14L9.5 8.5L16 12L22.5 8.5L26 14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M7 14.5H25V18.5C25 20 23.8 21.2 22.3 21.2H9.7C8.2 21.2 7 20 7 18.5V14.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="8.2" r="1.4" fill="currentColor" />
      <circle cx="16" cy="11.2" r="1.6" fill="currentColor" />
      <circle cx="22.5" cy="8.2" r="1.4" fill="currentColor" />
      <path
        d="M12.5 25.5H19.5M16 22V25.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const MBTI_META: Record<string, { label: string; hint: string }> = {
  ENTJ: { label: "ENTJ", hint: "指挥官 · Commander" },
  INTJ: { label: "INTJ", hint: "建筑师 · Architect" },
  ENTP: { label: "ENTP", hint: "辩论家 · Debater" },
  INTP: { label: "INTP", hint: "逻辑学家 · Logician" },
};

function MbtiBadge({ type }: { type: string }) {
  const key = type.trim().toUpperCase();
  const meta = MBTI_META[key] ?? { label: key, hint: "MBTI" };
  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.03 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      title={meta.hint}
      className="group inline-flex items-center gap-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--kp-accent)_35%,white)] bg-gradient-to-br from-[color-mix(in_srgb,var(--kp-accent)_18%,white)] via-white/80 to-[color-mix(in_srgb,var(--kp-brand)_12%,white)] px-3 py-2 shadow-[0_10px_28px_-14px_rgba(232,168,74,0.45)] backdrop-blur-md"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/70 bg-white/80 text-[var(--kp-accent-deep)] shadow-sm transition-transform duration-300 group-hover:rotate-6">
        <EntjCommanderIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-text-3)]">
          MBTI
        </span>
        <span className="block text-sm font-black tracking-tight text-[var(--kp-text-1)]">
          我是 {meta.label}
        </span>
        <span className="block text-[10px] font-medium text-[var(--kp-accent-deep)]">
          {meta.hint}
        </span>
      </span>
    </motion.div>
  );
}

export function HeroSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative overflow-hidden px-6 pb-10 pt-10 lg:px-12 lg:pb-14 lg:pt-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 75% -5%, color-mix(in srgb, var(--kp-glow-peach) 70%, transparent), transparent 58%)," +
            "radial-gradient(ellipse 65% 50% at 5% 100%, color-mix(in srgb, var(--kp-glow-blue) 75%, transparent), transparent 55%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-80">
        <Particles
          className="h-full w-full"
          quantity={48}
          size={0.45}
          staticity={40}
          ease={48}
          color="#0087eb"
          vx={0.08}
          vy={0.05}
          refresh={false}
        />
      </div>

      <div className="relative z-10 mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: easeSpring }}
        >
          <p className="mb-3 text-sm font-medium tracking-wide text-[var(--kp-text-2)]">
            {profile.oneLiner || "Creator · Developer · AI 协作者"}
          </p>

          <div className="flex items-center gap-3 md:gap-4">
            <OasisMindLogo
              size={64}
              className="shrink-0 rounded-2xl border border-white/55 shadow-[0_12px_32px_-14px_rgba(0,135,235,0.35)]"
            />
            <div className="min-w-0">
              <h1 className="text-[clamp(2.6rem,7vw,4.5rem)] font-black leading-[0.92] tracking-[-0.04em] text-[var(--kp-text-1)]">
                {profile.name}
              </h1>
              {profile.title ? (
                <p className="mt-1 text-lg font-medium md:text-xl">
                  <CurlyMark>{profile.title}</CurlyMark>
                </p>
              ) : null}
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--kp-text-2)] md:text-base">
            {profile.tagline}
            <SquareMark className="ml-1 text-sm font-semibold">关于我</SquareMark>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {profile.mbti ? <MbtiBadge type={profile.mbti} /> : null}
            {profile.location && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-1 text-xs text-[var(--kp-text-3)] backdrop-blur-sm">
                <MapPin className="h-3 w-3" /> {profile.location}
              </span>
            )}
            {profile.email && (
              <a
                href={`mailto:${profile.email}`}
                className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/50 px-2.5 py-1 text-xs text-[var(--kp-text-3)] backdrop-blur-sm transition-colors hover:text-[var(--kp-brand)]"
              >
                <Mail className="h-3 w-3" /> {profile.email}
              </a>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {profile.roles.slice(0, 6).map((role) => {
              const Icon = roleIcon(role);
              return (
                <span
                  key={role}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/55 px-2.5 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-md transition-colors hover:border-[var(--kp-brand)]/35 hover:text-[var(--kp-brand)]"
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {role}
                </span>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Link
              href="/chat"
              className="group inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--kp-brand)] px-5 text-sm font-semibold text-white shadow-[0_10px_28px_-8px_rgba(0,135,235,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[var(--kp-brand-dark)]"
            >
              <MessageSquare className="h-4 w-4" />
              开始对话
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            {profile.github && (
              <a
                href={profile.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-1.5 rounded-full border border-white/60 bg-white/60 px-5 text-sm font-semibold text-[var(--kp-text-1)] shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-[var(--kp-brand)]/35"
              >
                <Github className="h-4 w-4" /> GitHub
              </a>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.8, ease: easeSpring }}
          className="hidden lg:block"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "项目", value: `${profile.projects.length}`, mark: "个" },
              { label: "关注", value: `${profile.focus.length}`, mark: "向" },
              {
                label: "技术栈",
                value: `${profile.stack.reduce((n, g) => n + g.items.length, 0)}`,
                mark: "项",
              },
              { label: "偏见", value: `${profile.philosophy.length}`, mark: "条" },
            ].map((item, i) => {
              const hoverMotion = [
                { y: -6, scale: 1.02 },
                { y: -4, rotate: -1.5 },
                { y: -5, scale: 1.04 },
                { y: 2, scale: 0.98 },
              ][i % 4];
              return (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={hoverMotion}
                  transition={{
                    delay: 0.25 + i * 0.08,
                    duration: 0.5,
                    ease: easeSpring,
                    type: "spring",
                    stiffness: 260,
                    damping: 26,
                  }}
                  className={[
                    "rounded-2xl border border-white/55 bg-white/50 p-4 shadow-[0_12px_32px_-18px_rgba(0,80,160,0.2)] backdrop-blur-xl transition-[border-color,box-shadow] duration-500",
                    i === 0 && "hover:border-[var(--kp-brand)]/35 hover:shadow-[0_18px_40px_-14px_rgba(0,135,235,0.3)]",
                    i === 1 && "hover:border-[var(--kp-accent)]/40 hover:shadow-[0_16px_36px_-12px_rgba(232,168,74,0.3)]",
                    i === 2 && "kp-card-sheen hover:border-white/80 hover:shadow-[0_20px_44px_-16px_rgba(0,80,160,0.28)]",
                    i === 3 && "hover:bg-white/75 hover:shadow-[inset_0_2px_10px_rgba(0,80,160,0.08)]",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-text-3)]">
                    {item.label}
                  </span>
                  <p className="mt-1 text-2xl font-black text-[var(--kp-text-1)]">
                    {item.value}
                    <SquareMark className="ml-1 text-sm font-bold">{item.mark}</SquareMark>
                  </p>
                </motion.div>
              );
            })}
          </div>

          {profile.socials.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {profile.socials.map((s) => (
                <a
                  key={s.platform + s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/55 px-2.5 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-md transition-colors hover:border-[var(--kp-brand)]/35 hover:text-[var(--kp-brand)]"
                >
                  <SocialIcon platform={s.platform} /> {s.platform}
                </a>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
