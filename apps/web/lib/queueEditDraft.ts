/**
 * Cursor 式「编辑队列项」草稿不变量：
 * - 首次进入编辑：备份当前输入框草稿
 * - 编辑中切换到另一条队列：不覆盖备份
 * - 提交 / 取消：把备份还回输入框（abcde 不丢）
 */

export function stashDraftOnEnterQueueEdit(opts: {
  alreadyEditingId: string | null;
  currentBackup: string | null;
  currentInput: string;
}): string {
  if (opts.alreadyEditingId !== null && opts.currentBackup !== null) {
    return opts.currentBackup;
  }
  return opts.currentInput;
}

export function restoreDraftAfterQueueEdit(backup: string | null): string {
  return backup ?? "";
}
