import type { MetadataRoute } from "next";

/** 轻量 PWA：可「添加到主屏幕」；不做 Service Worker / 离线缓存 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KnowPilot",
    short_name: "KnowPilot",
    description: "智能知识管理与 Agent 工作台（支持手机远程访问）",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8f6f3",
    theme_color: "#6e5c4a",
    lang: "zh-CN",
    icons: [
      {
        src: "/icons/robot.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
