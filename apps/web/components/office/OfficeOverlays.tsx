"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import {
  ABOUT_FACTS,
  HOTSPOT_META,
  JOURNEY_STOPS,
  KNOWLEDGE_NOTES,
  OFFICE_BRAND,
  PROJECTS,
  type OfficeHotspotId,
  type OverlayKind,
} from "./officeContent";

interface OfficeOverlaysProps {
  hotspot: OfficeHotspotId | null;
  onClose: () => void;
}

function kindOf(id: OfficeHotspotId | null): OverlayKind | null {
  if (!id) return null;
  return HOTSPOT_META[id].overlay;
}

export function OfficeOverlays({ hotspot, onClose }: OfficeOverlaysProps) {
  const kind = kindOf(hotspot);

  return (
    <AnimatePresence>
      {kind && hotspot && (
        <motion.div
          key={kind + hotspot}
          className="absolute inset-0 z-30 flex items-end justify-center bg-[#0B3A66]/25 p-4 backdrop-blur-[2px] sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label={HOTSPOT_META[hotspot].label}
            className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-white/40 bg-[color-mix(in_srgb,var(--kp-glass-bg)_92%,white)] p-5 shadow-2xl backdrop-blur-xl sm:p-7"
            initial={{ y: 28, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--kp-text-3)]">
                  {OFFICE_BRAND.en} · {HOTSPOT_META[hotspot].label}
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--kp-ink)]">
                  {titleFor(kind)}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--kp-text-2)] transition hover:bg-black/5"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {kind === "projects" && <ProjectsPanel />}
            {kind === "about" && <AboutPanel />}
            {kind === "knowledge" && <KnowledgePanel />}
            {kind === "journey" && <JourneyPanel />}
            {kind === "garden" && <GardenPanel />}
            {kind === "agents" && <AgentsPanel />}
            {kind === "fun" && <FunPanel hotspot={hotspot} />}

            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-2.5 text-sm font-medium text-white shadow-md transition hover:bg-[#1f2937]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function titleFor(kind: OverlayKind): string {
  switch (kind) {
    case "projects":
      return "能力矩阵";
    case "about":
      return "Quick Facts";
    case "knowledge":
      return "架构公告板";
    case "journey":
      return "Oasis Journey";
    case "garden":
      return "数字花园";
    case "agents":
      return "呼叫 Agent";
    case "fun":
      return "角落彩蛋";
  }
}

function ProjectsPanel() {
  const [filter, setFilter] = useState("全部");
  const tags = ["全部", ...Array.from(new Set(PROJECTS.map((p) => p.tag)))];
  const items = filter === "全部" ? PROJECTS : PROJECTS.filter((p) => p.tag === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === t
                ? "bg-[#111827] text-white"
                : "border border-[var(--kp-divider)] bg-white/70 text-[var(--kp-text-2)] hover:bg-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-white/50 bg-white/75 p-4 shadow-sm"
          >
            <span
              className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
              style={{ background: p.tagColor }}
            >
              {p.tag}
            </span>
            <h3 className="mt-2 text-base font-semibold text-[var(--kp-ink)]">{p.title}</h3>
            <p className="mt-1 text-sm text-[var(--kp-text-2)]">{p.meta}</p>
            <Link
              href={p.href}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--kp-brand)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
            >
              {p.cta}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}

function AboutPanel() {
  return (
    <div className="space-y-3">
      <p className="rounded-2xl bg-[#FEF2F2] px-4 py-3 text-sm leading-relaxed text-[#7F1D1D]">
        {OFFICE_BRAND.name}（{OFFICE_BRAND.en}）——{OFFICE_BRAND.tagline}。
        点击房间里的物件探索能力；这不只是展示页，而是连进真实路由的指挥舱。
      </p>
      <dl className="divide-y divide-[var(--kp-divider)] rounded-2xl border border-white/50 bg-white/70">
        {ABOUT_FACTS.map((f) => (
          <div key={f.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[100px_1fr]">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
              {f.label}
            </dt>
            <dd className="text-sm text-[var(--kp-ink)]">{f.value}</dd>
          </div>
        ))}
      </dl>
      <Link
        href="/about"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--kp-brand)]"
      >
        打开完整 About
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function KnowledgePanel() {
  return (
    <div className="space-y-4">
      {KNOWLEDGE_NOTES.map((n) => (
        <article key={n.title} className="rounded-2xl border border-white/50 bg-white/75 p-4">
          <h3 className="font-serif text-lg font-semibold text-[var(--kp-ink)]">{n.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--kp-text-2)]">{n.body}</p>
          <p className="mt-3 text-xs text-[var(--kp-text-3)]">
            {n.keywords.join(" · ")}
          </p>
        </article>
      ))}
    </div>
  );
}

function JourneyPanel() {
  return (
    <ol className="relative space-y-0 border-l-2 border-[var(--kp-brand)]/30 pl-5">
      {JOURNEY_STOPS.map((s) => (
        <li key={s.year} className="relative pb-5 last:pb-0">
          <span className="absolute -left-[1.4rem] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--kp-brand)] ring-4 ring-white" />
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--kp-brand)]">
            {s.year}
          </p>
          <p className="mt-0.5 font-medium text-[var(--kp-ink)]">{s.place}</p>
          <p className="text-sm text-[var(--kp-text-2)]">{s.note}</p>
        </li>
      ))}
    </ol>
  );
}

function GardenPanel() {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">
        绿植是数字花园的隐喻：每座花园对应 <code className="rounded bg-black/5 px-1">content/&#123;gardenId&#125;</code>，
        Markdown 文章是叶子，Agent 是园丁。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <LinkCard href="/gardens" title="进入知识库" desc="浏览全部花园与文章" />
        <LinkCard href="/chat" title="让 Agent 浇灌" desc="对话驱动整理与蒸馏" />
      </div>
    </div>
  );
}

function AgentsPanel() {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">
        手机支架 = 随时呼叫。超级 Agent 统筹全局，管理 Agent 守 Workspace，子 Agent 执行后
        report_back——结果唯一通道，禁止偷看子会话正文。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <LinkCard href="/chat" title="打开对话" desc="主会话 · SSE 流式" />
        <LinkCard href="/agents" title="Agent 工作台" desc="层级 · 心跳 · 工具" />
        <LinkCard href="/runs" title="运行记录" desc="phase · awaiting_human" />
        <LinkCard href="/cron" title="定时任务" desc="心跳与 cron 面板" />
      </div>
    </div>
  );
}

function FunPanel({ hotspot }: { hotspot: OfficeHotspotId }) {
  if (hotspot === "calendar") {
    return (
      <div className="space-y-3 text-sm text-[var(--kp-text-2)]">
        <p>
          台历提醒：心跳引擎按 cron 唤醒 Agent；服务重启<strong>不</strong>自动续跑僵尸任务——人工
          retry 才是安全闸。
        </p>
        <LinkCard href="/triggers" title="Triggers" desc="自动化入口" />
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[var(--kp-text-2)]">
      <p>
        角落的小伙伴说：数据在本地，密钥不进 Git，刷新也不该丢气泡。见微是常驻数字主力，不是演示页。
      </p>
      <p className="rounded-xl bg-[#FFF7ED] px-3 py-2 text-[#9A3412]">
        提示：拖拽环顾房间 · 再点显示器 / 红夹 / 公告板继续探索。
      </p>
    </div>
  );
}

function LinkCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-white/50 bg-white/75 p-4 transition hover:border-[var(--kp-brand)]/40 hover:shadow-md"
    >
      <p className="font-semibold text-[var(--kp-ink)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--kp-text-2)]">{desc}</p>
    </Link>
  );
}
