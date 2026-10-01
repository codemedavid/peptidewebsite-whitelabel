import type { NextConfig } from "next";

import { SERVER_ACTION_BODY_LIMIT } from "./src/lib/upload/limits";

const nextConfig: NextConfig = {
  // Allow an isolated build dir (e.g. CI / verifying a build while `next dev`
  // holds .next) without colliding on the default .next directory.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 365,
    remotePatterns: [
      { protocol: "https", hostname: "ik.imagekit.io" },
    ],
  },
  experimental: {
    // Prisma works in Node runtime; keep middleware on edge but DB lookups cached.
    // Must stay in sync with the per-file maxes in src/lib/upload/limits.ts —
    // Next enforces this before any action code runs. See test:upload-limits.
    serverActions: {
      bodySizeLimit: SERVER_ACTION_BODY_LIMIT,
      // Dev only: the Pepweb app opens the storefront through a tunnel
      // (lib/mobile/storefront-origin.ts) whose Host is rewritten to the
      // tenant's lvh.me address, so the browser's Origin no longer matches and
      // Next would refuse every server action (checkout, admin handoff).
      ...(process.env.NODE_ENV !== "production" && process.env.MOBILE_DEV_STOREFRONT_ORIGIN
        ? { allowedOrigins: [new URL(process.env.MOBILE_DEV_STOREFRONT_ORIGIN).host] }
        : {}),
    },
    // Tree-shake heavy icon / animation / SDK barrels — huge first-load JS win.
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@supabase/ssr",
      "@supabase/supabase-js",
    ],
    // Reuse the client-side router cache for prefetched routes so back/forward
    // and same-tab nav don't re-fetch.
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [
      {
        // Next emits hashed filenames here; cache forever.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Optimized image responses are already keyed by URL+params; long cache.
        source: "/_next/image",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/favicon.ico",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, s-maxage=86400" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
