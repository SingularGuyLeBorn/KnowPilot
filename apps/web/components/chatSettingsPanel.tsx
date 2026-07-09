"use client";

/**
 * Agent Chat 右侧设置 Panel — 标签页布局 · 莫兰迪玻璃拟态
 */

import { memo, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Cpu,
  Gauge,
  Sparkles,
  SlidersHorizontal,
  Wand2,
  Wrench,
} from "lucide-react";
import type { Skill, ChatSessionConfig } from "@knowpilot/shared";
import { PRIMARY_CHAT_MODELS } from "@knowpilot/shared";
import { LucideIconByName } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { KpSelect, NativeCapabilitiesPanel } from "@/components/shared";
import type { SelectedSkill } from "@/components/chatInput";
import { TokenBudgetBar, type TokenBudgetSnapshot } from "@/components/tokenBudgetBar";
import { trpc } from "@/lib/trpc";
import { useNativeCapabilities } from "@/lib/hooks";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

const MODEL_HINTS: Record<string, string> = {
  "deepseek-v4-flash": "更快响应，适合日常对话与工具调用",
  "deepseek-v4-pro": "更强推理，适合复杂分析与长链路任务",
  kimi: "Moonshot 长上下文，模型 ID 来自 VITE_KIMI_MODEL",
};

function modelCardTitle(label: string): string {
  return label.replace(/^DeepSeek /, "");
}

type SettingsTab = "model" | "params" | "prompt" | "skills";

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
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/50 px-3 py-2.5">
      <div className="min-w-0 flex-1 pr-2">
        <div className="text-xs font-medium text-[var(--kp-text-1)]">{label}</div>
        {hint && <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--kp-text-3)]">{hint}</p>}
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
                ? "text-[var(--kp-brand-dark)]"
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
    <div className="flex h-full w-[360px] flex-col">
      <div className="relative shrink-0 overflow-hidden border-b border-[var(--kp-divider)] px-4 py-4">
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
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight text-[var(--kp-text-1)]">对话设置</h2>
            <p className="truncate text-xs text-[var(--kp-text-3)]">
              {PRIMARY_CHAT_MODELS.find((m) => m.id === chatConfig.model)?.label ?? chatConfig.model}
              {thinkingOn ? " · 思考开" : " · 思考关"}
            </p>
          </div>
        </div>
      </div>

      <PanelTabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {activeTab === "model" && (
            <motion.div
              key="tab-model"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div>
                <p className="mb-2 text-[11px] font-medium text-[var(--kp-text-3)]">选择模型</p>
                <div className="grid grid-cols-3 gap-2">
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
                          "flex min-h-[88px] flex-col items-start rounded-2xl border px-2.5 py-3 text-left transition-colors",
                          active
                            ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] shadow-sm"
                            : "border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]",
                        )}
                      >
                        <span
                          className={cn(
                            "text-[11px] font-semibold leading-tight",
                            active ? "text-[var(--kp-brand-dark)]" : "text-[var(--kp-text-1)]",
                          )}
                        >
                          {modelCardTitle(m.label)}
                        </span>
                        <span className="mt-1.5 line-clamp-3 text-[9px] leading-relaxed text-[var(--kp-text-3)]">
                          {MODEL_HINTS[m.id] ?? m.provider}
                        </span>
                        {active && (
                          <span className="mt-auto pt-2 text-[10px] font-medium text-[var(--kp-brand-dark)]">
                            当前使用
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
                {legacyModel && (
                  <p className="mt-2 rounded-lg bg-[var(--kp-bg-mute)]/60 px-2.5 py-1.5 text-[10px] text-[var(--kp-text-3)]">
                    当前会话模型 <code className="text-[var(--kp-text-2)]">{legacyModel}</code> 为旧 ID，请选择上方模型切换。
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] p-3 shadow-sm backdrop-blur-md">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
                    <Brain className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-semibold text-[var(--kp-text-1)]">思考模式</span>
                </div>
                <div className="space-y-3">
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
                  <p className="text-[10px] leading-relaxed text-[var(--kp-text-3)]">
                    思考开启时 temperature 等参数由模型忽略。结构对所有模型一致，不可用项会自动禁用。
                  </p>
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
              className="space-y-4"
            >
              <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] p-3 shadow-sm backdrop-blur-md">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
                    <Gauge className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-semibold text-[var(--kp-text-1)]">Token 预算</span>
                </div>
                <TokenBudgetBar snapshot={tokenBudget} dailyBudget={dailyBudget} />
              </div>

              <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] p-3 shadow-sm backdrop-blur-md">
                <div className="mb-3 text-xs font-semibold text-[var(--kp-text-1)]">生成参数</div>
                <div className="space-y-4">
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
              </div>

              <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-glass-bg)] p-3 shadow-sm backdrop-blur-md">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
                    <Wrench className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-semibold text-[var(--kp-text-1)]">工具调用</span>
                </div>
                <div className="space-y-4">
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
                  <p className="text-[10px] leading-relaxed text-[var(--kp-text-3)]">
                    超时设为 0 走后端默认（60s）；轮数设为 0 走后端默认（12）。超时后该工具返回错误结果而非永久挂起。
                  </p>
                </div>
              </div>

              {runtimeCaps && (
                <div data-testid="chat-runtime-capabilities">
                  <NativeCapabilitiesPanel
                    data={runtimeCaps}
                    compact
                    title="网络工具运行时"
                    showSearchEnginesInCompact
                    detailHref="/tools"
                    detailLabel="能力详情"
                  />
                </div>
              )}
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
                      ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]"
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
                          : "border-[var(--kp-divider)] bg-[var(--kp-bg)]/50 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]",
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
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
