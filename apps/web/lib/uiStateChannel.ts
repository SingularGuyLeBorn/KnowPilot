/**
 * 跨标签 UI 状态通道（推拉结合 · 浏览器侧 PUSH 兜底）
 * 主路径仍是服务端 SSE；本通道让无 SSE 的管理页（/cron 等）在同浏览器其它标签收到事件后立刻拉。
 */
export const UI_STATE_CHANNEL = "knowpilot-ui-state";

export type UiStateChannelMessage = {
  type:
    | "cron_session_started"
    | "cron_job_updated"
    | "approval_updated"
    | "session_list_changed"
    | "agent_list_changed"
    | "run_updated"
    | "task_updated"
    | "goal_updated";
  [key: string]: unknown;
};

export function postUiState(msg: UiStateChannelMessage): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const bc = new BroadcastChannel(UI_STATE_CHANNEL);
    bc.postMessage(msg);
    bc.close();
  } catch {
    /* Safari 旧版等 */
  }
}

/** 会话列表变化提示：统一走 UI_STATE_CHANNEL 单频道（旧 knowpilot-session-list 频道已无消费者，已删） */
export function postSessionListHint(sessionId?: string): void {
  postUiState({ type: "cron_session_started", sessionId });
}
