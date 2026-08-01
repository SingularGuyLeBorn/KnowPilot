import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createNativeCtx, createTempProjectDir } from "./helpers/toolTestFixtures.js";

function writeMinimalPng(abs: string, w = 64, h = 48) {
  // 最小合法 PNG 头 + IHDR 尺寸字段（内容不必可解码，compose 只拷文件）
  const buf = Buffer.alloc(33);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

describe("native:article_video_compose", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "apps/algo-viz/src/compositions"), { recursive: true });
    fs.mkdirSync(path.join(root, "apps/algo-viz/public/packs"), { recursive: true });
    fs.mkdirSync(path.join(root, "data/workspace"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "apps/algo-viz/src/registry-meta.json"),
      JSON.stringify({ entries: [] }, null, 2),
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("从 beats.json 注册 composition 并写 demoData", async () => {
    const packRel = "article-videos/demo";
    // createNativeCtx 默认 workspace 一般是 data/workspace 或 __assistant__
    const ctx = createNativeCtx(root);
    const packAbs = path.join(root, "data/workspace", packRel);
    fs.mkdirSync(path.join(packAbs, "images"), { recursive: true });
    writeMinimalPng(path.join(packAbs, "images", "img_01.png"));

    fs.writeFileSync(
      path.join(packAbs, "images.json"),
      JSON.stringify(
        {
          packSlug: "demo",
          images: [
            {
              id: "img_01",
              fileName: "img_01.png",
              relPath: `${packRel}/images/img_01.png`,
              staticFile: "",
              width: 64,
              height: 48,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.writeFileSync(
      path.join(packAbs, "beats.json"),
      JSON.stringify(
        {
          title: "Demo",
          fps: 30,
          scenes: [
            { kind: "cover", durationSec: 2, title: "开场", caption: "开场" },
            { kind: "bullets", durationSec: 3, title: "要点", bullets: ["a", "b"], caption: "要点" },
            { kind: "article-image", durationSec: 3, imageId: "img_01", caption: "原图" },
            { kind: "outro", durationSec: 2, title: "收", caption: "收尾" },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = (await executeNativeTool(
      "article_video_compose",
      { packDir: packRel, compositionId: "WechatDemoPack" },
      ctx,
    )) as {
      compositionId: string;
      sceneCount: number;
      demoData: string;
    };

    expect(result.compositionId).toBe("WechatDemoPack");
    expect(result.sceneCount).toBe(4);
    expect(fs.existsSync(path.join(root, "apps/algo-viz/src/compositions/WechatDemoPack.tsx"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(packAbs, "demoData.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "apps/algo-viz/public/packs/demo/img_01.png"))).toBe(true);
  });

  it("拒绝同 kind 连续", async () => {
    const ctx = createNativeCtx(root);
    const packRel = "article-videos/bad";
    const packAbs = path.join(root, "data/workspace", packRel);
    fs.mkdirSync(packAbs, { recursive: true });
    fs.writeFileSync(path.join(packAbs, "images.json"), JSON.stringify({ images: [] }), "utf8");
    fs.writeFileSync(
      path.join(packAbs, "beats.json"),
      JSON.stringify({
        scenes: [
          { kind: "cover", durationSec: 2, title: "a" },
          { kind: "cover", durationSec: 2, title: "b" },
          { kind: "bullets", durationSec: 2, title: "c", bullets: ["x"] },
          { kind: "outro", durationSec: 2, title: "d" },
        ],
      }),
      "utf8",
    );

    await expect(
      executeNativeTool(
        "article_video_compose",
        { packDir: packRel, compositionId: "WechatBad" },
        ctx,
      ),
    ).rejects.toThrow(/kind 相同/);
  });
});
