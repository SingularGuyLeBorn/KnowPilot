"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  BookOpen,
  Brain,
  Code2,
  ExternalLink,
  Github,
  Globe,
  MapPin,
  Sparkles,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { PostContent } from "@/components/post/PostContent";
import { cn } from "@/lib/utils";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

export function AboutView({ profile }: { profile: AboutProfile }) {
  return (
    <div className="relative min-h-full overflow-hidden">
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-[var(--kp-brand-soft)] blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-[var(--kp-bg-mute)] blur-3xl" />

      <div className="relative mx-auto max-w-4xl px-4 py-12 md:px-8 md:py-16">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="mb-10 rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] p-8 shadow-sm backdrop-blur-md md:p-10"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--kp-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--kp-brand-dark)]">
            <Sparkles className="h-3.5 w-3.5" />
            About Me
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
            {profile.name}
          </h1>
          <p className="mt-2 text-lg text-[var(--kp-brand-dark)]">{profile.title}</p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--kp-text-2)] md:text-base">
            {profile.tagline}
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            {profile.location && (
              <span className="inline-flex items-center gap-1.5 text-[var(--kp-text-3)]">
                <MapPin className="h-4 w-4" />
                {profile.location}
              </span>
            )}
            {profile.github && (
              <a
                href={profile.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[var(--kp-brand-dark)] transition hover:text-[var(--kp-text-1)]"
              >
                <Github className="h-4 w-4" />
                GitHub
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
            {profile.site && (
              <a
                href={profile.site}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[var(--kp-brand-dark)] transition hover:text-[var(--kp-text-1)]"
              >
                <Globe className="h-4 w-4" />
                个人站点
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
          </div>
        </motion.header>

        <div className="grid gap-6 md:grid-cols-2">
          <ProfileCard title="关注方向" icon={Brain} items={profile.focus} delay={0.05} />
          <ProfileCard title="技术栈" icon={Code2} items={profile.stack} delay={0.1} />
        </div>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.12 }}
          className="mt-6 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-6 backdrop-blur-sm"
        >
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
            <BookOpen className="h-4 w-4" />
            项目
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {profile.projects.map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.04, ...spring }}
                className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/60 p-4 transition hover:border-[var(--kp-brand-light)] hover:shadow-md"
              >
                {p.href ? (
                  <Link href={p.href} className="font-semibold text-[var(--kp-text-1)] hover:text-[var(--kp-brand-dark)]">
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-semibold text-[var(--kp-text-1)]">{p.name}</span>
                )}
                <p className="mt-1 text-xs leading-relaxed text-[var(--kp-text-2)]">{p.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.18 }}
          className="prose-kp mt-6 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-6 backdrop-blur-sm md:p-8"
        >
          <PostContent content={profile.bodyMarkdown} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.22 }}
          className="mt-6 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-brand-soft)]/40 p-6"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">理念</h2>
          <ul className="space-y-2">
            {profile.philosophy.map((line) => (
              <li key={line} className="flex gap-2 text-sm text-[var(--kp-text-2)]">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kp-brand)]" />
                {line}
              </li>
            ))}
          </ul>
        </motion.section>
      </div>
    </div>
  );
}

function ProfileCard({
  title,
  icon: Icon,
  items,
  delay,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  delay: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-6 backdrop-blur-sm"
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
        <Icon className="h-4 w-4 text-[var(--kp-brand)]" />
        {title}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className={cn(
              "rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-3 py-1 text-xs text-[var(--kp-text-2)]",
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
