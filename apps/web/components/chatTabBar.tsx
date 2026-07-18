"use client";

/**
 * Chat 标签栏 —— 圆角矩形 tabs（非 VS Code 直角连排）+ 分屏控制。
 */

import { Columns2, PanelLeftClose, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatTabsLayout, ChatTabsState } from "@/lib/chatTabsState";

export interface ChatTabBarItem {
  id: string;
  title: string;
}

export interface ChatTabBarProps {
  tabs: ChatTabsState;
  items: ChatTabBarItem[];
  onFocusTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onEnterSplit: () => void;
  onExitSplit: () => void;
  canEnterSplit: boolean;
  /** 悬停/按下标签时预热消息缓存 */
  onPrefetchTab?: (sessionId: string) => void;
}

export function ChatTabBar({
  tabs,
  items,
  onFocusTab,
  onCloseTab,
  onEnterSplit,
  onExitSplit,
  canEnterSplit,
  onPrefetchTab,
}: ChatTabBarProps) {
  const focusedId =
    tabs.focusedPane === "secondary" ? tabs.secondarySessionId : tabs.primarySessionId;
  const visibleSecondary = tabs.layout === "split" ? tabs.secondarySessionId : null;

  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = tabs.openTabIds
    .map((id) => byId.get(id) ?? { id, title: "新对话" })
    .filter(Boolean);

  return (
    <div
      className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--kp-divider-light)] bg-[var(--kp-bg)] px-2.5"
      data-testid="chat-tab-bar"
    >
      <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5 overflow-x-auto py-1.5">
        {ordered.length === 0 ? (
          <div className="rounded-xl bg-[var(--kp-bg-mute)] px-3 py-1.5 text-[11px] text-[var(--kp-text-3)]">
            新对话
          </div>
        ) : (
          ordered.map((item) => {
            const isFocused = item.id === focusedId;
            const isVisibleOther =
              item.id === visibleSecondary ||
              (tabs.layout === "split" && item.id === tabs.primarySessionId && !isFocused);
            return (
              <div
                key={item.id}
                className={cn(
                  "group flex max-w-[200px] shrink-0 items-center gap-0.5 rounded-xl border px-1.5 text-[12px] transition-colors",
                  isFocused
                    ? "border-[var(--kp-brand-deep)] bg-[var(--kp-brand-deep)] font-semibold text-white shadow-sm"
                    : isVisibleOther
                      ? "border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] text-[var(--kp-text-2)]"
                      : "border-transparent bg-transparent text-[var(--kp-text-3)] hover:border-[var(--kp-divider)] hover:bg-[var(--kp-bg-mute)]/70",
                )}
                data-testid="chat-tab"
                data-session-id={item.id}
                data-focused={isFocused ? "true" : "false"}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate px-1.5 py-1.5 text-left"
                  onClick={() => onFocusTab(item.id)}
                  onMouseEnter={() => onPrefetchTab?.(item.id)}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      onCloseTab(item.id);
                    } else if (e.button === 0) {
                      // mousedown 比 click 更早发起预取，缩短切 tab 空白窗
                      onPrefetchTab?.(item.id);
                    }
                  }}
                  title={item.title}
                >
                  {item.title}
                </button>
                <button
                  type="button"
                  className={cn(
                    "shrink-0 rounded-lg p-1 transition",
                    "opacity-0 group-hover:opacity-100",
                    isFocused
                      ? "text-white/80 hover:bg-white/15 hover:text-white opacity-80"
                      : "text-[var(--kp-text-3)] hover:bg-[var(--kp-bg)] hover:text-[var(--kp-text-1)]",
                  )}
                  aria-label={`关闭 ${item.title}`}
                  data-testid="chat-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(item.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {tabs.layout === "split" ? (
          <button
            type="button"
            className="rounded-xl p-1.5 text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)]"
            title="取消分屏"
            aria-label="取消分屏"
            data-testid="chat-exit-split"
            onClick={onExitSplit}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "rounded-xl p-1.5 text-[var(--kp-text-2)] transition hover:bg-[var(--kp-bg-mute)]",
              !canEnterSplit && "cursor-not-allowed opacity-40",
            )}
            title={canEnterSplit ? "分屏显示" : "至少打开两个会话才能分屏"}
            aria-label="分屏显示"
            data-testid="chat-enter-split"
            disabled={!canEnterSplit}
            onClick={onEnterSplit}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export type { ChatTabsLayout };
