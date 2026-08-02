import { describe, it, expect } from "vitest";
import { DEFAULT_CHAT_CONFIG, resolveNewChatConfig } from "../chatConfig";

describe("chatConfig.resolveNewChatConfig", () => {
  it("无 Agent 时返回 base", () => {
    const cfg = resolveNewChatConfig({ ...DEFAULT_CHAT_CONFIG });
    expect(cfg.agentId).toBeUndefined();
    expect(cfg.agentSystemPrompt).toBeUndefined();
  });

  it("有 Agent 时写入 model/systemPrompt/agentId/agentSystemPrompt", () => {
    const cfg = resolveNewChatConfig({ ...DEFAULT_CHAT_CONFIG }, {
      id: "agent-1",
      model: "deepseek-v4",
      systemPrompt: "you are a gardener",
    });
    expect(cfg.model).toBe("deepseek-v4");
    expect(cfg.systemPrompt).toBe("you are a gardener");
    expect(cfg.agentId).toBe("agent-1");
    expect(cfg.agentSystemPrompt).toBe("you are a gardener");
    expect(cfg.customSystemPrompt).toBe(false);
  });

  it("用户已自定义 prompt 时仍记录 Agent 归属", () => {
    const cfg = resolveNewChatConfig(
      { ...DEFAULT_CHAT_CONFIG, systemPrompt: "custom", customSystemPrompt: true },
      { id: "agent-2", model: "gpt-4", systemPrompt: "default" },
    );
    expect(cfg.systemPrompt).toBe("custom");
    expect(cfg.customSystemPrompt).toBe(true);
    expect(cfg.agentId).toBe("agent-2");
    expect(cfg.agentSystemPrompt).toBe("default");
  });
});
