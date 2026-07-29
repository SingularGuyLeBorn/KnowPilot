import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createNativeCtx, createTempProjectDir } from "./helpers/toolTestFixtures.js";

describe("native:algo_viz_create", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "apps/algo-viz/src/compositions"), { recursive: true });
    fs.mkdirSync(path.join(root, "apps/algo-viz/src/data"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "apps/algo-viz/src/registry-meta.json"),
      JSON.stringify({ entries: [] }, null, 2),
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("写入 composition + meta + 生成 registry", async () => {
    const ctx = createNativeCtx(root);
    const source = `
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

export const DemoClip: React.FC<{ title?: string }> = ({ title = "hi" }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill>{title}:{f}</AbsoluteFill>;
};
`.trim();

    const result = (await executeNativeTool(
      "algo_viz_create",
      {
        compositionId: "DemoClip",
        source,
        durationInFrames: 90,
        fps: 30,
        width: 1280,
        height: 720,
        defaultProps: { title: "demo" },
        choreography: { beats: ["in", "out"] },
      },
      ctx,
    )) as {
      compositionId: string;
      compositionPath: string;
      created: boolean;
      vizFenceExample: string;
    };

    expect(result.compositionId).toBe("DemoClip");
    expect(result.created).toBe(true);
    expect(result.compositionPath).toBe("apps/algo-viz/src/compositions/DemoClip.tsx");
    expect(result.vizFenceExample).toContain("composition: DemoClip");

    expect(
      fs.readFileSync(path.join(root, "apps/algo-viz/src/compositions/DemoClip.tsx"), "utf8"),
    ).toContain("export const DemoClip");

    const meta = JSON.parse(
      fs.readFileSync(path.join(root, "apps/algo-viz/src/registry-meta.json"), "utf8"),
    ) as { entries: Array<{ id: string }> };
    expect(meta.entries.map((e) => e.id)).toEqual(["DemoClip"]);

    const registry = fs.readFileSync(
      path.join(root, "apps/algo-viz/src/registry.ts"),
      "utf8",
    );
    expect(registry).toContain("DemoClip");
    expect(registry).toContain("AUTO-GENERATED");
    expect(registry).toContain('durationInFrames: 90');

    expect(
      fs.existsSync(path.join(root, "apps/algo-viz/src/data/DemoClip-choreography.json")),
    ).toBe(true);

    const listed = (await executeNativeTool("algo_viz_list", {}, ctx)) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe("DemoClip");
  });

  it("拒绝无具名导出的 source", async () => {
    const ctx = createNativeCtx(root);
    await expect(
      executeNativeTool(
        "algo_viz_create",
        {
          compositionId: "BadClip",
          source: "export default function BadClip() { return null }",
        },
        ctx,
      ),
    ).rejects.toThrow(/具名导出/);
  });
});
