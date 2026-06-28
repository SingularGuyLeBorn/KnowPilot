"use client";

import { useRef, useState } from "react";
import { Send, X } from "lucide-react";
import type { Skill } from "@knowpilot/shared";
import { LucideIconByName, ChatShortcutHints, ShortcutSlashSkill } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export interface SelectedSkill {
  id: string;
  name: string;
  icon?: string | null;
  description: string;
  code: string;
}

interface ChatInputAreaProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string, skill?: SelectedSkill) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  skills: Skill[];
  selectedSkill: SelectedSkill | null;
  onSkillChange: (skill: SelectedSkill | null) => void;
}

export function ChatInputArea({
  value,
  onChange,
  onSend,
  disabled,
  isStreaming,
  skills,
  selectedSkill,
  onSkillChange,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);

  const enabledSkills = skills.filter((s) => s.enabled);

  const filteredSkills = enabledSkills.filter((s) => {
    const q = skillQuery.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
  });

  const detectSkillTrigger = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = before.match(/\/([\w-]*)$/);
    if (match) {
      setSkillQuery(match[1] ?? "");
      setSkillOpen(true);
      setHighlightIdx(0);
    } else {
      setSkillOpen(false);
      setSkillQuery("");
    }
  };

  const activeHighlightIdx =
    skillOpen && filteredSkills.length > 0
      ? Math.min(highlightIdx, filteredSkills.length - 1)
      : 0;

  const selectSkill = (skill: Skill) => {
    onSkillChange({
      id: skill.id,
      name: skill.name,
      icon: skill.icon,
      description: skill.description,
      code: skill.code,
    });
    const ta = textareaRef.current;
    if (ta) {
      const before = value.slice(0, ta.selectionStart);
      const after = value.slice(ta.selectionStart);
      const cleaned = before.replace(/\/[\w-]*$/, "");
      onChange(cleaned + after);
    } else {
      onChange(value.replace(/\/[\w-]*$/, ""));
    }
    setSkillOpen(false);
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text, selectedSkill ?? undefined);
    onSkillChange(null);
  };

  return (
    <div className="relative mx-auto max-w-3xl">
      {selectedSkill && (
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand-soft)] px-2.5 py-1 text-xs font-medium text-[var(--kp-brand-dark)]">
            <LucideIconByName name={selectedSkill.icon} className="h-3 w-3" />
            {selectedSkill.name}
          </span>
          <button
            type="button"
            onClick={() => onSkillChange(null)}
            className="rounded p-0.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-[var(--kp-text-3)]">发送时将覆盖 System Prompt</span>
        </div>
      )}

      {skillOpen && filteredSkills.length > 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] py-1 shadow-lg">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--kp-text-3)]">
            选择 Skill
            <ShortcutSlashSkill />
          </div>
          {filteredSkills.map((skill, i) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => selectSkill(skill)}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition",
                i === activeHighlightIdx ? "bg-[var(--kp-brand-soft)]" : "hover:bg-[var(--kp-bg-mute)]",
              )}
            >
              <LucideIconByName name={skill.icon} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]" />
              <div className="min-w-0">
                <div className="font-medium text-[var(--kp-text-1)]">{skill.name}</div>
                <div className="truncate text-xs text-[var(--kp-text-3)]">{skill.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              detectSkillTrigger(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) => detectSkillTrigger(value, e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (skillOpen && filteredSkills.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.min(i + 1, filteredSkills.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  selectSkill(filteredSkills[activeHighlightIdx]);
                  return;
                }
                if (e.key === "Escape") {
                  setSkillOpen(false);
                  return;
                }
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={3}
            disabled={disabled}
            placeholder={disabled ? "后端未连接" : ""}
            data-testid="chat-input"
            className="min-h-[84px] w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-3 text-sm outline-none focus:border-[var(--kp-brand)] disabled:opacity-50"
          />
          {!disabled && !value.trim() && (
            <div
              className="pointer-events-none absolute inset-0 flex items-start justify-between gap-3 px-4 py-3"
              aria-hidden={false}
            >
              <span className="text-sm text-[var(--kp-text-3)]">
                {isStreaming ? "Agent 回复中…" : "输入消息"}
              </span>
              <ChatShortcutHints isStreaming={isStreaming} className="pointer-events-auto shrink-0" />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          data-testid="chat-send"
          className={cn(buttonVariants(), "h-auto self-end px-4")}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
