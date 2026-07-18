/**
 * ChatModelMenu：选模型 / 思考强度写回 updateConfig。
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LLM_MODEL, LLM_MODEL_IDS, type ChatSessionConfig } from "@knowpilot/shared";
import { DEFAULT_CHAT_CONFIG } from "@/lib/chatConfig";

vi.mock("@/lib/hooks", () => ({
  useSessionHoverPreview: () => ({ enabled: false, setEnabled: vi.fn() }),
}));

import { ChatModelMenu } from "@/components/chatModelMenu";

describe("ChatModelMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let config: ChatSessionConfig;
  let updateConfig: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    config = { ...DEFAULT_CHAT_CONFIG, model: DEFAULT_LLM_MODEL, enableReasoning: true };
    updateConfig = vi.fn((patch: Partial<ChatSessionConfig>) => {
      config = { ...config, ...patch };
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.querySelectorAll("[data-testid='chat-model-menu']").forEach((el) => el.remove());
  });

  function renderMenu(overrides?: Partial<ChatSessionConfig>) {
    act(() => {
      root.render(
        <ChatModelMenu
          chatConfig={{ ...config, ...overrides }}
          updateConfig={updateConfig}
          resetPromptToAgent={vi.fn()}
          onOpenPromptEditor={vi.fn()}
          modelSupportsReasoning
          modelReasoningRequired={false}
        />,
      );
    });
  }

  function openMenu() {
    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='chat-model-menu-trigger']")?.click();
    });
  }

  it("选择模型写回 updateConfig", () => {
    renderMenu();
    openMenu();
    // 菜单经 portal 挂到 document.body
    expect(document.querySelector("[data-testid='chat-model-menu']")).toBeTruthy();

    const proId = LLM_MODEL_IDS.DEEPSEEK_V4_PRO;
    act(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-testid='chat-model-option-${proId}']`)
        ?.click();
    });
    expect(updateConfig).toHaveBeenCalledWith({ model: proId });
  });

  it("思考强度写回 enableReasoning / reasoningEffort", () => {
    renderMenu({ enableReasoning: true, reasoningEffort: "high" });
    openMenu();
    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='chat-model-menu-thinking']")?.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='chat-thinking-max']")?.click();
    });
    expect(updateConfig).toHaveBeenCalledWith({
      enableReasoning: true,
      reasoningEffort: "max",
    });

    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='chat-thinking-off']")?.click();
    });
    expect(updateConfig).toHaveBeenCalledWith({ enableReasoning: false });
  });
});
