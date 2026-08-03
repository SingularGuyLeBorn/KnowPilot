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
import { OrbitingCircles } from "@/components/magicui/orbiting-circles";

const Particles = dynamic(
  () => import("@/components/magicui/particles").then((m) => m.Particles),
  { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

const easeOut = [0.22, 1, 0.36, 1] as const;

export function HeroSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="dark relative flex min-h-[100dvh] items-center overflow-hidden bg-[var(--kp-bg)] px-[5%] py-20 lg:px-[8%] lg:py-24">
      {/* 背景：动态粒子 */}
      <div className="pointer-events-none absolute inset-0">
        <Particles
          className="h-full w-full"
          quantity={60}
          size={0.3}
          staticity={40}
          ease={50}
          color="#c2d2c0"
          vx={0.1}
          vy={0.1}
          refresh={false}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_0%_50%,var(--kp-bg)_0%,transparent_55%)]" />
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

        <HeroVisual profile={profile} />
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

function HeroVisual({ profile }: { profile: AboutProfile }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, delay: 0.2, ease: easeOut }}
      className="relative hidden h-[420px] w-[420px] items-center justify-center lg:flex"
    >
      <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[var(--kp-brand)] via-[var(--kp-accent)] to-[var(--kp-brand-deep)] opacity-60 blur-3xl" />
      <div className="relative z-10 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-2xl md:h-40 md:w-40">
        {profile.avatar ? (
          <AvatarImage src={profile.avatar} alt={profile.name} />
        ) : (
          <Sparkles className="h-12 w-12 text-[var(--kp-brand-light)]" />
        )}
      </div>

      <OrbitingCircles radius={170} iconSize={40} duration={28} path>
        <OrbitingIcon icon={Bot} label="Agent" />
        <OrbitingIcon icon={BookOpen} label="笔记" />
        <OrbitingIcon icon={Wand2} label="Skills" />
        <OrbitingIcon icon={Zap} label="自动化" />
      </OrbitingCircles>
      <OrbitingCircles radius={110} iconSize={32} duration={20} reverse path={false}>
        <OrbitingIcon icon={Sparkles} small />
        <OrbitingIcon icon={ArrowUpRight} small />
        <OrbitingIcon icon={Mail} small />
      </OrbitingCircles>
    </motion.div>
  );
}

function OrbitingIcon({
  icon: Icon,
  label,
  small,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label?: string;
  small?: boolean;
}) {
  return (
    <div className="group flex flex-col items-center gap-1">
      <div
        className={[
          "flex items-center justify-center rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/90 shadow-lg backdrop-blur-md transition-transform group-hover:scale-110",
          small ? "h-9 w-9" : "h-10 w-10",
        ].join(" ")}
      >
        <Icon className={small ? "h-4 w-4 text-[var(--kp-brand-light)]" : "h-5 w-5 text-[var(--kp-accent)]"} />
      </div>
      {label && <span className="text-[10px] font-medium text-[var(--kp-text-3)]">{label}</span>}
    </div>
  );
}
