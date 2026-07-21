/**
 * ChatModelMenu：选模型 / hover 飞出子菜单 / 思考强度写回。
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LLM_MODEL, LLM_MODEL_IDS, type ChatSessionConfig } from "@knowpilot/shared";
import { DEFAULT_CHAT_CONFIG } from "@/lib/chatConfig";

const freeFixtures = vi.hoisted(() => ({
  openRouterItems: [
    {
      id: "deepseek/deepseek-r1:free",
      name: "DeepSeek R1 (free)",
      contextLength: 163840,
      modality: "text",
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct:free",
      name: "Llama 3.3 70B (free)",
      contextLength: 131072,
      modality: "text",
    },
  ],
  runtimeModel: "openrouter/free-gateway-model",
}));

vi.mock("@/lib/hooks", () => ({
  useSessionHoverPreview: () => ({ enabled: false, setEnabled: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    llm: {
      listFreeModels: {
        useQuery: () => ({
          data: {
            items: freeFixtures.openRouterItems,
            total: freeFixtures.openRouterItems.length,
            hasApiKey: true,
            syncedAt: new Date().toISOString(),
          },
          isLoading: false,
        }),
      },
      listFreellmChannels: {
        useQuery: () => ({
          data: {
            runtimeModel: freeFixtures.runtimeModel,
            runtimeBaseUrl: "https://example.invalid",
            total: 1,
            items: [],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

import { ChatModelMenu } from "@/components/chatModelMenu";

function openFlyout(el: Element | null) {
  // jsdom 下 React 对 mouseenter 委托不可靠；与触控一致走 click 打开飞出
  act(() => {
    (el as HTMLButtonElement | null)?.click();
  });
}

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
    expect(document.querySelector("[data-testid='chat-model-menu']")).toBeTruthy();
    expect(document.querySelector("[data-testid='chat-model-menu-prompt']")).toBeNull();

    const proId = LLM_MODEL_IDS.DEEPSEEK_V4_PRO;
    act(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-testid='chat-model-option-${proId}']`)
        ?.click();
    });
    expect(updateConfig).toHaveBeenCalledWith({ model: proId });
  });

  it("飞出思考强度子菜单并写回", () => {
    renderMenu({ enableReasoning: true, reasoningEffort: "high" });
    openMenu();
    openFlyout(document.querySelector("[data-testid='chat-model-menu-thinking']"));
    expect(document.querySelector("[data-testid='chat-model-menu-thinking-panel']")).toBeTruthy();
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

  it("飞出后 document click 不误关；mousedown 外部才关", () => {
    renderMenu();
    openMenu();
    openFlyout(document.querySelector("[data-testid='chat-model-menu-thinking']"));
    expect(document.querySelector("[data-testid='chat-model-menu-thinking-panel']")).toBeTruthy();

    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-testid='chat-model-menu']")).toBeTruthy();
    expect(document.querySelector("[data-testid='chat-model-menu-thinking-panel']")).toBeTruthy();

    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector("[data-testid='chat-model-menu']")).toBeNull();
  });

  it("飞出免费模型可选 OpenRouter :free 并关闭思考", () => {
    renderMenu();
    openMenu();
    openFlyout(document.querySelector("[data-testid='chat-model-menu-free']"));
    expect(document.querySelector("[data-testid='chat-model-menu-free-panel']")).toBeTruthy();

    const freeId = freeFixtures.openRouterItems[0]!.id;
    act(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-testid='chat-free-model-option-${freeId}']`)
        ?.click();
    });
    expect(updateConfig).toHaveBeenCalledWith({ model: freeId, enableReasoning: false });
  });

  it("飞出免费模型可选 freellm 当前网关模型", () => {
    renderMenu();
    openMenu();
    openFlyout(document.querySelector("[data-testid='chat-model-menu-free']"));
    act(() => {
      document
        .querySelector<HTMLButtonElement>("[data-testid='chat-free-model-freellm-runtime']")
        ?.click();
    });
    expect(updateConfig).toHaveBeenCalledWith({
      model: freeFixtures.runtimeModel,
      enableReasoning: false,
    });
  });
});
