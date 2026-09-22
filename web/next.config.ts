import type { NextConfig } from "next";

const apiProxyTarget = (process.env.API_PROXY_TARGET || "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` },
      // The overview KPI reads the API's own readiness route, which sits at the
      // root rather than under /api. Without this the browser would ask Next,
      // which has no such route, and the KPI would always say "unreachable".
      { source: "/readyz", destination: `${apiProxyTarget}/readyz` },
    ];
  },
  async redirects() {
    return [
      { source: "/admin", destination: "/home", permanent: false },
      { source: "/admin/:path*", destination: "/home/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
