"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Github,
  Globe,
  Mail,
  MapPin,
  MessageSquare,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";

const BlackHoleScene = dynamic(
  () => import("@/components/home/BlackHoleScene").then((m) => m.BlackHoleScene),
  { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

const easeOut = [0.22, 1, 0.36, 1] as const;

export function HeroSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="dark relative flex min-h-[100dvh] items-center overflow-hidden bg-[var(--kp-bg)] px-[5%] py-20 lg:px-[8%] lg:py-24">
      {/* 背景：黑洞；深色画布显影 */}
      <div className="pointer-events-none absolute inset-0">
        <BlackHoleScene className="h-full w-full" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_0%_50%,var(--kp-bg)_0%,transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_70%,transparent_0%,var(--kp-bg)_65%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--kp-bg)] to-transparent" />
      </div>

      <div className="relative z-10 grid w-full items-center gap-12 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: easeOut }}
        >
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-3 py-1.5 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-[var(--kp-brand-light)]" />
            <span>{profile.oneLiner || "Creator · Developer · AI 协作者"}</span>
          </div>

          <div className="flex flex-wrap items-end gap-5">
            {profile.avatar && (
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-lg md:h-28 md:w-28">
                <AvatarImage src={profile.avatar} alt={profile.name} />
              </div>
            )}
            <h1 className="text-[clamp(3.5rem,12vw,8rem)] font-black leading-[0.9] tracking-tighter text-[var(--kp-text-1)]">
              <span className="block bg-gradient-to-br from-[var(--kp-text-1)] via-[var(--kp-brand-deep)] to-[var(--kp-accent-deep)] bg-clip-text text-transparent">
                {profile.name}
              </span>
            </h1>
          </div>

          <p className="mt-4 text-xl font-medium text-[var(--kp-brand-light)] md:text-2xl">
            {profile.title}
          </p>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--kp-text-2)] md:text-lg">
            {profile.tagline}
          </p>

          {profile.roles.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {profile.roles.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-3 py-1.5 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm"
                >
                  <Zap className="h-3 w-3 text-[var(--kp-accent)]" />
                  {role}
                </span>
              ))}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/chat"
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--kp-brand)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--kp-brand)]/20 transition-all hover:scale-105 hover:bg-[var(--kp-brand-deep)] hover:shadow-xl hover:shadow-[var(--kp-brand)]/30"
            >
              <MessageSquare className="h-4 w-4" />
              开始对话
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            {profile.socials.map((s) => (
              <a
                key={s.platform}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-5 py-3 text-sm font-medium text-[var(--kp-text-1)] backdrop-blur-md transition-all hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
              >
                <SocialIcon platform={s.platform} />
                {s.platform}
              </a>
            ))}
            {!profile.socials.find((s) => s.platform.toLowerCase() === "github") && profile.github && (
              <a
                href={profile.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-5 py-3 text-sm font-medium text-[var(--kp-text-1)] backdrop-blur-md transition-all hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
              >
                <Github className="h-4 w-4" />
                GitHub
              </a>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-[var(--kp-text-3)]">
            {profile.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {profile.location}
              </span>
            )}
            {profile.email && (
              <a
                href={`mailto:${profile.email}`}
                className="inline-flex items-center gap-1.5 transition hover:text-[var(--kp-brand-light)]"
              >
                <Mail className="h-3.5 w-3.5" />
                {profile.email}
              </a>
            )}
          </div>
        </motion.div>

        <HeroVisual />
      </div>
    </section>
  );
}

function AvatarImage({ src, alt }: { src: string; alt: string }) {
  if (src.startsWith("http") || src.startsWith("//")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    );
  }
  const path = src.startsWith("/") ? src : `/${src}`;
  return <Image src={path} alt={alt} fill className="object-cover" unoptimized />;
}

function SocialIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p.includes("github")) return <Github className="h-4 w-4" />;
  if (p.includes("twitter") || p.includes("x")) return <Globe className="h-4 w-4" />;
  if (p.includes("bilibili")) return <Globe className="h-4 w-4" />;
  return <Globe className="h-4 w-4" />;
}

function HeroVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, delay: 0.2, ease: easeOut }}
      className="relative hidden aspect-square w-full max-w-lg lg:block"
    >
      <div className="absolute inset-[10%] rounded-full bg-gradient-to-br from-[var(--kp-brand)] via-[var(--kp-accent)] to-[var(--kp-brand-deep)] opacity-80 blur-2xl" />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        className="absolute inset-[15%] rounded-full bg-gradient-to-tr from-[var(--kp-brand-soft)] via-[var(--kp-accent-soft)] to-[var(--kp-bg-alt)]"
        style={{ boxShadow: "inset 0 0 80px rgba(var(--kp-brand-rgb),0.3)" }}
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute inset-0 rounded-full border border-[var(--kp-divider)]"
        style={{ borderRadius: "45% 55% 60% 40% / 55% 45% 55% 45%" }}
      />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute inset-[8%] rounded-full border border-dashed border-[var(--kp-accent)]/30"
        style={{ borderRadius: "40% 60% 55% 45% / 50% 50% 60% 40%" }}
      />

      <FloatingCard icon={Bot} label="Agents" sub="常驻运行" className="left-0 top-[20%]" delay={0.4} />
      <FloatingCard icon={BookOpen} label="Notes" sub="Markdown 为源" className="bottom-[18%] right-0" delay={0.6} />
      <FloatingCard icon={Wand2} label="Skills" sub="可编排" className="right-[8%] top-[8%]" delay={0.8} />
    </motion.div>
  );
}

function FloatingCard({
  icon: Icon,
  label,
  sub,
  className,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }> | null;
  label: string;
  sub: string;
  className?: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: easeOut }}
      className={[
        "absolute flex items-center gap-3 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-3 shadow-lg backdrop-blur-md",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-light)]">
        {Icon ? <Icon className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--kp-text-1)]">{label}</p>
        <p className="text-[10px] text-[var(--kp-text-3)]">{sub}</p>
      </div>
    </motion.div>
  );
}
