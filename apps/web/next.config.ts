import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@knowpilot/server", "@knowpilot/shared"],
  async rewrites() {
    return [
      {
        source: "/api/trpc/:path*",
        destination: "http://localhost:3010/api/trpc/:path*",
      },
      {
        source: "/api/posts/assets/:path*",
        destination: "http://localhost:3010/api/posts/assets/:path*",
      },
      {
        source: "/uploads/:path*",
        destination: "http://localhost:3010/uploads/:path*",
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
