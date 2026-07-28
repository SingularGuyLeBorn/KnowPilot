import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/config.js", () => ({
  getAppConfig: () => ({
    llm: { defaultModel: "test-model" },
  }),
}));

const completeSpy = vi.fn();

vi.mock("../infra/resilientLlmClient.js", () => ({
  resilientChatCompletion: (...args: unknown[]) => completeSpy(...args),
}));

import {
  __buildExplainUserPromptForTests,
  explainPostSelection,
} from "../infra/postExplain.js";

describe("postExplain", () => {
  beforeEach(() => {
    completeSpy.mockReset();
    completeSpy.mockResolvedValue({ content: "这是一段解释。" });
  });

  it("拼装 prompt 含标题、路径与划选", () => {
    const prompt = __buildExplainUserPromptForTests({
      quote: "W_t = W_0 + B_t A_t",
      title: "持续学习",
      slug: "4.7-持续学习",
      garden: "llm-guide",
      surrounding: "冻结骨干 + 适配器",
    });
    expect(prompt).toContain("持续学习");
    expect(prompt).toContain("llm-guide/4.7-持续学习");
    expect(prompt).toContain("W_t = W_0 + B_t A_t");
    expect(prompt).toContain("冻结骨干");
  });

  it("explainPostSelection 返回模型解释", async () => {
    const res = await explainPostSelection({
      quote: "经验回放",
      title: "持续学习",
      slug: "4.7",
      garden: "llm-guide",
    });
    expect(res.explanation).toBe("这是一段解释。");
    expect(res.model).toBe("test-model");
    expect(completeSpy).toHaveBeenCalledOnce();
    const args = completeSpy.mock.calls[0]![0] as {
      enableReasoning: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.enableReasoning).toBe(false);
    expect(args.messages[0]!.role).toBe("system");
    expect(args.messages[1]!.content).toContain("经验回放");
  });

  it("空划选抛 BAD_REQUEST", async () => {
    await expect(
      explainPostSelection({
        quote: "   ",
        title: "t",
        slug: "s",
        garden: "posts",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(completeSpy).not.toHaveBeenCalled();
  });
});
