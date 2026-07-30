"use client";

/**
 * Kimi 风格能力 pill 行：输入框下方、悬停驱动动态 SVG 图标。
 * 只挂真实能力（深度研究 / Skill / 目标 / 引用 / 图片 / 队列），不做装饰假入口。
 */

import { useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import {
  IconDeepResearch,
  IconDocRef,
  IconGoalFlag,
  IconImageFrame,
  IconQueueBars,
  IconSkillWand,
  IconSwarmCluster,
  type ChipIconState,
} from "@/components/animatedChipIcons";

export interface ChatInputChipsProps {
  disabled?: boolean;
  isSubagentSession?: boolean;
  deepResearchEnabled: boolean;
  canStartDeepResearch: boolean;
  onToggleDeepResearch: () => void;
  selectedSkillName?: string | null;
  onOpenSkillPicker: () => void;
  onInsertGoal: () => void;
  onOpenMention: () => void;
  onAttachImage: () => void;
  /** 打开侧栏 Agent / 派生态（集群） */
  onFocusSwarm?: () => void;
  queueLength: number;
  onFocusQueue?: () => void;
}

function ChipButton({
  label,
  title,
  testId,
  pressed,
  disabled,
  onClick,
  Icon,
}: {
  label: string;
  title: string;
  testId: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  Icon: ComponentType<{ state?: ChipIconState; className?: string }>;
}) {
  const [hovered, setHovered] = useState(false);
  const state: ChipIconState = pressed ? "active" : hovered ? "hover" : "idle";

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
        "border-[var(--kp-divider)] bg-[var(--kp-bg)] text-[var(--kp-text-2)]",
        "hover:border-[color-mix(in_srgb,var(--kp-brand)_35%,var(--kp-divider))]",
        "hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
        pressed &&
          "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/55 text-[var(--kp-brand-deep)]",
        disabled && "cursor-not-allowed opacity-40 hover:bg-[var(--kp-bg)]",
      )}
    >
      <Icon state={state} className="h-[15px] w-[15px]" />
      <span>{label}</span>
    </button>
  );
}

export function ChatInputChips({
  disabled,
  isSubagentSession,
  deepResearchEnabled,
  canStartDeepResearch,
  onToggleDeepResearch,
  selectedSkillName,
  onOpenSkillPicker,
  onInsertGoal,
  onOpenMention,
  onAttachImage,
  onFocusSwarm,
  queueLength,
  onFocusQueue,
}: ChatInputChipsProps) {
  return (
    <div
      className="mt-2.5 flex flex-wrap items-center justify-center gap-2"
      data-testid="chat-input-chips"
    >
      {!isSubagentSession && (
        <ChipButton
          testId="chat-deep-research-toggle"
          label="深度研究"
          pressed={deepResearchEnabled && canStartDeepResearch}
          disabled={disabled || !canStartDeepResearch}
          onClick={onToggleDeepResearch}
          Icon={IconDeepResearch}
          title={
            canStartDeepResearch
              ? deepResearchEnabled
                ? "关闭深度研究（发送不再自动加 /research）"
                : "开启深度研究：发送时自动加 /research"
              : "深度研究仅新会话首条消息前可选"
          }
        />
      )}
      <ChipButton
        testId="chat-chip-skill"
        label={selectedSkillName ? `Skill · ${selectedSkillName.slice(0, 10)}` : "Skill"}
        pressed={!!selectedSkillName}
        disabled={disabled}
        onClick={onOpenSkillPicker}
        Icon={IconSkillWand}
        title={
          selectedSkillName
            ? `已选 ${selectedSkillName}（点击更换）`
            : isSubagentSession
              ? "选择已启用 Skill，或输入 /"
              : "选择命令 / Skill，或输入 /goal、/research"
        }
      />
      {!isSubagentSession && (
        <ChipButton
          testId="chat-chip-goal"
          label="目标"
          disabled={disabled}
          onClick={onInsertGoal}
          Icon={IconGoalFlag}
          title="插入 /goal ，设立 standing goal"
        />
      )}
      <ChipButton
        testId="chat-mention-post"
        label="引用"
        disabled={disabled}
        onClick={onOpenMention}
        Icon={IconDocRef}
        title="引用文章（输入 @ 也可）"
      />
      <ChipButton
        testId="chat-attach-image"
        label="图片"
        disabled={disabled}
        onClick={onAttachImage}
        Icon={IconImageFrame}
        title="添加图片"
      />
      {!isSubagentSession && onFocusSwarm && (
        <ChipButton
          testId="chat-chip-swarm"
          label="集群"
          disabled={disabled}
          onClick={onFocusSwarm}
          Icon={IconSwarmCluster}
          title="查看 Agent 集群 / 侧栏"
        />
      )}
      {queueLength > 0 && (
        <ChipButton
          testId="chat-chip-queue"
          label={`队列 ${queueLength}`}
          disabled={disabled}
          onClick={() => onFocusQueue?.()}
          Icon={IconQueueBars}
          title="查看发送队列"
        />
      )}
    </div>
  );
}
