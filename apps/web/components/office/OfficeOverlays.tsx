"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import {
  ABOUT_FACTS,
  ARCHITECTURE_BOARD,
  BOARD_STICKIES,
  BOOKSHELF_TITLES,
  FORMULA_SHEETS,
  HOTSPOT_META,
  JOURNEY_STOPS,
  KNOWLEDGE_BOARD,
  MONITOR_WALL,
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
          className="absolute inset-0 z-30 flex items-end justify-center bg-[#0B3A66]/30 p-4 backdrop-blur-[3px] sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label={HOTSPOT_META[hotspot].label}
            className={`relative max-h-[88vh] w-full overflow-y-auto shadow-2xl ${
              kind === "knowledge"
                ? "max-w-2xl rounded-sm border border-[#E2E8F0] bg-[#F8FAFC] p-0"
                : "max-w-3xl rounded-[28px] border border-white/40 bg-[color-mix(in_srgb,var(--kp-glass-bg)_92%,white)] p-5 backdrop-blur-xl sm:p-7"
            }`}
            initial={{ y: 28, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            {kind === "knowledge" ? (
              <PaperReader onClose={onClose} />
            ) : (
              <>
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
                {kind === "journey" && <JourneyPanel />}
                {kind === "garden" && <GardenPanel />}
                {kind === "agents" && <AgentsPanel />}
                {kind === "fun" && <FunPanel hotspot={hotspot} />}
                {kind === "mood" && <MoodPanel />}
                {kind === "server" && <ServerPanel />}
                {kind === "bookshelf" && <BookshelfPanel />}
                {kind === "architecture" && <ArchitecturePanel />}
                {kind === "formulas" && <FormulasPanel />}

                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--kp-brand)] px-5 py-2.5 text-sm font-medium text-white shadow-md transition hover:brightness-110"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function titleFor(kind: OverlayKind): string {
  switch (kind) {
    case "projects":
      return "多屏墙 · 能力矩阵";
    case "about":
      return "Quick Facts";
    case "knowledge":
      return "知识库看板";
    case "journey":
      return "Oasis Journey";
    case "garden":
      return "数字花园";
    case "agents":
      return "呼叫 Agent";
    case "fun":
      return "角落彩蛋";
    case "mood":
      return "书房氛围";
    case "server":
      return "NVIDIA 推理机架";
    case "bookshelf":
      return "AI Library";
    case "architecture":
      return "Transformer 架构板";
    case "formulas":
      return "桌面推导草稿";
  }
}

/** 整齐知识库看板浮层 */
function PaperReader({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative">
      <article className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-wide text-[#64748B]">
              {OFFICE_BRAND.en} · Knowledge Board
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-[#0F172A] sm:text-2xl">
              知识库看板 · Gardens
            </h2>
            <p className="mt-2 text-xs text-[#0284C7]">content/ · Markdown 为唯一事实源</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#64748B] hover:bg-black/5"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="space-y-2">
          {KNOWLEDGE_BOARD.map((g) => (
            <li key={g.id}>
              <Link
                href={`/gardens/${g.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 transition hover:border-[var(--kp-brand)]/40 hover:shadow-sm"
              >
                <div>
                  <p className="font-semibold text-[#0F172A]">{g.title}</p>
                  <p className="text-sm text-[#64748B]">{g.meta}</p>
                </div>
                <span className="text-xs font-medium text-[var(--kp-brand)]">{g.id}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap gap-2">
          {BOARD_STICKIES.map((s) => (
            <span
              key={s.label}
              className="rounded-sm px-2 py-1 text-[11px] font-medium text-[#1E293B]"
              style={{ background: s.color }}
            >
              {s.label}
            </span>
          ))}
        </div>
      </article>

      <div className="sticky bottom-0 flex justify-center border-t border-[#E2E8F0] bg-[#F8FAFC]/95 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-2.5 text-sm font-medium text-white shadow-md"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>
    </div>
  );
}

function ServerPanel() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-[var(--kp-text-2)]">
      <p className="rounded-2xl bg-[#052E16] px-4 py-3 text-[#A3E635]">
        NVIDIA DGX 风格机架 · H100 / NVLink 意象。本地优先不等于没有算力想象——见微的 Agent 与
        vision / embedding 任务可以挂到本机或远端 GPU。
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          ["品牌灯条", "NVIDIA Green #76B900"],
          ["互联", "双主机网线桥接"],
          ["用途", "推理 · 微调草稿 · OCR/Vision"],
          ["原则", "密钥不进 Git · 本地落盘"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/50 bg-white/70 px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
              {k}
            </dt>
            <dd className="mt-0.5 font-medium text-[var(--kp-ink)]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BookshelfPanel() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--kp-text-2)]">
        书架藏书：深度学习、Transformer、强化学习与 Agent 系统设计——和见微的运行时同频。
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {BOOKSHELF_TITLES.map((t) => (
          <li
            key={t}
            className="rounded-xl border border-white/50 bg-white/75 px-3 py-2 text-sm font-medium text-[var(--kp-ink)]"
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArchitecturePanel() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-[var(--kp-ink)]">{ARCHITECTURE_BOARD.title}</h3>
        <p className="text-sm text-[var(--kp-brand)]">{ARCHITECTURE_BOARD.subtitle}</p>
      </div>
      <ol className="space-y-2">
        {ARCHITECTURE_BOARD.blocks.map((b, i) => (
          <li
            key={b.label}
            className="flex items-start gap-3 rounded-xl border border-white/50 bg-white/75 px-3 py-2.5"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--kp-brand)] text-xs font-bold text-white">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-[var(--kp-ink)]">{b.label}</p>
              <p className="font-mono text-sm text-[var(--kp-text-2)]">{b.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-[var(--kp-text-3)]">{ARCHITECTURE_BOARD.stack.join(" · ")}</p>
    </div>
  );
}

function FormulasPanel() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--kp-text-2)]">
        桌面 A4：大模型核心推导草稿——Attention、CE Loss、KV Cache、RoPE、MoE、RLHF。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FORMULA_SHEETS.map((s) => (
          <article
            key={s.title}
            className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-3 shadow-sm"
          >
            <h4 className="text-sm font-bold text-[#0F172A]">{s.title}</h4>
            {s.lines.map((line) => (
              <p key={line} className="mt-1 font-mono text-xs leading-relaxed text-[#334155]">
                {line}
              </p>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}

function ProjectsPanel() {
  const [filter, setFilter] = useState("全部");
  const tags = ["全部", ...Array.from(new Set(PROJECTS.map((p) => p.tag)))];
  const items = filter === "全部" ? PROJECTS : PROJECTS.filter((p) => p.tag === filter);

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--kp-text-2)]">
        量化级多屏墙：每块屏挂一条见微能力面，点开即进真实路由。
      </p>
      <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {MONITOR_WALL.map((app) => (
          <Link
            key={app.id}
            href={app.href}
            className="flex flex-col items-center gap-1 rounded-xl p-2 transition hover:bg-white/80"
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[9px] font-bold text-white shadow-sm"
              style={{ background: app.color }}
            >
              {app.label.slice(0, 3)}
            </span>
            <span className="text-[10px] text-[var(--kp-text-2)]">{app.label}</span>
          </Link>
        ))}
      </div>

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
      <p className="rounded-2xl bg-[#EFF6FF] px-4 py-3 text-sm leading-relaxed text-[#0C4A6E]">
        {OFFICE_BRAND.name}（{OFFICE_BRAND.en}）——{OFFICE_BRAND.tagline}。
        点击房间物件探索能力；这不只是展示页，而是连进真实路由的指挥舱。
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

function JourneyPanel() {
  return (
    <ol className="relative space-y-0 border-l-2 border-[var(--kp-brand)]/30 pl-5">
      {JOURNEY_STOPS.map((s) => (
        <li key={s.year} className="relative pb-5 last:pb-0">
          <span className="absolute -left-[1.4rem] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--kp-brand)] ring-4 ring-white" />
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--kp-brand)]">
              {s.year}
            </p>
            <p className="text-[11px] text-[var(--kp-text-3)]">{s.region}</p>
          </div>
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
        绿植是数字花园的隐喻：每座花园对应{" "}
        <code className="rounded bg-black/5 px-1">content/&#123;gardenId&#125;</code>
        ，Markdown 文章是叶子，Agent 是园丁。
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

function MoodPanel() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[var(--kp-text-2)]">
      <p>
        落地灯照亮指挥舱：浅色科技书房不是装饰，是「状态在内存、推拉结合」的工作现场——开着的面板自己动，刷新也不丢。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <LinkCard href="/dashboard" title="Dashboard" desc="全局脉搏一览" />
        <LinkCard href="/settings" title="设置" desc="鉴权 · 偏好 · 运行时" />
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
      <p className="rounded-xl bg-[#EFF6FF] px-3 py-2 text-[#0C4A6E]">
        提示：拖拽环顾房间 · 再点显示器 / 速查夹 / 公告板 / 旅程地图继续探索。
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
