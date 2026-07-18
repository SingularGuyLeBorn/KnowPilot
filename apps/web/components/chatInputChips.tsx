"use client";

/**
 * 输入框下方 chip 行：Skill / 队列等真实能力快捷入口。
 */

import { ListOrdered, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatInputChipsProps {
  onOpenSkillPicker: () => void;
  queueLength: number;
  onFocusQueue?: () => void;
  /** 仅用于高亮「已选 Skill」态；名称展示在输入框上方 banner，避免双份文案 */
  selectedSkillName?: string | null;
  onClearSkill?: () => void;
}

export function ChatInputChips({
  onOpenSkillPicker,
  queueLength,
  onFocusQueue,
  selectedSkillName,
}: ChatInputChipsProps) {
  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-center gap-2"
      data-testid="chat-input-chips"
    >
      <button
        type="button"
        onClick={onOpenSkillPicker}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition",
          selectedSkillName
            ? "border-[var(--kp-brand-light)] bg-[var(--kp-brand-soft)]/50 text-[var(--kp-brand-deep)]"
            : "border-[var(--kp-divider)] bg-[var(--kp-bg)] text-[var(--kp-text-2)] hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-mute)]",
        )}
        data-testid="chat-chip-skill"
        title={selectedSkillName ? `已选 ${selectedSkillName}（点此更换）` : "选择 Skill，或输入 /"}
      >
        <Wand2 className="h-3 w-3" />
        Skill
      </button>
      {queueLength > 0 && (
        <button
          type="button"
          onClick={onFocusQueue}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-1 text-[11px] font-medium text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
          data-testid="chat-chip-queue"
        >
          <ListOrdered className="h-3 w-3" />
          队列 {queueLength}
        </button>
      )}
    </div>
  );
}
