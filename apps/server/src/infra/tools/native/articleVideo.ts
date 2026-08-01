/**
 * 文章 → Remotion 素材包 / 成片注册（对齐 video-skills-toolkit：本地材料包 + 数据总账，不依赖 Ideaflow）。
 */
import fs from "fs";
import path from "path";
import {
  parsePlatformUrl,
  detectPlatform,
  isArticleFetchFatalError,
} from "../../metablog/index.js";
import { getRefererForUrl } from "../../metablog/ocrBridge.js";
import { detectRasterImageKind } from "../../ocrService.js";
import { probeImageSize } from "../../imageProbe.js";
import { resolveSafePath, resolveWithinDir, assertPathWithinDir } from "../../safePath.js";
import { upsertAlgoVizComposition } from "../../algoVizRegistry.js";
import { resolveAgentFsPath } from "./fs.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

const MAX_IMAGES = 24;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type PackImage = {
  id: string;
  sourceUrl: string;
  fileName: string;
  relPath: string;
  staticFile: string;
  width: number | null;
  height: number | null;
  bytes: number;
  kind: string | null;
};

function slugifyPackId(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || `pack-${Date.now().toString(36)}`;
}

function extForKind(kind: string | null, url: string): string {
  if (kind === "jpeg") return ".jpg";
  if (kind === "png") return ".png";
  if (kind === "gif") return ".gif";
  if (kind === "webp") return ".webp";
  if (kind === "bmp") return ".bmp";
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fromUrl)) {
    return fromUrl === ".jpeg" ? ".jpg" : fromUrl;
  }
  return ".bin";
}

async function downloadBinary(url: string, referer?: string): Promise<Buffer> {
  const auto = getRefererForUrl(url);
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      ...(referer || auto ? { Referer: referer || auto } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("空文件");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`超过 ${MAX_IMAGE_BYTES} 字节`);
  return buf;
}

function copyToAlgoVizPublic(
  ctx: NativeToolContext,
  packSlug: string,
  fileName: string,
  buf: Buffer,
): string {
  const root = resolveSafePath(ctx.config, "apps/algo-viz");
  const abs = resolveWithinDir(path.join(root, "public", "packs", packSlug), fileName);
  assertPathWithinDir(root, abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return `packs/${packSlug}/${fileName}`;
}

async function articleMaterialPackTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url 不能为空");

  const started = Date.now();
  const maxImages = Math.min(Math.max(Number(args.maxImages) || 12, 1), MAX_IMAGES);
  const copyToViz = args.copyToAlgoViz !== false;

  let article;
  try {
    article = await parsePlatformUrl({
      url,
      timeout: args.timeout !== undefined ? Number(args.timeout) : 45_000,
      platform: args.platform ? String(args.platform) : undefined,
      method: args.method === "playwright" ? "playwright" : undefined,
      embedOcr: false,
      fetchImageFiles: false,
    });
  } catch (err: unknown) {
    if (isArticleFetchFatalError(err)) {
      throw new Error(`抓取失败（致命）：${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  }

  const title = (article.title || "untitled").trim();
  const platform = article.platform || detectPlatform(new URL(url).hostname);
  const packSlug = slugifyPackId(String(args.packId || title || url));
  const destRel = String(args.dest || `article-videos/${packSlug}`)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  const { abs: packAbs, relForReturn: packRel } = await resolveAgentFsPath(ctx, destRel, "write");
  fs.mkdirSync(path.join(packAbs, "images"), { recursive: true });

  const mdBody = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `source: ${JSON.stringify(url)}`,
    `platform: ${JSON.stringify(platform)}`,
    `fetchedAt: ${JSON.stringify(new Date().toISOString())}`,
    "---",
    "",
    article.content || "",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(packAbs, "article.md"), mdBody, "utf8");

  const imageUrls = (article.images || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, maxImages);
  const images: PackImage[] = [];
  const failed: Array<{ url: string; error: string }> = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const sourceUrl = imageUrls[i]!;
    const id = `img_${String(i + 1).padStart(2, "0")}`;
    try {
      const buf = await downloadBinary(sourceUrl);
      const kind = detectRasterImageKind(buf);
      if (!kind) {
        failed.push({ url: sourceUrl, error: "非位图" });
        continue;
      }
      const size = probeImageSize(buf);
      const fileName = `${id}${extForKind(kind, sourceUrl)}`;
      const absImg = path.join(packAbs, "images", fileName);
      fs.writeFileSync(absImg, buf);
      const relPath = `${packRel}/images/${fileName}`.replace(/\\/g, "/");
      let staticFile = "";
      if (copyToViz) {
        staticFile = copyToAlgoVizPublic(ctx, packSlug, fileName, buf);
      }
      images.push({
        id,
        sourceUrl,
        fileName,
        relPath,
        staticFile,
        width: size?.width ?? null,
        height: size?.height ?? null,
        bytes: buf.length,
        kind,
      });
    } catch (e: unknown) {
      failed.push({ url: sourceUrl, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const imagesJson = {
    sourceUrl: url,
    title,
    platform,
    packSlug,
    images,
    failed,
  };
  fs.writeFileSync(path.join(packAbs, "images.json"), `${JSON.stringify(imagesJson, null, 2)}\n`, "utf8");

  const beatsTemplate = {
    title,
    sourceUrl: url,
    fps: 30,
    width: 1280,
    height: 720,
    note: "填写 6~12 个 scenes；article-image 的 imageId 必须来自 images.json；同 kind 勿连续；每屏文字元素 ≤5。",
    scenes: [
      {
        kind: "cover",
        durationSec: 3,
        title,
        subtitle: "本地材料包已就绪 · 声音/字幕驱动画面",
        caption: "开场",
      },
      {
        kind: "bullets",
        durationSec: 5,
        title: "三个要点",
        bullets: ["要点一（改）", "要点二（改）", "要点三（改）"],
        caption: "要点",
      },
      ...(images[0]
        ? [
            {
              kind: "article-image" as const,
              durationSec: 4,
              imageId: images[0].id,
              title: "原文配图",
              caption: "原图",
            },
          ]
        : []),
      {
        kind: "outro",
        durationSec: 2.5,
        title: "见微 · 文章成片",
        subtitle: "字幕对齐后再加音效",
        caption: "收尾",
      },
    ],
  };
  const beatsPath = path.join(packAbs, "beats.json");
  if (!fs.existsSync(beatsPath) || args.overwriteBeats === true) {
    fs.writeFileSync(beatsPath, `${JSON.stringify(beatsTemplate, null, 2)}\n`, "utf8");
  }

  fs.writeFileSync(
    path.join(packAbs, "meta.json"),
    `${JSON.stringify(
      {
        title,
        sourceUrl: url,
        platform,
        packSlug,
        packDir: packRel,
        articleMd: `${packRel}/article.md`,
        imagesJson: `${packRel}/images.json`,
        beatsJson: `${packRel}/beats.json`,
        next: [
          "1. skill_view wechat-article-remotion",
          "2. 通读 article.md，改 beats.json（6~12 scene）",
          "3. article_video_compose({ packDir, compositionId })",
          "4. post_update 插入 ```viz",
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    title,
    platform,
    sourceUrl: url,
    packDir: packRel,
    packSlug,
    articleMd: `${packRel}/article.md`,
    imagesJson: `${packRel}/images.json`,
    beatsJson: `${packRel}/beats.json`,
    imageCount: images.length,
    failedCount: failed.length,
    images: images.map((im) => ({
      id: im.id,
      relPath: im.relPath,
      staticFile: im.staticFile,
      width: im.width,
      height: im.height,
    })),
    suggestedSkill: "wechat-article-remotion",
    suggestedTool: "article_video_compose",
    elapsedMs: Date.now() - started,
    note: "抓取用本机 read_article 链路（非 Ideaflow）。微信图带 mp.weixin.qq.com Referer。下一步改 beats.json 再 compose。",
  };
}

type BeatScene = {
  kind: string;
  durationSec?: number;
  durationInFrames?: number;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  caption?: string;
  imageId?: string;
  left?: string;
  right?: string;
  value?: string;
  label?: string;
};

function renderArticleCompositionSource(
  compositionId: string,
  scenes: Array<Record<string, unknown>>,
): string {
  const scenesJson = JSON.stringify(scenes, null, 2);
  return `import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/** AUTO from article_video_compose — 数据在 SCENES；版式复用 ArticleBeatReel 语义 */
const SCENES = ${scenesJson} as const;

const BG = "#F7F8FA";
const INK = "#1a1f2e";
const MUTED = "#5c6578";
const ACCENT = "#2f6fed";

function Caption({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        right: 48,
        bottom: 36,
        padding: "10px 16px",
        borderRadius: 10,
        background: "rgba(26,31,46,0.82)",
        color: "#fff",
        fontSize: 22,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {text}
    </div>
  );
}

const SceneBody: React.FC<{ scene: (typeof SCENES)[number] }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 10, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const kind = String(scene.kind);
  return (
    <AbsoluteFill style={{ backgroundColor: BG, opacity, fontFamily: "system-ui, sans-serif", color: INK }}>
      {kind === "cover" || kind === "outro" ? (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
          <div style={{ fontSize: 48, fontWeight: 700, textAlign: "center", lineHeight: 1.25 }}>
            {String(scene.title || "")}
          </div>
          {scene.subtitle ? (
            <div style={{ marginTop: 20, fontSize: 26, color: MUTED, textAlign: "center" }}>
              {String(scene.subtitle)}
            </div>
          ) : null}
        </AbsoluteFill>
      ) : null}
      {kind === "bullets" ? (
        <AbsoluteFill style={{ padding: "72px 96px" }}>
          <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 28 }}>{String(scene.title || "")}</div>
          <ul style={{ margin: 0, paddingLeft: 28, fontSize: 28, lineHeight: 1.7, color: INK }}>
            {(scene.bullets || []).slice(0, 5).map((b, i) => (
              <li key={i} style={{ marginBottom: 12 }}>
                {String(b)}
              </li>
            ))}
          </ul>
        </AbsoluteFill>
      ) : null}
      {kind === "stat" ? (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ fontSize: 96, fontWeight: 800, color: ACCENT }}>{String(scene.value || "")}</div>
          <div style={{ marginTop: 16, fontSize: 28, color: MUTED }}>{String(scene.label || scene.title || "")}</div>
        </AbsoluteFill>
      ) : null}
      {kind === "compare" ? (
        <AbsoluteFill style={{ flexDirection: "row", padding: 64, gap: 32 }}>
          <div style={{ flex: 1, background: "#fff", borderRadius: 16, padding: 32, border: "1px solid #e2e6ef" }}>
            <div style={{ fontSize: 22, color: MUTED, marginBottom: 12 }}>A</div>
            <div style={{ fontSize: 30, fontWeight: 600 }}>{String(scene.left || "")}</div>
          </div>
          <div style={{ flex: 1, background: "#fff", borderRadius: 16, padding: 32, border: "1px solid #e2e6ef" }}>
            <div style={{ fontSize: 22, color: MUTED, marginBottom: 12 }}>B</div>
            <div style={{ fontSize: 30, fontWeight: 600 }}>{String(scene.right || "")}</div>
          </div>
        </AbsoluteFill>
      ) : null}
      {kind === "article-image" && scene.imageSrc ? (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 40 }}>
          {scene.title ? (
            <div style={{ position: "absolute", top: 40, left: 48, right: 48, fontSize: 28, fontWeight: 600 }}>
              {String(scene.title)}
            </div>
          ) : null}
          <Img
            src={staticFile(String(scene.imageSrc))}
            style={{ maxWidth: "92%", maxHeight: "72%", objectFit: "contain" }}
          />
        </AbsoluteFill>
      ) : null}
      <Caption text={String(scene.caption || "")} />
    </AbsoluteFill>
  );
};

export const ${compositionId}: React.FC = () => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      {SCENES.map((scene, i) => {
        const dur = Number(scene.durationInFrames) || 90;
        const start = cursor;
        cursor += dur;
        return (
          <Sequence key={i} from={start} durationInFrames={dur}>
            <SceneBody scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
`;
}

async function articleVideoComposeTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const packDirRel = String(args.packDir || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!packDirRel) throw new Error("packDir 不能为空（传 article_material_pack 返回的 packDir）");

  const compositionId = String(args.compositionId || "").trim();
  if (!compositionId) throw new Error("compositionId 必填（PascalCase，如 WechatReact19）");

  const { abs: packAbs, relForReturn: packRel } = await resolveAgentFsPath(ctx, packDirRel, "read");
  const beatsAbs = path.join(packAbs, "beats.json");
  const imagesAbs = path.join(packAbs, "images.json");
  if (!fs.existsSync(beatsAbs)) {
    throw new Error(`缺少 ${packRel}/beats.json — 先改素材包里的 beats，或重新 material_pack`);
  }
  if (!fs.existsSync(imagesAbs)) {
    throw new Error(`缺少 ${packRel}/images.json`);
  }

  const beats = JSON.parse(fs.readFileSync(beatsAbs, "utf8")) as {
    title?: string;
    fps?: number;
    width?: number;
    height?: number;
    scenes?: BeatScene[];
  };
  const imagesFile = JSON.parse(fs.readFileSync(imagesAbs, "utf8")) as {
    packSlug?: string;
    images?: PackImage[];
  };
  const scenesIn = Array.isArray(beats.scenes) ? beats.scenes : [];
  if (scenesIn.length < 4 || scenesIn.length > 16) {
    throw new Error(`beats.scenes 建议 6~12 个（当前 ${scenesIn.length}，允许 4~16）`);
  }

  const byId = new Map((imagesFile.images || []).map((im) => [im.id, im]));
  const fps = Number(beats.fps) || 30;
  const compiled: Array<Record<string, unknown>> = [];
  let totalFrames = 0;
  const usedImages = new Set<string>();

  for (const s of scenesIn) {
    const kind = String(s.kind || "");
    const allowed = new Set(["cover", "bullets", "stat", "compare", "article-image", "outro"]);
    if (!allowed.has(kind)) {
      throw new Error(`非法 scene.kind=${kind}；允许：${[...allowed].join(", ")}`);
    }
    const durationInFrames =
      s.durationInFrames !== undefined
        ? Math.max(15, Math.round(Number(s.durationInFrames)))
        : Math.max(15, Math.round((Number(s.durationSec) || 3) * fps));
    totalFrames += durationInFrames;

    let imageSrc: string | undefined;
    if (kind === "article-image") {
      const imageId = String(s.imageId || "");
      const im = byId.get(imageId);
      if (!im) throw new Error(`article-image 引用了不存在的 imageId=${imageId}`);
      if (usedImages.has(imageId)) {
        throw new Error(`同一 imageId 不可重复使用：${imageId}`);
      }
      usedImages.add(imageId);
      imageSrc = im.staticFile;
      if (!imageSrc) {
        // 补拷到 algo-viz public
        const srcAbs = path.join(packAbs, "images", im.fileName);
        if (!fs.existsSync(srcAbs)) throw new Error(`缺图文件 ${im.relPath}`);
        const slug = imagesFile.packSlug || path.basename(packAbs);
        imageSrc = copyToAlgoVizPublic(ctx, slug, im.fileName, fs.readFileSync(srcAbs));
      }
    }

    compiled.push({
      kind,
      durationInFrames,
      title: s.title || "",
      subtitle: s.subtitle || "",
      bullets: Array.isArray(s.bullets) ? s.bullets.slice(0, 5) : [],
      caption: s.caption || "",
      left: s.left || "",
      right: s.right || "",
      value: s.value || "",
      label: s.label || "",
      imageSrc: imageSrc || "",
      imageId: s.imageId || "",
    });
  }

  // 禁止同 kind 连续
  for (let i = 1; i < compiled.length; i++) {
    if (compiled[i]!.kind === compiled[i - 1]!.kind) {
      throw new Error(`scene[${i}] 与上一镜 kind 相同（${compiled[i]!.kind}），请换版式`);
    }
  }

  const source = renderArticleCompositionSource(compositionId, compiled);
  const result = await upsertAlgoVizComposition(ctx.config, {
    compositionId,
    source,
    durationInFrames: totalFrames,
    fps,
    width: Number(beats.width) || 1280,
    height: Number(beats.height) || 720,
    defaultProps: {
      title: beats.title || compositionId,
      packDir: packRel,
    },
    overwrite: args.overwrite === undefined ? true : Boolean(args.overwrite),
  });

  const demoDataAbs = path.join(packAbs, "demoData.json");
  fs.writeFileSync(
    demoDataAbs,
    `${JSON.stringify({ compositionId, fps, durationInFrames: totalFrames, scenes: compiled }, null, 2)}\n`,
    "utf8",
  );

  return {
    ...result,
    packDir: packRel,
    demoData: `${packRel}/demoData.json`,
    sceneCount: compiled.length,
    durationInFrames: totalFrames,
    durationSec: Math.round((totalFrames / fps) * 10) / 10,
    vizFenceExample: "```viz\ncomposition: " + compositionId + "\n```",
    studioHint: "pnpm --filter @knowpilot/algo-viz dev",
    previewHint: `pnpm --filter @knowpilot/algo-viz preview ${compositionId}`,
    note: "成片数据在 composition 内 SCENES + pack/demoData.json。TTS/字幕驱动时间轴见 Skill（可选外部服务）。原文图 object-fit: contain。",
  };
}

const DEFS: NativeToolDefinition[] = [
  {
    name: "article_material_pack",
    concurrencyClass: "A",
    description:
      "把网页/微信文章打成「本地材料包」（对齐 video-skills-toolkit）：article.md + images/ + images.json + beats.json 模板；图片带平台 Referer 下载，并复制到 apps/algo-viz/public/packs/{slug}/ 供 Remotion staticFile。不依赖 Ideaflow。下一步改 beats.json 后调 article_video_compose。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "文章 URL（微信 mp.weixin.qq.com/s/… 或其它 read_article 支持的站）" },
        packId: { type: "string", description: "可选包目录名；默认从标题生成" },
        dest: { type: "string", description: "Workspace 相对目录，默认 article-videos/{packId}" },
        maxImages: { type: "number", description: "最多下载配图数，默认 12，上限 24" },
        platform: { type: "string", description: "可选强制平台：wechat 等" },
        method: { type: "string", enum: ["playwright"], description: "强制 Playwright" },
        timeout: { type: "number", description: "抓取超时毫秒" },
        copyToAlgoViz: { type: "boolean", description: "是否复制到 algo-viz/public/packs，默认 true" },
        overwriteBeats: { type: "boolean", description: "已有 beats.json 时是否覆盖模板，默认 false" },
      },
      required: ["url"],
    },
  },
  {
    name: "article_video_compose",
    concurrencyClass: "D",
    destructive: true,
    approvalExempt: true,
    description:
      "读取材料包 beats.json + images.json，生成 Remotion Composition 并经 algo_viz 注册（调用即部署）。scene.kind：cover|bullets|stat|compare|article-image|outro；禁止同 kind 连续；article-image 须引用真实 imageId 且不重复。完成后 post_update 插入 ```viz。",
    parameters: {
      type: "object",
      properties: {
        packDir: { type: "string", description: "article_material_pack 返回的 packDir" },
        compositionId: { type: "string", description: "PascalCase，如 WechatLocalFirst" },
        overwrite: { type: "boolean", description: "覆盖已有 composition，默认 true" },
      },
      required: ["packDir", "compositionId"],
    },
  },
];

const HANDLERS: Record<string, NativeToolHandler> = {
  article_material_pack: articleMaterialPackTool,
  article_video_compose: articleVideoComposeTool,
};

export function registerArticleVideoTools(): void {
  registerNativeDomain(DEFS, HANDLERS);
}
