import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 blocks cross-origin requests to /_next/* dev resources by
  // default. That breaks hydration (and HMR) when the dev server is hit
  // from a LAN IP instead of localhost — leaving plain <a href> nav links
  // working but interactive client components (theme toggle, tier toggle,
  // charts, buttons) silently dead. Local-first development is supposed
  // to be reachable from other devices on the same network, so allow the
  // common private ranges. Production builds ignore this setting.
  // Next.js 16 doesn't accept CIDR ranges; only literal hostnames/IPs and
  // glob-style wildcards. Allow anything on the current LAN plus localhost.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.local",
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],
};

export default nextConfig;
