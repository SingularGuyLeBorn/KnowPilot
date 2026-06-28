"use client";

/**
 * Agent Chat 右侧设置 Panel — 玻璃拟态 · 弹簧动效 · 渐进披露
 * 设计参考：content/skills/design-references (ui-ux-pro-max, Atmospheric Glass)
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  ChevronDown,
  Cpu,
  Gauge,
  Sparkles,
  SlidersHorizontal,
  Wand2,
} from "lucide-react";
import type { Skill, ChatSessionConfig } from "@knowpilot/shared";
import { CHAT_MODELS } from "@knowpilot/shared";
import { LucideIconByName, ChatShortcutHints } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { SelectedSkill } from "@/components/chatInput";
import { TokenBudgetBar, type TokenBudgetSnapshot } from "@/components/tokenBudgetBar";
import { trpc } from "@/lib/trpc";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.section
      layout
      className="overflow-hidden rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] shadow-sm backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-[var(--kp-brand-soft)]/40"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold text-[var(--kp-text-1)]">{title}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4 text-[var(--kp-text-3)]" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-[var(--kp-divider-light)] px-4 pb-4 pt-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function MorandiSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--kp-text-2)]">{label}</span>
        <span className="tabular-nums font-semibold text-[var(--kp-brand-dark)]">{display}</span>
      </div>
      <div className="relative h-2 rounded-full bg-[var(--kp-bg-mute)]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--kp-brand-light)] to-[var(--kp-brand-dark)]"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={label}
        />
        <motion.div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--kp-brand)] shadow-md"
          initial={false}
          animate={{ left: `calc(${pct}% - 8px)` }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
        />
      </div>
    </div>
  );
}

export interface ChatSettingsPanelProps {
  chatConfig: ChatSessionConfig;
  updateConfig: (patch: Partial<ChatSessionConfig>) => void;
  resetPromptToAgent: () => void;
  onOpenPromptEditor: () => void;
  skills: Skill[];
  selectedSkill: SelectedSkill | null;
  onSelectSkill: (skill: SelectedSkill | null) => void;
  modelSupportsReasoning: boolean;
  modelReasoningRequired: boolean;
  tokenBudget: TokenBudgetSnapshot;
}

export function ChatSettingsPanel({
  chatConfig,
  updateConfig,
  resetPromptToAgent,
  onOpenPromptEditor,
  skills,
  selectedSkill,
  onSelectSkill,
  modelSupportsReasoning,
  modelReasoningRequired,
  tokenBudget,
}: ChatSettingsPanelProps) {
  const actionableSkills = skills.filter((s) => {
    if (!s.enabled) return false;
    const meta = parseSkillMeta(s);
    return meta.kind !== "reference";
  });

  const { data: dailyBudget } = trpc.agent.llmBudgetStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  return (
    <div className="flex h-full w-[360px] flex-col">
      <div className="relative overflow-hidden border-b border-[var(--kp-divider)] px-4 py-4">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[var(--kp-brand-soft)] blur-2xl" />
        <div className="relative flex items-center gap-3">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--kp-brand-light)] to-[var(--kp-brand-dark)] text-white shadow-lg shadow-[rgba(184,160,144,0.35)]"
          >
            <SlidersHorizontal className="h-5 w-5" />
          </motion.div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-[var(--kp-text-1)]">对话设置</h2>
            <p className="text-xs text-[var(--kp-text-3)]">模型 · 参数 · Skill</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <Section title="Token 预算" icon={Gauge} defaultOpen={tokenBudget.compactRatio >= 0.5}>
          <TokenBudgetBar snapshot={tokenBudget} dailyBudget={dailyBudget} />
        </Section>

        <Section title="模型" icon={Cpu}>
          <div className="grid grid-cols-1 gap-1.5">
            {CHAT_MODELS.map((m) => {
              const active = chatConfig.model === m.id;
              return (
                <motion.button
                  key={m.id}
                  type="button"
                  layout
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() =>
                    updateConfig({
                      model: m.id,
                      enableReasoning: m.reasoningRequired ?? chatConfig.enableReasoning,
                    })
                  }
                  className={cn(
                    "relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left text-xs transition-colors duration-200",
                    active
                      ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)] shadow-sm"
                      : "border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 text-[var(--kp-text-2)] hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="model-active-glow"
                      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[var(--kp-brand-soft)] to-transparent"
                      transition={spring}
                    />
                  )}
                  <span className="relative font-semibold">{m.label}</span>
                  {m.reasoningRequired && (
                    <span className="relative ml-2 inline-flex items-center gap-0.5 rounded-full bg-[var(--kp-brand)]/15 px-1.5 py-0.5 text-[10px] text-[var(--kp-brand-dark)]">
                      <Brain className="h-2.5 w-2.5" />
                      推理
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </Section>

        {(modelSupportsReasoning || modelReasoningRequired) && (
          <Section title="思考模式" icon={Brain} defaultOpen={false}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/50 px-3 py-2.5 transition hover:border-[var(--kp-brand-light)]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--kp-brand)]"
                checked={modelReasoningRequired || chatConfig.enableReasoning}
                disabled={modelReasoningRequired}
                onChange={(e) => updateConfig({ enableReasoning: e.target.checked })}
              />
              <div className="text-xs">
                <div className="font-medium text-[var(--kp-text-1)]">
                  {modelReasoningRequired ? "推理模型（始终开启）" : "启用扩展思考"}
                </div>
                <div className="mt-0.5 text-[var(--kp-text-3)]">展示思考过程与时间线</div>
              </div>
            </label>
          </Section>
        )}

        <Section title="生成参数" icon={SlidersHorizontal} defaultOpen={false}>
          <MorandiSlider
            label="温度"
            value={chatConfig.temperature}
            min={0}
            max={2}
            step={0.1}
            display={chatConfig.temperature.toFixed(1)}
            onChange={(temperature) => updateConfig({ temperature })}
          />
          <MorandiSlider
            label="最大 Token"
            value={chatConfig.maxTokens}
            min={256}
            max={8192}
            step={256}
            display={String(chatConfig.maxTokens)}
            onChange={(maxTokens) => updateConfig({ maxTokens })}
          />
        </Section>

        <Section title="System Prompt" icon={Sparkles}>
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                chatConfig.customSystemPrompt
                  ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
                  : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
              )}
            >
              {chatConfig.customSystemPrompt ? "已自定义" : "跟随 Agent"}
            </span>
          </div>
          <p className="line-clamp-4 rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/70 p-3 text-xs leading-relaxed text-[var(--kp-text-2)]">
            {chatConfig.systemPrompt || "（空）"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onOpenPromptEditor}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1 text-xs")}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={resetPromptToAgent}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-xs")}
            >
              重置
            </button>
          </div>
        </Section>

        {actionableSkills.length > 0 && (
          <Section title="可用 Skills" icon={Wand2}>
            <div className="grid grid-cols-1 gap-1.5">
              {actionableSkills.slice(0, 12).map((s, i) => {
                const active = selectedSkill?.id === s.id;
                const meta = parseSkillMeta(s);
                return (
                  <motion.button
                    key={s.id}
                    type="button"
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03, ...spring }}
                    whileHover={{ x: 2 }}
                    onClick={() =>
                      onSelectSkill(
                        active
                          ? null
                          : {
                              id: s.id,
                              name: s.name,
                              icon: s.icon,
                              description: s.description,
                              code: s.code,
                            },
                      )
                    }
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-all duration-200",
                      active
                        ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] shadow-sm"
                        : "border-[var(--kp-divider)] bg-[var(--kp-bg)]/50 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]",
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
                      <LucideIconByName name={s.icon} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--kp-text-1)]">{s.name}</span>
                      {meta.trigger && (
                        <span className="block truncate text-[10px] text-[var(--kp-text-3)]">{meta.trigger}</span>
                      )}
                    </span>
                  </motion.button>
                );
              })}
            </div>
            <div className="flex items-center justify-center pt-1">
              <ChatShortcutHints />
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

/** 解析 Skill metaJson（与 sync frontmatter 对齐） */
export function parseSkillMeta(skill: Skill & { metaJson?: string | null }): {
  kind?: string;
  trigger?: string;
  model?: string;
  context?: string;
} {
  if (skill.metaJson) {
    try {
      return JSON.parse(skill.metaJson) as ReturnType<typeof parseSkillMeta>;
    } catch {
      /* fallthrough */
    }
  }
  return {
    trigger: skill.trigger ?? undefined,
  };
}
