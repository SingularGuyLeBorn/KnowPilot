"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Cpu,
  Github,
  Mail,
  MapPin,
  MessageSquare,
  Sparkles,
  Sprout,
  Wrench,
  Zap,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";

const easeSpring = [0.22, 1, 0.36, 1] as const;

const ROLE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  独立开发者: Wrench,
  AI: Cpu,
  自动化: Zap,
  数字花园: Sprout,
  能源: Zap,
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

export function HeroSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="kp-hero-mesh relative overflow-hidden px-6 py-12 lg:px-12 lg:py-16">
      <div className="relative z-10 mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: easeSpring }}
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 px-3.5 py-1.5 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-[var(--kp-accent)]" />
            <span>{profile.oneLiner || "Creator · Developer · AI 协作者"}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-accent-soft)] to-[var(--kp-brand-soft)] text-2xl font-bold text-[var(--kp-accent-deep)] shadow-sm">
              {profile.name.slice(0, 1)}
            </div>
            <div>
              <h1 className="text-[clamp(3rem,9vw,5.5rem)] font-black leading-[0.9] tracking-[-0.04em] text-[var(--kp-text-1)]">
                {profile.name}
              </h1>
              <p className="mt-1 text-lg font-medium text-[var(--kp-brand-dark)] md:text-xl">
                {profile.title}
              </p>
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--kp-text-2)] md:text-base">
            {profile.tagline}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--kp-text-3)]">
            {profile.location && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-2.5 py-1">
                <MapPin className="h-3 w-3" /> {profile.location}
              </span>
            )}
            {profile.email && (
              <a href={`mailto:${profile.email}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-2.5 py-1 transition-colors hover:text-[var(--kp-brand-deep)]">
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
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-2.5 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm transition-colors hover:border-[var(--kp-brand-light)] hover:text-[var(--kp-brand-deep)]"
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
              className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--kp-accent)] px-4 text-xs font-semibold text-white shadow-lg shadow-[rgba(var(--kp-accent-rgb),0.25)] transition-all hover:-translate-y-0.5 hover:bg-[var(--kp-accent-deep)]"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              开始对话
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            {profile.github && (
              <a
                href={profile.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-4 text-xs font-semibold text-[var(--kp-text-1)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
              >
                <Github className="h-3.5 w-3.5" /> GitHub
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
              { label: "项目", value: `${profile.projects.length} 个` },
              { label: "关注方向", value: `${profile.focus.length} 个` },
              { label: "技术栈", value: `${profile.stack.reduce((n, g) => n + g.items.length, 0)} 项` },
              { label: "偏见", value: `${profile.philosophy.length} 条` },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.08, duration: 0.5, ease: easeSpring }}
                className="kp-card-dense flex flex-col justify-center p-4"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-text-3)]">{item.label}</span>
                <span className="mt-1 text-xl font-black text-[var(--kp-text-1)]">{item.value}</span>
              </motion.div>
            ))}
          </div>

          {profile.socials.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {profile.socials.map((s) => (
                <a
                  key={s.platform + s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-2.5 py-1 text-xs font-medium text-[var(--kp-text-2)] transition-colors hover:border-[var(--kp-brand-light)] hover:text-[var(--kp-brand-deep)]"
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
