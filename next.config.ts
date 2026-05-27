import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow an isolated build dir (e.g. CI / verifying a build while `next dev`
  // holds .next) without colliding on the default .next directory.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ik.imagekit.io" },
    ],
  },
  experimental: {
    // Prisma works in Node runtime; keep middleware on edge but DB lookups cached.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
