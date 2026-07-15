"use client";

/**
 * ChatRightPanel —— 右栏（W13c 从 chat.tsx 拆出）。
 * 包含右栏宽度动画容器、「配置 / 状态」标签页头、ChatSettingsPanel（模型/参数/Prompt/Skill 配置）
 * 与 RuntimeStatusPanel（TP-3 三组状态模型：进行中 / 待消费（含钉住子组）/ 已消费）。
 * 纯结构拆分：面板开关与标签的 URL/localStorage 持久化 effect、runtime 三组派生数组
 * （runtimeActiveItems / runtimeToConsumeItems / runtimeConsumedItems）的 useMemo、异步任务
 * mutation 单例仍留在 chat.tsx，经 props 受控注入；INV-1~8 流式状态机不涉及本组件。
 *
 * W16b：React.memo 渲染屏障——右栏 props 不含流式派生值（tokenBudget / runtime 三组
 * 均为 useMemo 派生，token 更新不变），流式期右栏整树跳过重渲染。mutation 同
 * ChatSidebar 只注入稳定的 .mutate 函数。
 */

import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { type ChatSessionConfig, type Skill } from "@knowpilot/shared";
import { type ChatQueueItem, type SyncTaskItem } from "@/lib/chatQueueTypes";
import { ChatSettingsPanel } from "@/components/chatSettingsPanel";
import { RuntimeStatusPanel } from "@/components/chatQueue";
import { type SelectedSkill } from "@/components/chatInput";
import { type TokenBudgetSnapshot } from "@/components/tokenBudgetBar";

export interface ChatRightPanelProps {
  // 面板开关与标签受控态：URL/localStorage 持久化 effect 在 ChatView，state 不搬，受控注入
  rightOpen: boolean;
  setRightOpen: (open: boolean) => void;
  rightTab: "config" | "runtime";
  setRightTab: (tab: "config" | "runtime") => void;
  // 配置页（ChatSettingsPanel）：R17 memo 依赖的引用稳定性由 ChatView 保证
  chatConfig: ChatSessionConfig;
  updateConfig: (patch: Partial<ChatSessionConfig>) => void;
  resetPromptToAgent: () => void;
  onOpenPromptEditor: () => void;
  skills: Skill[];
  selectedSkill: SelectedSkill | null;
  setSelectedSkill: (skill: SelectedSkill | null) => void;
  modelSupportsReasoning: boolean;
  modelReasoningRequired: boolean;
  tokenBudget: TokenBudgetSnapshot;
  // 状态页（RuntimeStatusPanel）：派生数组的 useMemo 留在 ChatView，受控注入
  // W-A 一级分组：异步队列 / 同步任务
  runtimeGroupTab: "async" | "sync";
  setRuntimeGroupTab: (tab: "async" | "sync") => void;
  syncTaskItems: SyncTaskItem[];
  /** TP-3 三组：进行中（queued+running） */
  runtimeActiveItems: ChatQueueItem[];
  /** TP-3 三组：待消费（终态未 delivered，含 pinned 子组） */
  runtimeToConsumeItems: ChatQueueItem[];
  /** TP-3 三组：已消费（delivered=true） */
  runtimeConsumedItems: ChatQueueItem[];
  // 异步任务 mutate：mutation 单例留在 ChatView，仅注入稳定的 .mutate 函数（同 ChatSidebar）
  cancelAsyncJobMutate: ReturnType<typeof trpc.agent.cancelAsyncJob.useMutation>["mutate"];
  pinAsyncJobMutate: ReturnType<typeof trpc.agent.toggleAsyncJobPinned.useMutation>["mutate"];
}

export const ChatRightPanel = memo(function ChatRightPanel({
  rightOpen,
  setRightOpen,
  rightTab,
  setRightTab,
  chatConfig,
  updateConfig,
  resetPromptToAgent,
  onOpenPromptEditor,
  skills,
  selectedSkill,
  setSelectedSkill,
  modelSupportsReasoning,
  modelReasoningRequired,
  tokenBudget,
  runtimeGroupTab,
  setRuntimeGroupTab,
  syncTaskItems,
  runtimeActiveItems,
  runtimeToConsumeItems,
  runtimeConsumedItems,
  cancelAsyncJobMutate,
  pinAsyncJobMutate,
}: ChatRightPanelProps) {
  return (
    <aside
      className={cn(
        "relative z-40 flex shrink-0 flex-col overflow-x-hidden border-l border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 backdrop-blur-xl transition-[width] duration-300 ease-[var(--kp-spring-gentle)]",
        rightOpen ? "w-[360px]" : "w-0 overflow-hidden border-l-0",
      )}
    >
      <AnimatePresence mode="wait">
        {rightOpen && (
          <motion.div
            key="right-panel"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex h-full min-w-0 flex-col overflow-x-hidden"
          >
            <div className="flex items-center justify-between border-b border-[var(--kp-divider)] px-3 py-2.5">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setRightTab("config")}
                  data-testid="right-tab-config"
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                    rightTab === "config"
                      ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                      : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
                  )}
                >
                  配置
                </button>
                <button
                  type="button"
                  onClick={() => setRightTab("runtime")}
                  data-testid="right-tab-runtime"
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                    rightTab === "runtime"
                      ? "bg-[var(--kp-bg)] text-[var(--kp-text-1)] shadow-sm"
                      : "text-[var(--kp-text-3)] hover:text-[var(--kp-text-2)]",
                  )}
                >
                  状态
                  {runtimeActiveItems.length > 0 && (
                    <span className="ml-1 inline-flex min-w-[1rem] justify-center rounded-full bg-[var(--kp-brand-soft)] px-1 text-[9px] font-semibold text-[var(--kp-brand-deep)]">
                      {runtimeActiveItems.length}
                    </span>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRightOpen(false)}
                className="text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
                title="收起面板"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {rightTab === "config" ? (
                <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                  <ChatSettingsPanel
                    chatConfig={chatConfig}
                    updateConfig={updateConfig}
                    resetPromptToAgent={resetPromptToAgent}
                    onOpenPromptEditor={onOpenPromptEditor}
                    skills={skills}
                    selectedSkill={selectedSkill}
                    onSelectSkill={setSelectedSkill}
                    modelSupportsReasoning={modelSupportsReasoning}
                    modelReasoningRequired={modelReasoningRequired}
                    tokenBudget={tokenBudget}
                  />
                </div>
              ) : (
                <RuntimeStatusPanel
                  groupTab={runtimeGroupTab}
                  onGroupTabChange={setRuntimeGroupTab}
                  activeItems={runtimeActiveItems}
                  toConsumeItems={runtimeToConsumeItems}
                  consumedItems={runtimeConsumedItems}
                  syncTaskItems={syncTaskItems}
                  onCancel={(jobId) => cancelAsyncJobMutate({ jobId })}
                  onTogglePin={(jobId, pinned) => pinAsyncJobMutate({ jobId, pinned })}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
});
