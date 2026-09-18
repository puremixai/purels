import type { NextConfig } from "next";

const apiProxyTarget = (process.env.API_PROXY_TARGET || "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` }];
  },
};

export default nextConfig;
