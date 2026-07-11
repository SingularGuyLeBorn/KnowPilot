import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const serverInternal = process.env.SERVER_INTERNAL_URL || "http://127.0.0.1:3010";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// 仅 transpile shared（运行时真依赖）；server 只通过 `import type { AppRouter }` 共享类型，
// type-only import 在编译期被擦除，无需把整个 server 包拉进 Next 编译/打包图（否则 dev/build 都更慢）。
const nextConfig: NextConfig = {
  transpilePackages: ["@knowpilot/shared"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    return [
      {
        source: "/api/trpc/:path*",
        destination: `${serverInternal}/api/trpc/:path*`,
      },
      {
        source: "/api/agent/chat/stream",
        destination: `${serverInternal}/api/agent/chat/stream`,
      },
      {
        source: "/api/agent/async-stream",
        destination: `${serverInternal}/api/agent/async-stream`,
      },
      {
        source: "/api/agent/chat/stop",
        destination: `${serverInternal}/api/agent/chat/stop`,
      },
      {
        source: "/api/posts/assets/:path*",
        destination: `${serverInternal}/api/posts/assets/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${serverInternal}/uploads/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      { hostname: "localhost" },
      { hostname: "**.githubusercontent.com" },
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
