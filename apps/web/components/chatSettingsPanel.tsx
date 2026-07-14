"use client";

/**
 * Agent Chat 右侧设置 Panel — 标签页布局 · 莫兰迪玻璃拟态
 */

import { memo, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Cpu,
  ExternalLink,
  Eye,
  Gauge,
  Sparkles,
  SlidersHorizontal,
  Wand2,
  Wrench,
} from "lucide-react";
import type { Skill, ChatSessionConfig } from "@knowpilot/shared";
import { PRIMARY_CHAT_MODELS, LLM_MODEL_IDS } from "@knowpilot/shared";
import { LucideIconByName } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { KpSelect, NativeCapabilitiesPanel } from "@/components/shared";
import type { SelectedSkill } from "@/components/chatInput";
import { TokenBudgetBar, type TokenBudgetSnapshot } from "@/components/tokenBudgetBar";
import { trpc } from "@/lib/trpc";
import { useNativeCapabilities, useSessionHoverPreview } from "@/lib/hooks";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

const MODEL_HINTS: Record<string, string> = {
  [LLM_MODEL_IDS.DEEPSEEK_V4_FLASH]: "更快响应，适合日常对话与工具调用",
  [LLM_MODEL_IDS.DEEPSEEK_V4_PRO]: "更强推理，适合复杂分析与长链路任务",
  kimi: "Moonshot 长上下文，模型 ID 来自 VITE_KIMI_MODEL",
};

function modelCardTitle(label: string): string {
  return label.replace(/^DeepSeek /, "");
}

type SettingsTab = "model" | "params" | "prompt" | "skills";

function SettingsSection({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] p-2.5 shadow-sm backdrop-blur-md">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {Icon && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <Icon className="h-3 w-3" />
            </span>
          )}
          <span className="truncate text-[11px] font-semibold text-[var(--kp-text-1)]">{title}</span>
        </div>
        {action}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function SettingsFooterLinks() {
  const links = [
    { href: "/tools", label: "工具与搜索引擎" },
    { href: "/memories", label: "长期记忆" },
    { href: "/settings", label: "远程访问与安全" },
  ] as const;
  return (
    <div className="min-w-0 space-y-1 border-t border-[var(--kp-divider)] pt-3">
      <p className="text-[10px] font-medium text-[var(--kp-text-3)]">更多系统设置</p>
      <ul className="space-y-1">
        {links.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-soft)] hover:text-[var(--kp-brand-deep)]"
            >
              <span className="truncate">{item.label}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
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
    <div className="min-w-0 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--kp-text-2)]">{label}</span>
        <span className="tabular-nums font-semibold text-[var(--kp-brand-deep)]">{display}</span>
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

function KpToggle({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-2.5 py-2">
      <div className="min-w-0 flex-1 pr-2">
        <div className="text-[11px] font-medium text-[var(--kp-text-1)]">{label}</div>
        {hint && <p className="mt-0.5 text-[10px] leading-snug text-[var(--kp-text-3)]">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200",
          checked ? "bg-[var(--kp-brand)]" : "bg-[var(--kp-bg-mute)]",
          disabled && "cursor-not-allowed opacity-45",
        )}
      >
        <span
          className={cn(
            "block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

function PanelTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[];
  active: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 border-b border-[var(--kp-divider)] px-3 pt-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-t-xl px-2 py-2.5 text-[11px] font-medium transition-colors",
              isActive
                ? "text-[var(--kp-brand-deep)]"
                : "text-[var(--kp-text-3)] hover:bg-[var(--kp-brand-soft)]/30 hover:text-[var(--kp-text-2)]",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tab.label}</span>
            {isActive && (
              <motion.span
                layoutId="chat-settings-tab"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--kp-brand)]"
                transition={spring}
              />
            )}
          </button>
        );
      })}
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

function SessionHoverPreviewToggle() {
  const { enabled, setEnabled } = useSessionHoverPreview();
  return (
    <KpToggle
      checked={enabled}
      onChange={setEnabled}
      label="会话 hover 预览"
      hint="开启后，悬停左侧会话会出现右上角监控小窗（默认关闭）"
    />
  );
}

// R17：memo 化——resetPromptToAgent/onOpenPromptEditor 已 useCallback、skills 已 useMemo，流式期间跳过
export const ChatSettingsPanel = memo(function ChatSettingsPanel({
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");

  const actionableSkills = skills.filter((s) => {
    if (!s.enabled) return false;
    const meta = parseSkillMeta(s);
    return meta.kind !== "reference";
  });

  const { data: dailyBudget } = trpc.agent.llmBudgetStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: runtimeCaps } = useNativeCapabilities({ staleTime: 120_000 });

  const thinkingOn = modelReasoningRequired || chatConfig.enableReasoning;
  const thinkingSupported = modelSupportsReasoning || modelReasoningRequired;

  const tabs = useMemo(() => {
    const base: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
      { id: "model", label: "模型", icon: Cpu },
      { id: "params", label: "参数", icon: SlidersHorizontal },
      { id: "prompt", label: "Prompt", icon: Sparkles },
    ];
    if (actionableSkills.length > 0) {
      base.push({ id: "skills", label: "Skill", icon: Wand2 });
    }
    return base;
  }, [actionableSkills.length]);

  const legacyModel =
    !PRIMARY_CHAT_MODELS.some((m) => m.id === chatConfig.model) ? chatConfig.model : null;

  return (
    <div className="flex h-full w-full min-w-0 max-w-full flex-col overflow-x-hidden">
      <div className="relative shrink-0 overflow-hidden border-b border-[var(--kp-divider)] px-3 py-2.5">
        <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[var(--kp-brand-soft)] blur-2xl" />
        <div className="relative flex items-center gap-2.5">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--kp-brand-light)] to-[var(--kp-brand-dark)] text-white shadow-md shadow-[rgba(184,160,144,0.3)]"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </motion.div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold tracking-tight text-[var(--kp-text-1)]">对话设置</h2>
            <p className="truncate text-[11px] text-[var(--kp-text-3)]">
              {PRIMARY_CHAT_MODELS.find((m) => m.id === chatConfig.model)?.label ?? chatConfig.model}
              {thinkingOn ? " · 思考开" : " · 思考关"}
            </p>
          </div>
        </div>
      </div>

      <PanelTabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        <AnimatePresence mode="wait">
          {activeTab === "model" && (
            <motion.div
              key="tab-model"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-[var(--kp-text-3)]">选择模型</p>
                <div className="flex flex-col gap-1.5">
                  {PRIMARY_CHAT_MODELS.map((m) => {
                    const active = chatConfig.model === m.id;
                    return (
                      <motion.button
                        key={m.id}
                        type="button"
                        whileTap={{ scale: 0.98 }}
                        onClick={() =>
                          updateConfig({
                            model: m.id,
                            enableReasoning: m.reasoningRequired ? true : chatConfig.enableReasoning,
                          })
                        }
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                          active
                            ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] shadow-sm"
                            : "border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]",
                        )}
                      >
                        <Cpu className={cn("h-4 w-4 shrink-0", active ? "text-[var(--kp-brand-deep)]" : "text-[var(--kp-text-3)]")} />
                        <div className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-[12px] font-semibold leading-tight",
                              active ? "text-[var(--kp-brand-deep)]" : "text-[var(--kp-text-1)]",
                            )}
                          >
                            {modelCardTitle(m.label)}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] leading-snug text-[var(--kp-text-3)]">
                            {MODEL_HINTS[m.id] ?? m.provider}
                          </span>
                        </div>
                        {active && (
                          <span className="shrink-0 rounded-full bg-[var(--kp-brand-deep)] px-2 py-0.5 text-[9px] font-medium text-white">
                            当前
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
                {legacyModel && (
                  <p className="mt-1.5 rounded-lg bg-[var(--kp-bg-mute)]/60 px-2 py-1 text-[10px] text-[var(--kp-text-3)]">
                    当前会话模型 <code className="text-[var(--kp-text-2)]">{legacyModel}</code> 为旧 ID，请选择上方模型切换。
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] p-2.5 shadow-sm backdrop-blur-md">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                    <Brain className="h-3 w-3" />
                  </span>
                  <span className="text-[11px] font-semibold text-[var(--kp-text-1)]">思考模式</span>
                </div>
                <div className="space-y-2">
                  <KpToggle
                    checked={thinkingOn}
                    disabled={modelReasoningRequired || !thinkingSupported}
                    onChange={(enableReasoning) => updateConfig({ enableReasoning })}
                    label={modelReasoningRequired ? "扩展思考（始终开启）" : "扩展思考"}
                    hint={
                      !thinkingSupported
                        ? "当前模型不支持 thinking 模式"
                        : "对应 API thinking.type enabled / disabled"
                    }
                  />
                  <KpSelect
                    label="思考强度"
                    variant="capsule"
                    size="sm"
                    value={chatConfig.reasoningEffort === "max" ? "max" : "high"}
                    disabled={!thinkingOn || !thinkingSupported}
                    onChange={(reasoningEffort) => updateConfig({ reasoningEffort })}
                    options={[
                      { value: "high", label: "High · 默认" },
                      { value: "max", label: "Max · 更深" },
                    ]}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "params" && (
            <motion.div
              key="tab-params"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="min-w-0 space-y-3"
            >
              <SettingsSection title="上下文与预算" icon={Gauge}>
                <TokenBudgetBar snapshot={tokenBudget} dailyBudget={dailyBudget} embedded />
              </SettingsSection>

              <SettingsSection title="生成参数" icon={SlidersHorizontal}>
                <div className="space-y-3">
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
                </div>
              </SettingsSection>

              <SettingsSection title="工具调用" icon={Wrench}>
                <div className="space-y-3">
                  <MorandiSlider
                    label="单工具超时"
                    value={chatConfig.toolCallTimeoutMs ?? 0}
                    min={0}
                    max={180000}
                    step={5000}
                    display={(chatConfig.toolCallTimeoutMs ?? 0) === 0 ? "默认" : `${Math.round((chatConfig.toolCallTimeoutMs ?? 0) / 1000)}s`}
                    onChange={(toolCallTimeoutMs) => updateConfig({ toolCallTimeoutMs })}
                  />
                  <MorandiSlider
                    label="最大轮数"
                    value={chatConfig.maxToolRounds ?? 0}
                    min={0}
                    max={30}
                    step={1}
                    display={(chatConfig.maxToolRounds ?? 0) === 0 ? "默认" : String(chatConfig.maxToolRounds ?? 0)}
                    onChange={(maxToolRounds) => updateConfig({ maxToolRounds })}
                  />
                  <p className="text-[10px] leading-snug text-[var(--kp-text-3)]">
                    设为 0 时使用服务端默认（config.yaml / 环境变量）。
                  </p>
                </div>
              </SettingsSection>

              <SettingsSection title="界面" icon={Eye}>
                <SessionHoverPreviewToggle />
              </SettingsSection>

              {runtimeCaps && (
                <div className="min-w-0" data-testid="chat-runtime-capabilities">
                  <NativeCapabilitiesPanel
                    data={runtimeCaps}
                    compact
                    sidebar
                    title="网络工具运行时"
                    detailHref="/tools"
                    detailLabel="能力详情"
                  />
                </div>
              )}

              <SettingsFooterLinks />
            </motion.div>
          )}

          {activeTab === "prompt" && (
            <motion.div
              key="tab-prompt"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--kp-text-1)]">System Prompt</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                    chatConfig.customSystemPrompt
                      ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                      : "bg-[var(--kp-bg-mute)] text-[var(--kp-text-3)]",
                  )}
                >
                  {chatConfig.customSystemPrompt ? "已自定义" : "跟随 Agent"}
                </span>
              </div>
              <p className="min-h-[200px] whitespace-pre-wrap rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/70 p-3 text-xs leading-relaxed text-[var(--kp-text-2)]">
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
            </motion.div>
          )}

          {activeTab === "skills" && actionableSkills.length > 0 && (
            <motion.div
              key="tab-skills"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <p className="text-[11px] text-[var(--kp-text-3)]">
                选中后将在输入框生效，发送时覆盖 System Prompt。
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {actionableSkills.slice(0, 16).map((s, i) => {
                  const active = selectedSkill?.id === s.id;
                  const meta = parseSkillMeta(s);
                  return (
                    <motion.button
                      key={s.id}
                      type="button"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02, ...spring }}
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
                        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs transition-all duration-200",
                        active
                          ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] shadow-sm"
                          : "border-[var(--kp-divider)] bg-[var(--kp-bg)] hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]",
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                        <LucideIconByName name={s.icon} className="h-4 w-4" />
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

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
