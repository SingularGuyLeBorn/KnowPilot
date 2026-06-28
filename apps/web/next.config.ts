import type { NextConfig } from "next";

const serverInternal = process.env.SERVER_INTERNAL_URL || "http://127.0.0.1:3010";

const nextConfig: NextConfig = {
  transpilePackages: ["@knowpilot/server", "@knowpilot/shared"],
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

export default nextConfig;
