/**
 * 算法动画域：专用创建/列表工具，替代 write_file 直写 apps/algo-viz。
 */
import {
  readAlgoVizMeta,
  upsertAlgoVizComposition,
} from "../../algoVizRegistry.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

const DEFS: NativeToolDefinition[] = [
  {
    name: "algo_viz_create",
    concurrencyClass: "D",
    destructive: true,
    approvalExempt: true,
    defaultHidden: true,
    description:
      "创建或更新算法动画 Composition：直接写入 apps/algo-viz/src/compositions/{id}.tsx，更新 registry-meta.json，并自动重生 registry.ts——调用即部署完成，禁止再让用户跑 cp/bash/deploy 脚本，也禁止声称「无法写入 apps/algo-viz」。禁止 write_file 写 algo-viz 或把 .tsx 丢进 content/uploads/viz/。完成后用 post_update 插入 ```viz composition: {id}。source 须具名导出与 compositionId 同名的 React 组件。",
    parameters: {
      type: "object",
      properties: {
        compositionId: {
          type: "string",
          description: "PascalCase id，如 PpoClip / ArVsDiffusion",
        },
        source: {
          type: "string",
          description: "完整 .tsx 源码（须 export const/function {compositionId}）",
        },
        durationInFrames: {
          type: "number",
          description: "总帧数，默认 180",
        },
        fps: { type: "number", description: "帧率，默认 30" },
        width: { type: "number", description: "宽，默认 1280" },
        height: { type: "number", description: "高，默认 720" },
        defaultProps: {
          type: "object",
          description: "Player 默认 props（对象）",
        },
        choreography: {
          description: "可选分镜 JSON（对象或字符串），写入 src/data/{id}-choreography.json",
        },
        overwrite: {
          type: "boolean",
          description: "已存在时是否覆盖，默认 true",
        },
      },
      required: ["compositionId", "source"],
    },
  },
  {
    name: "algo_viz_list",
    concurrencyClass: "A",
    defaultHidden: true,
    description:
      "列出已注册的算法动画 composition（读 apps/algo-viz/src/registry-meta.json）。插入 ```viz 前可先确认 id。",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

async function createTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  return upsertAlgoVizComposition(ctx.config, {
    compositionId: String(args.compositionId ?? ""),
    source: String(args.source ?? ""),
    durationInFrames:
      args.durationInFrames === undefined ? undefined : Number(args.durationInFrames),
    fps: args.fps === undefined ? undefined : Number(args.fps),
    width: args.width === undefined ? undefined : Number(args.width),
    height: args.height === undefined ? undefined : Number(args.height),
    defaultProps:
      args.defaultProps && typeof args.defaultProps === "object"
        ? (args.defaultProps as Record<string, unknown>)
        : {},
    choreography: args.choreography,
    overwrite: args.overwrite === undefined ? true : Boolean(args.overwrite),
  });
}

async function listTool(_args: Record<string, unknown>, ctx: NativeToolContext) {
  const meta = readAlgoVizMeta(ctx.config);
  return {
    total: meta.entries.length,
    items: meta.entries.map((e) => ({
      id: e.id,
      durationInFrames: e.durationInFrames,
      fps: e.fps,
      width: e.width,
      height: e.height,
      defaultProps: e.defaultProps,
    })),
  };
}

const HANDLERS: Record<string, NativeToolHandler> = {
  algo_viz_create: createTool,
  algo_viz_list: listTool,
};

export function registerAlgoVizTools(): void {
  registerNativeDomain(DEFS, HANDLERS);
}
