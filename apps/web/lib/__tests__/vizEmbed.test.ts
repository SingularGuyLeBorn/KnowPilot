import { describe, expect, it } from "vitest";
import { parseVizFence } from "@/components/post/vizFence";

describe("parseVizFence", () => {
  it("解析 composition + props", () => {
    const s = parseVizFence(
      `composition: PpoClip\ntitle: PPO-Clip\nepsilon: 0.2`,
    );
    expect(s).toEqual({
      composition: "PpoClip",
      src: undefined,
      title: "PPO-Clip",
      poster: undefined,
      props: { epsilon: 0.2 },
    });
  });

  it("单行 composition 名", () => {
    expect(parseVizFence("PpoClip")).toEqual({ composition: "PpoClip", props: {} });
  });

  it("兼容 mp4 src", () => {
    const s = parseVizFence(`src: /uploads/viz/a.mp4\ntitle: archived`);
    expect(s?.src).toBe("/uploads/viz/a.mp4");
    expect(s?.title).toBe("archived");
  });

  it("缺字段返回 null", () => {
    expect(parseVizFence("title: only")).toBeNull();
  });

  it("保留 props 键名大小写，并解析 JSON 数组", () => {
    const s = parseVizFence(
      `composition: ArVsDiffusion\ngenTokens: ["The","cat"]\nmaskTokens: ["[M]","[M]"]`,
    );
    expect(s?.props).toEqual({
      genTokens: ["The", "cat"],
      maskTokens: ["[M]", "[M]"],
    });
  });
});
