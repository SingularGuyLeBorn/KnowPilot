import { describe, expect, it } from "vitest";
import { restoreDraftAfterQueueEdit, stashDraftOnEnterQueueEdit } from "../queueEditDraft";

describe("queueEditDraft", () => {
  it("首次进入编辑时备份当前输入框草稿", () => {
    expect(
      stashDraftOnEnterQueueEdit({
        alreadyEditingId: null,
        currentBackup: null,
        currentInput: "abcde",
      }),
    ).toBe("abcde");
  });

  it("编辑中切换另一条队列项时不覆盖备份", () => {
    expect(
      stashDraftOnEnterQueueEdit({
        alreadyEditingId: "q1",
        currentBackup: "abcde",
        currentInput: "正在改队列内容",
      }),
    ).toBe("abcde");
  });

  it("提交/取消后还原备份；无备份则空串", () => {
    expect(restoreDraftAfterQueueEdit("abcde")).toBe("abcde");
    expect(restoreDraftAfterQueueEdit("")).toBe("");
    expect(restoreDraftAfterQueueEdit(null)).toBe("");
  });
});
