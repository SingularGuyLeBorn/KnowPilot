"use client";

/**
 * 输入区模型菜单（Kimi 风格）：模型列表 + 思考强度 / 更多参数 / 系统提示 二级页。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import {
  PRIMARY_CHAT_MODELS,
  type ChatSessionConfig,
  type ReasoningEffort,
} from "@knowpilot/shared";
import { cn } from "@/lib/utils";
import { useSessionHoverPreview } from "@/lib/hooks";

type MenuPanel = "root" | "thinking" | "params" | "prompt";

const EFFORT_OPTIONS: { id: ReasoningEffort | "off"; label: string; hint?: string }[] = [
  { id: "off", label: "关闭" },
  { id: "high", label: "标准" },
  { id: "max", label: "极致", hint: "消耗更多算力" },
];

export interface ChatModelMenuProps {
  chatConfig: ChatSessionConfig;
  updateConfig: (patch: Partial<ChatSessionConfig>) => void;
  resetPromptToAgent: () => void;
  onOpenPromptEditor: () => void;
  modelSupportsReasoning: boolean;
  modelReasoningRequired: boolean;
}

export function ChatModelMenu({
  chatConfig,
  updateConfig,
  resetPromptToAgent,
  onOpenPromptEditor,
  modelSupportsReasoning,
  modelReasoningRequired,
}: ChatModelMenuProps) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<MenuPanel>("root");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const { enabled: hoverPreview, setEnabled: setHoverPreview } = useSessionHoverPreview();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const width = 280;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      // 锚定在 trigger 上方；具体高度由 transform 拉起
      setMenuPos({ top: rect.top - 8, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, panel]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setPanel("root");
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  const modelLabel =
    PRIMARY_CHAT_MODELS.find((m) => m.id === chatConfig.model)?.label.replace(/^DeepSeek /, "") ??
    chatConfig.model;
  const thinkingOn = modelReasoningRequired || chatConfig.enableReasoning;
  const thinkingSupported = modelSupportsReasoning || modelReasoningRequired;
  const effortLabel = !thinkingOn
    ? ""
    : chatConfig.reasoningEffort === "max"
      ? "极致"
      : "标准";
  const triggerLabel = effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel;

  const menu = open && menuPos && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          data-testid="chat-model-menu"
          className="fixed z-[200] w-[280px] -translate-y-full overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
          role="menu"
        >
          {panel === "root" && (
            <div className="py-1">
              <p className="px-3 py-1.5 text-[10px] font-medium text-[var(--kp-text-3)]">选择模型</p>
              {PRIMARY_CHAT_MODELS.map((m) => {
                const active = chatConfig.model === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    data-testid={`chat-model-option-${m.id}`}
                    onClick={() => {
                      updateConfig(
                        m.reasoningRequired
                          ? { model: m.id, enableReasoning: true }
                          : { model: m.id },
                      );
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-[var(--kp-bg-mute)]",
                      active && "bg-[var(--kp-brand-soft)]/40",
                    )}
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {active && <Check className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-[var(--kp-text-1)]">
                        {m.label.replace(/^DeepSeek /, "")}
                      </span>
                      {m.inputHint && (
                        <span className="mt-0.5 block text-[10px] leading-snug text-[var(--kp-text-3)]">
                          {m.inputHint.slice(0, 48)}
                          {m.inputHint.length > 48 ? "…" : ""}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              <div className="my-1 border-t border-[var(--kp-divider-light)]" />
              {thinkingSupported && (
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                  onClick={() => setPanel("thinking")}
                  data-testid="chat-model-menu-thinking"
                >
                  <span>思考强度</span>
                  <span className="flex items-center gap-1 text-[var(--kp-text-3)]">
                    {thinkingOn ? effortLabel || "标准" : "关闭"}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                onClick={() => setPanel("params")}
                data-testid="chat-model-menu-params"
              >
                <span>更多参数</span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--kp-text-3)]" />
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                onClick={() => setPanel("prompt")}
                data-testid="chat-model-menu-prompt"
              >
                <span>系统提示</span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--kp-text-3)]" />
              </button>
              <div className="my-1 border-t border-[var(--kp-divider-light)]" />
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                onClick={() => setHoverPreview(!hoverPreview)}
                data-testid="chat-model-menu-hover-preview"
              >
                <span>会话 hover 预览</span>
                <span className="text-[var(--kp-text-3)]">{hoverPreview ? "开" : "关"}</span>
              </button>
            </div>
          )}

          {panel === "thinking" && (
            <div className="py-1">
              <button
                type="button"
                className="flex w-full items-center gap-1 px-3 py-2 text-xs font-medium text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                onClick={() => setPanel("root")}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                思考强度
              </button>
              {EFFORT_OPTIONS.map((opt) => {
                const selected =
                  opt.id === "off"
                    ? !thinkingOn && !modelReasoningRequired
                    : thinkingOn &&
                      (opt.id === "max"
                        ? chatConfig.reasoningEffort === "max"
                        : chatConfig.reasoningEffort !== "max");
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={opt.id === "off" && modelReasoningRequired}
                    data-testid={`chat-thinking-${opt.id}`}
                    onClick={() => {
                      if (opt.id === "off") {
                        if (!modelReasoningRequired) updateConfig({ enableReasoning: false });
                        return;
                      }
                      updateConfig({
                        enableReasoning: true,
                        reasoningEffort: opt.id,
                      });
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--kp-bg-mute)] disabled:opacity-40",
                      selected && "bg-[var(--kp-brand-soft)]/40",
                    )}
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {selected && <Check className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />}
                    </span>
                    <span>
                      <span className="font-medium text-[var(--kp-text-1)]">{opt.label}</span>
                      {opt.hint && (
                        <span className="mt-0.5 block text-[10px] text-[var(--kp-text-3)]">
                          {opt.hint}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {panel === "params" && (
            <div className="space-y-3 px-3 py-2">
              <button
                type="button"
                className="flex w-full items-center gap-1 text-xs font-medium text-[var(--kp-text-2)]"
                onClick={() => setPanel("root")}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                更多参数
              </button>
              <ParamSlider
                label="温度"
                value={chatConfig.temperature}
                min={0}
                max={2}
                step={0.1}
                display={chatConfig.temperature.toFixed(1)}
                onChange={(v) => updateConfig({ temperature: v })}
              />
              <ParamSlider
                label="最大 Token"
                value={chatConfig.maxTokens}
                min={256}
                max={8192}
                step={256}
                display={String(chatConfig.maxTokens)}
                onChange={(v) => updateConfig({ maxTokens: v })}
              />
              <ParamSlider
                label="单工具超时"
                value={chatConfig.toolCallTimeoutMs ?? 0}
                min={0}
                max={180000}
                step={5000}
                display={
                  (chatConfig.toolCallTimeoutMs ?? 0) === 0
                    ? "默认"
                    : `${Math.round((chatConfig.toolCallTimeoutMs ?? 0) / 1000)}s`
                }
                onChange={(v) => updateConfig({ toolCallTimeoutMs: v })}
              />
              <ParamSlider
                label="最大工具轮数"
                value={chatConfig.maxToolRounds ?? 0}
                min={0}
                max={30}
                step={1}
                display={(chatConfig.maxToolRounds ?? 0) === 0 ? "默认" : String(chatConfig.maxToolRounds)}
                onChange={(v) => updateConfig({ maxToolRounds: v })}
              />
              <p className="pb-1 text-[10px] leading-snug text-[var(--kp-text-3)]">
                超时/轮数设为 0 时使用服务端默认。
              </p>
            </div>
          )}

          {panel === "prompt" && (
            <div className="space-y-2 px-3 py-2">
              <button
                type="button"
                className="flex w-full items-center gap-1 text-xs font-medium text-[var(--kp-text-2)]"
                onClick={() => setPanel("root")}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                系统提示
              </button>
              <p className="max-h-24 overflow-y-auto rounded-lg bg-[var(--kp-bg-soft)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--kp-text-3)]">
                {chatConfig.systemPrompt?.trim() || "（使用 Agent 默认提示）"}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg bg-[var(--kp-brand)] px-2 py-1.5 text-xs font-medium text-white"
                  onClick={() => {
                    setOpen(false);
                    onOpenPromptEditor();
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-lg border border-[var(--kp-divider)] px-2 py-1.5 text-xs text-[var(--kp-text-2)]"
                  onClick={resetPromptToAgent}
                >
                  重置
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="chat-model-menu-trigger"
        onClick={() => {
          setOpen((v) => !v);
          setPanel("root");
        }}
        className="inline-flex max-w-[200px] items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)]"
        title="模型与对话设置"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {menu}
    </>
  );
}

function ParamSlider({
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
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-[var(--kp-text-2)]">{label}</span>
        <span className="tabular-nums text-[var(--kp-brand-deep)]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--kp-brand)]"
        aria-label={label}
      />
    </div>
  );
}
