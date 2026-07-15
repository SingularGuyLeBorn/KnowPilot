/**
 * AssistantDriftBanner 渲染测试（W16d-3 验收）
 *
 * 1. drift 非空 → 渲染横幅：agent 名 + 漂移项 + 迁移脚本提示
 * 2. drift 为空 → 渲染 null（无横幅）
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssistantDriftBanner } from "@/components/assistantDriftBanner";

describe("AssistantDriftBanner（W16d-3）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("drift 非空 → 渲染横幅：agent 名 + 漂移项 + 迁移脚本提示", async () => {
    await act(async () => {
      root.render(
        <AssistantDriftBanner
          agentName="assistant"
          drift={["工具清单缺少 2 个内置默认工具（native:a, native:b）", "未设置 tier（应为 manager）"]}
          migrationHint="pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-assistant-tools.ts"
        />,
      );
    });

    const banner = container.querySelector('[data-testid="assistant-drift-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("assistant");
    expect(banner!.textContent).toContain("工具清单缺少 2 个内置默认工具");
    expect(banner!.textContent).toContain("未设置 tier");
    expect(banner!.textContent).toContain("migrate-assistant-tools");
  });

  it("drift 为空 → 渲染 null（无横幅）", async () => {
    await act(async () => {
      root.render(<AssistantDriftBanner agentName="assistant" drift={[]} migrationHint="x" />);
    });

    expect(container.querySelector('[data-testid="assistant-drift-banner"]')).toBeNull();
    expect(container.innerHTML).toBe("");
  });
});
