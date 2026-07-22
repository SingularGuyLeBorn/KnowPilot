"use client";

/**
 * 输入区模型菜单（Kimi 风格）：主菜单固定，hover 横向飞出子菜单。
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ChevronRight, ChevronDown, Sparkles } from "lucide-react";
import {
  PRIMARY_CHAT_MODELS,
  type ChatSessionConfig,
  type ReasoningEffort,
} from "@knowpilot/shared";
import { cn } from "@/lib/utils";
import { useSessionHoverPreview } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";

type FlyoutKey = "free" | "thinking" | "params";

const FREE_PICK_LIMIT = 8;
const MAIN_WIDTH = 280;
/** 最大飞出宽（免费模型），用于判定左右方向，避免切换子菜单时主菜单跳动 */
const MAX_FLYOUT_WIDTH = 300;
/** 飞出与主菜单之间的间隙（留缝不重叠，避免盖住行内当前值；鼠标过缝靠 HOVER_CLOSE_MS 宽限） */
const FLYOUT_GAP = 6;
/** 主菜单底边压进触发按钮的像素，消灭触发器↔菜单竖缝 */
const TRIGGER_OVERLAP = 6;
const HOVER_CLOSE_MS = 400;

function flyoutWidth(key: FlyoutKey): number {
  if (key === "free") return 300;
  if (key === "params") return 260;
  return 200;
}

function shortModelLabel(modelId: string): string {
  const primary = PRIMARY_CHAT_MODELS.find((m) => m.id === modelId);
  if (primary) return primary.label.replace(/^DeepSeek /, "");
  if (modelId.endsWith(":free")) {
    const base = modelId.replace(/:free$/i, "");
    const leaf = base.includes("/") ? base.split("/").pop()! : base;
    return `${leaf} · free`;
  }
  if (modelId.includes("/")) {
    return modelId.split("/").pop() ?? modelId;
  }
  return modelId;
}

const EFFORT_OPTIONS: { id: ReasoningEffort | "off"; label: string; hint?: string }[] = [
  { id: "off", label: "关闭" },
  { id: "high", label: "标准" },
  { id: "max", label: "极致", hint: "消耗更多算力" },
];

export interface ChatModelMenuProps {
  chatConfig: ChatSessionConfig;
  updateConfig: (patch: Partial<ChatSessionConfig>) => void;
  modelSupportsReasoning: boolean;
  modelReasoningRequired: boolean;
}

export function ChatModelMenu({
  chatConfig,
  updateConfig,
  modelSupportsReasoning,
  modelReasoningRequired,
}: ChatModelMenuProps) {
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState<FlyoutKey | null>(null);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const [flyoutMaxH, setFlyoutMaxH] = useState<number | undefined>(undefined);
  const [freeQ, setFreeQ] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mainPanelRef = useRef<HTMLDivElement>(null);
  const flyoutPanelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    flyoutLeft: boolean;
  } | null>(null);
  const { enabled: hoverPreview, setEnabled: setHoverPreview } = useSessionHoverPreview();

  const freeEnabled = open && flyout === "free";
  const freeModelsQuery = trpc.llm.listFreeModels.useQuery(
    { q: freeQ.trim() || undefined, modality: "text", sort: "context_desc" },
    { enabled: freeEnabled, staleTime: 60_000 },
  );
  const freellmQuery = trpc.llm.listFreellmChannels.useQuery(undefined, {
    enabled: freeEnabled,
    staleTime: 60_000,
  });

  const freePicks = useMemo(() => {
    const items = freeModelsQuery.data?.items ?? [];
    return items.slice(0, FREE_PICK_LIMIT);
  }, [freeModelsQuery.data?.items]);

  const freellmRuntimeModel = freellmQuery.data?.runtimeModel?.trim() || null;

  const clearCloseTimer = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openFlyout = (key: FlyoutKey, rowEl?: HTMLElement | null) => {
    clearCloseTimer();
    const el =
      rowEl && typeof (rowEl as HTMLElement).getBoundingClientRect === "function"
        ? rowEl
        : null;
    if (el && mainPanelRef.current) {
      const mainRect = mainPanelRef.current.getBoundingClientRect();
      const rowRect = el.getBoundingClientRect();
      // 先按触发行对齐；真正防溢出在下方 layout effect 里钳视口
      setFlyoutTop(Math.max(0, rowRect.top - mainRect.top));
    } else {
      setFlyoutTop(0);
    }
    setFlyoutMaxH(undefined);
    setFlyout(key);
  };

  // 飞出后按视口钳制：先上移，仍不够则限制 maxHeight 内部滚动
  useLayoutEffect(() => {
    if (!flyout || !flyoutPanelRef.current) {
      setFlyoutMaxH(undefined);
      return;
    }
    const el = flyoutPanelRef.current;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const overflowBottom = rect.bottom - (window.innerHeight - pad);
    if (overflowBottom > 1) {
      const nextTop = Math.max(0, flyoutTop - overflowBottom);
      if (nextTop !== flyoutTop) {
        setFlyoutTop(nextTop);
        return;
      }
    }
    const top = el.getBoundingClientRect().top;
    const maxH = Math.max(140, window.innerHeight - pad - top);
    if (flyoutMaxH !== maxH) setFlyoutMaxH(maxH);
  }, [flyout, flyoutTop, flyoutMaxH, freePicks.length, freellmRuntimeModel, freeQ]);

  const scheduleCloseFlyout = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setFlyout(null);
      setFreeQ("");
      closeTimerRef.current = null;
    }, HOVER_CLOSE_MS);
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      // 主菜单位置只跟 trigger 锚定，不随 flyout 宽变化——否则一开子菜单整块位移，鼠标落空立刻关
      const left = Math.max(8, Math.min(rect.right - MAIN_WIDTH, window.innerWidth - MAIN_WIDTH - 8));
      const spaceRight = window.innerWidth - (left + MAIN_WIDTH) - FLYOUT_GAP;
      const flyoutLeft = spaceRight < MAX_FLYOUT_WIDTH + 8;
      // -translate-y-full 时 top = 菜单底边；+TRIGGER_OVERLAP 压进触发按钮
      setMenuPos({ top: rect.top + TRIGGER_OVERLAP, left, flyoutLeft });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setFlyout(null);
      setFreeQ("");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setFlyout(null);
        setFreeQ("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => clearCloseTimer(), []);

  const modelLabel = shortModelLabel(chatConfig.model);
  const thinkingOn = modelReasoningRequired || chatConfig.enableReasoning;
  const thinkingSupported = modelSupportsReasoning || modelReasoningRequired;
  const effortLabel = !thinkingOn
    ? ""
    : chatConfig.reasoningEffort === "max"
      ? "极致"
      : "标准";
  const triggerLabel = effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel;

  const pickFreeModel = (modelId: string) => {
    updateConfig({ model: modelId, enableReasoning: false });
    setOpen(false);
    setFlyout(null);
    setFreeQ("");
  };

  const closeAll = () => {
    setOpen(false);
    setFlyout(null);
    setFreeQ("");
  };

  const activeFlyoutW = flyout ? flyoutWidth(flyout) : 0;
  const shellExtra = flyout ? activeFlyoutW + FLYOUT_GAP : 0;
  const shellLeft =
    menuPos && menuPos.flyoutLeft && flyout ? menuPos.left - shellExtra : (menuPos?.left ?? 0);
  const shellWidth = MAIN_WIDTH + shellExtra;

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            data-testid="chat-model-menu"
            className="fixed z-[400] -translate-y-full"
            style={{ top: menuPos.top, left: shellLeft, width: shellWidth }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleCloseFlyout}
          >
            <div className="relative w-full">
            {/* 主菜单：飞出向左时用 margin 把主面板推回原锚点 */}
            <div
              ref={mainPanelRef}
              className="relative z-10 w-[280px] overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] shadow-lg shadow-black/8"
              style={
                menuPos.flyoutLeft && flyout ? { marginLeft: shellExtra } : undefined
              }
            >
              <div className="py-1">
                <p className="px-3 py-1.5 text-[10px] font-medium text-[var(--kp-text-3)]">
                  选择模型
                </p>
                {PRIMARY_CHAT_MODELS.map((m) => {
                  const active = chatConfig.model === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      data-testid={`chat-model-option-${m.id}`}
                      onMouseEnter={scheduleCloseFlyout}
                      onClick={() => {
                        updateConfig(
                          m.reasoningRequired
                            ? { model: m.id, enableReasoning: true }
                            : { model: m.id },
                        );
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--kp-bg-mute)]",
                        active && "bg-[var(--kp-brand-soft)]/35",
                      )}
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                        {active && (
                          <Check className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
                        )}
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

                <FlyoutRow
                  testId="chat-model-menu-free"
                  active={flyout === "free"}
                  onEnter={(el) => openFlyout("free", el)}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
                      免费模型
                    </span>
                  }
                />

                {thinkingSupported && (
                  <FlyoutRow
                    testId="chat-model-menu-thinking"
                    active={flyout === "thinking"}
                    onEnter={(el) => openFlyout("thinking", el)}
                    label="思考强度"
                    value={thinkingOn ? effortLabel || "标准" : "关闭"}
                  />
                )}

                <FlyoutRow
                  testId="chat-model-menu-params"
                  active={flyout === "params"}
                  onEnter={(el) => openFlyout("params", el)}
                  label="更多参数"
                />

                <div className="my-1 border-t border-[var(--kp-divider-light)]" />
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-xs text-[var(--kp-text-2)] transition-colors duration-150 hover:bg-[var(--kp-bg-mute)]"
                  onMouseEnter={scheduleCloseFlyout}
                  onClick={() => setHoverPreview(!hoverPreview)}
                  data-testid="chat-model-menu-hover-preview"
                >
                  <span>会话 hover 预览</span>
                  <span className="text-[var(--kp-text-3)]">{hoverPreview ? "开" : "关"}</span>
                </button>
              </div>
            </div>

            {/* 飞出：与主菜单留 FLYOUT_GAP 间隙；top 钳视口，maxHeight 防底边溢出 */}
            {flyout && (
            <div
              ref={flyoutPanelRef}
              className="absolute z-20 overflow-y-auto overscroll-contain rounded-xl"
              style={{
                top: flyoutTop,
                left: menuPos.flyoutLeft ? 0 : MAIN_WIDTH + FLYOUT_GAP,
                maxHeight: flyoutMaxH,
              }}
              onMouseEnter={clearCloseTimer}
            >
              {flyout === "thinking" && (
                <FlyoutCard testId="chat-model-menu-thinking-panel" width={200}>
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
                          "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors duration-150 hover:bg-[var(--kp-bg-mute)] disabled:opacity-40",
                          selected && "bg-[var(--kp-brand-soft)]/35",
                        )}
                      >
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                          {selected && (
                            <Check className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
                          )}
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
                </FlyoutCard>
              )}

              {flyout === "free" && (
                <FlyoutCard testId="chat-model-menu-free-panel" width={300}>
                  <div className="px-3 pb-2 pt-2">
                    <input
                      type="search"
                      value={freeQ}
                      onChange={(e) => setFreeQ(e.target.value)}
                      placeholder="搜索 OpenRouter :free…"
                      data-testid="chat-free-model-search"
                      className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-2 py-1.5 text-xs text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
                    />
                  </div>
                  {freellmRuntimeModel && (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={chatConfig.model === freellmRuntimeModel}
                      data-testid="chat-free-model-freellm-runtime"
                      onClick={() => pickFreeModel(freellmRuntimeModel)}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--kp-bg-mute)]",
                        chatConfig.model === freellmRuntimeModel && "bg-[var(--kp-brand-soft)]/35",
                      )}
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                        {chatConfig.model === freellmRuntimeModel && (
                          <Check className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-[var(--kp-text-1)]">
                          freellm 当前网关
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--kp-text-3)]">
                          {freellmRuntimeModel}
                        </span>
                      </span>
                    </button>
                  )}
                  {freeModelsQuery.isLoading && (
                    <p className="px-3 py-2 text-[10px] text-[var(--kp-text-3)]">加载免费目录…</p>
                  )}
                  {!freeModelsQuery.isLoading && freePicks.length === 0 && (
                    <p className="px-3 py-2 text-[10px] leading-relaxed text-[var(--kp-text-3)]">
                      暂无 :free 目录。请配置 OPENROUTER_API_KEY 并同步。
                    </p>
                  )}
                  <div className="min-h-0">
                    {freePicks.map((m) => {
                      const active = chatConfig.model === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          data-testid={`chat-free-model-option-${m.id}`}
                          onClick={() => pickFreeModel(m.id)}
                          className={cn(
                            "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--kp-bg-mute)]",
                            active && "bg-[var(--kp-brand-soft)]/35",
                          )}
                        >
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                            {active && (
                              <Check className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-[var(--kp-text-1)]">
                              {m.name || shortModelLabel(m.id)}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--kp-text-3)]">
                              {m.id}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="my-1 border-t border-[var(--kp-divider-light)]" />
                  <Link
                    href="/free-models"
                    data-testid="chat-free-model-browse-all"
                    className="flex w-full items-center justify-between px-3 py-2 text-xs text-[var(--kp-brand-deep)] transition-colors duration-150 hover:bg-[var(--kp-bg-mute)]"
                    onClick={closeAll}
                  >
                    <span>浏览全部免费模型</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </FlyoutCard>
              )}

              {flyout === "params" && (
                <FlyoutCard testId="chat-model-menu-params-panel" width={260}>
                  <div className="space-y-3 px-3 py-2.5">
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
                      display={
                        (chatConfig.maxToolRounds ?? 0) === 0
                          ? "默认"
                          : String(chatConfig.maxToolRounds)
                      }
                      onChange={(v) => updateConfig({ maxToolRounds: v })}
                    />
                    <p className="pb-0.5 text-[10px] leading-snug text-[var(--kp-text-3)]">
                      超时/轮数设为 0 时使用服务端默认。
                    </p>
                  </div>
                </FlyoutCard>
              )}
            </div>
            )}
            </div>
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
          setFlyout(null);
          setFreeQ("");
        }}
        className="inline-flex max-w-[200px] items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)]"
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

function FlyoutRow({
  testId,
  active,
  onEnter,
  label,
  value,
}: {
  testId: string;
  active: boolean;
  onEnter: (el: HTMLElement) => void;
  label: ReactNode;
  value?: string;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const fire = () => {
    if (rowRef.current) onEnter(rowRef.current);
  };
  return (
    <button
      ref={rowRef}
      type="button"
      data-testid={testId}
      onMouseEnter={fire}
      onFocus={fire}
      onClick={fire}
      className={cn(
        "flex w-full items-center justify-between px-3 py-2 text-xs text-[var(--kp-text-2)] transition-colors duration-150",
        active ? "bg-[var(--kp-bg-mute)]" : "hover:bg-[var(--kp-bg-mute)]",
      )}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1 text-[var(--kp-text-3)]">
        {value}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function FlyoutCard({
  testId,
  width,
  children,
}: {
  testId: string;
  width: number;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="overflow-hidden rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1 shadow-lg shadow-black/8"
      style={{ width }}
    >
      {children}
    </div>
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
