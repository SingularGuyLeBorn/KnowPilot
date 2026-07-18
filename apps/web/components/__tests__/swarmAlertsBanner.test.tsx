/**
 * SwarmAlertsBanner：有告警渲染 / 无告警 null
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SwarmAlertsBanner } from "@/components/swarmAlertsBanner";

describe("SwarmAlertsBanner", () => {
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

  it("needsAttention → 渲染告警与会话链接", async () => {
    await act(async () => {
      root.render(
        <SwarmAlertsBanner
          needsAttention
          askUserPendingCount={2}
          askUserSamples={[
            { askId: "a1", sessionId: "clxxxxxxxxxxxxxxxxxxxx", question: "选哪个模型？" },
          ]}
          suspendedAgents={[{ id: "ag1", name: "超级 Agent" }]}
          highInboxAgents={[]}
        />,
      );
    });

    const banner = container.querySelector('[data-testid="swarm-alerts-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("2 个 ask_user");
    expect(banner!.textContent).toContain("超级 Agent");
    expect(banner!.textContent).toContain("选哪个模型");
    expect(banner!.querySelector('a[href*="sessionId="]')).not.toBeNull();
  });

  it("无告警 → 渲染 null", async () => {
    await act(async () => {
      root.render(
        <SwarmAlertsBanner
          needsAttention={false}
          askUserPendingCount={0}
          askUserSamples={[]}
          suspendedAgents={[]}
          highInboxAgents={[]}
        />,
      );
    });

    expect(container.querySelector('[data-testid="swarm-alerts-banner"]')).toBeNull();
    expect(container.innerHTML).toBe("");
  });
});
